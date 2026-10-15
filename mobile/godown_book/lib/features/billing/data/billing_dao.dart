import 'package:sqflite/sqflite.dart';

import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../models/bill_model.dart';
import '../models/payment_model.dart';

class BillingDao {
  BillingDao._();

  static final BillingDao instance = BillingDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  // ==========================
  // Bills
  // ==========================

  Future<List<BillModel>> getAllBills() async {
    final rows = await _db.queryScoped(
      DatabaseConstants.invoiceTable,
      orderBy: 'invoice_date DESC, created_at DESC',
    );
    if (rows.isEmpty) return const [];

    final lineRows = await _db.queryScoped(
      DatabaseConstants.invoiceChargeTable,
      orderBy: 'sort_order ASC',
    );

    final linesByBill = <String, List<BillLineModel>>{};
    for (final row in lineRows) {
      final line = BillLineModel.fromMap(row);
      linesByBill.putIfAbsent(line.billId, () => []).add(line);
    }

    return [
      for (final row in rows)
        BillModel.fromMap(row, lines: linesByBill[row['id'] as String] ?? const []),
    ];
  }

  Future<BillModel?> getBillById(String id) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.invoiceTable,
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;

    final lineRows = await _db.queryScoped(
      DatabaseConstants.invoiceChargeTable,
      where: 'invoice_id = ?',
      whereArgs: [id],
      orderBy: 'sort_order ASC',
    );

    return BillModel.fromMap(
      rows.first,
      lines: lineRows.map(BillLineModel.fromMap).toList(),
    );
  }

  Future<void> writeBillWithLines(
    DatabaseExecutor txn,
    BillModel bill, {
    required bool isNew,
  }) async {
    final companyId = TenantScope.companyId;

    if (isNew) {
      await txn.insert(DatabaseConstants.invoiceTable, {
        ...bill.toMap(),
        DatabaseConstants.companyIdColumn: companyId,
      });
    } else {
      await txn.update(
        DatabaseConstants.invoiceTable,
        bill.toMap(),
        where: 'id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
        whereArgs: [bill.id, companyId],
      );
      await txn.delete(
        DatabaseConstants.invoiceChargeTable,
        where: 'invoice_id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
        whereArgs: [bill.id, companyId],
      );
    }

    var order = 0;
    for (final line in bill.lines) {
      await txn.insert(DatabaseConstants.invoiceChargeTable, {
        ...line.copyWith(billId: bill.id, sortOrder: order).toMap(),
        DatabaseConstants.companyIdColumn: companyId,
      });
      order += 10;
    }
  }

  /// The `period_to` of every bill against [bookingId], inside the
  /// caller's own transaction - used to move the booking's
  /// rent-billed watermark without a second, un-transacted read.
  Future<List<String>> getPeriodTosForBookingInTxn(
    DatabaseExecutor txn,
    String bookingId,
  ) async {
    final rows = await txn.query(
      DatabaseConstants.invoiceTable,
      columns: ['period_to'],
      where: 'booking_id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
      whereArgs: [bookingId, TenantScope.companyId],
    );
    return [for (final row in rows) (row['period_to'] as String?) ?? ''];
  }

  Future<void> updateBillRow(BillModel bill) async {
    await _db.updateScoped(DatabaseConstants.invoiceTable, bill.toMap(), bill.id);
  }

  /// Same as [updateBillRow], inside the caller's own transaction - so
  /// a restated bill commits together with the payment that caused it.
  Future<void> updateBillRowInTxn(DatabaseExecutor txn, BillModel bill) async {
    await txn.update(
      DatabaseConstants.invoiceTable,
      {...bill.toMap(), DatabaseConstants.companyIdColumn: TenantScope.companyId},
      where: 'id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
      whereArgs: [bill.id, TenantScope.companyId],
    );
  }

  Future<void> deleteBill(String id) async {
    await _db.transaction((txn) => deleteBillInTxn(txn, id));
  }

  /// Both deletes inside one transaction - a crash between them would
  /// otherwise orphan the bill's own charge lines.
  Future<void> deleteBillInTxn(DatabaseExecutor txn, String id) async {
    final companyId = TenantScope.companyId;
    await txn.delete(
      DatabaseConstants.invoiceChargeTable,
      where: 'invoice_id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
      whereArgs: [id, companyId],
    );
    await txn.delete(
      DatabaseConstants.invoiceTable,
      where: 'id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
      whereArgs: [id, companyId],
    );
  }

  // ==========================
  // Payments
  // ==========================

  Future<List<PaymentModel>> getAllPayments() async {
    final rows = await _db.queryScoped(
      DatabaseConstants.paymentTable,
      orderBy: 'payment_date DESC, created_at DESC',
    );
    return rows.map(PaymentModel.fromMap).toList();
  }

  Future<PaymentModel?> getPaymentById(String id) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.paymentTable,
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return PaymentModel.fromMap(rows.first);
  }

  Future<List<PaymentModel>> getPaymentsForBill(String billId) async {
    final rows = await _db.queryScoped(
      DatabaseConstants.paymentTable,
      where: 'invoice_id = ?',
      whereArgs: [billId],
      orderBy: 'payment_date ASC',
    );
    return rows.map(PaymentModel.fromMap).toList();
  }

  Future<void> insertPayment(DatabaseExecutor txn, PaymentModel payment) async {
    await txn.insert(DatabaseConstants.paymentTable, {
      ...payment.toMap(),
      DatabaseConstants.companyIdColumn: TenantScope.companyId,
    });
  }

  Future<void> updatePayment(PaymentModel payment) async {
    await _db.updateScoped(
      DatabaseConstants.paymentTable,
      payment.toMap(),
      payment.id,
    );
  }

  /// Same as [updatePayment], inside the caller's own transaction - so
  /// the receipt and the bill it restates commit together.
  Future<void> updatePaymentInTxn(
    DatabaseExecutor txn,
    PaymentModel payment,
  ) async {
    await txn.update(
      DatabaseConstants.paymentTable,
      {...payment.toMap(), DatabaseConstants.companyIdColumn: TenantScope.companyId},
      where: 'id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
      whereArgs: [payment.id, TenantScope.companyId],
    );
  }

  Future<void> deletePayment(String id) async {
    await _db.deleteScoped(DatabaseConstants.paymentTable, id);
  }

  /// Same as [deletePayment], inside the caller's own transaction.
  Future<void> deletePaymentInTxn(DatabaseExecutor txn, String id) async {
    await txn.delete(
      DatabaseConstants.paymentTable,
      where: 'id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
      whereArgs: [id, TenantScope.companyId],
    );
  }

  /// Reads inside the caller's own transaction - a restate must see
  /// the payment write that triggered it, not a stale snapshot from
  /// before the transaction started.
  Future<BillModel?> getBillByIdInTxn(DatabaseExecutor txn, String id) async {
    final companyId = TenantScope.companyId;
    final rows = await txn.query(
      DatabaseConstants.invoiceTable,
      where: 'id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
      whereArgs: [id, companyId],
      limit: 1,
    );
    if (rows.isEmpty) return null;

    final lineRows = await txn.query(
      DatabaseConstants.invoiceChargeTable,
      where: 'invoice_id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
      whereArgs: [id, companyId],
      orderBy: 'sort_order ASC',
    );

    return BillModel.fromMap(
      rows.first,
      lines: lineRows.map(BillLineModel.fromMap).toList(),
    );
  }

  Future<List<PaymentModel>> getPaymentsForBillInTxn(
    DatabaseExecutor txn,
    String billId,
  ) async {
    final rows = await txn.query(
      DatabaseConstants.paymentTable,
      where: 'invoice_id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
      whereArgs: [billId, TenantScope.companyId],
      orderBy: 'payment_date ASC',
    );
    return rows.map(PaymentModel.fromMap).toList();
  }
}
