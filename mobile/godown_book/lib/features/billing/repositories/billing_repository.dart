import 'package:sqflite/sqflite.dart';

import '../../../core/customer/customer_lookup_service.dart';
import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../../../core/utils/financial_year.dart';
import '../../../core/utils/id_generator.dart';
import '../../company/controllers/company_controller.dart';
import '../../customers/repositories/customer_repository.dart';
import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';
import '../data/billing_dao.dart';
import '../models/bill_model.dart';
import '../models/payment_model.dart';
import '../services/storage_charge_calculator.dart';

/// One customer's money at a glance - what was billed, what came in and
/// what is still due.
class CustomerBalance {
  final String customerId;
  final String customerName;
  final double billed;
  final double received;

  /// The customer's own money the godown is still holding - deposit
  /// taken, less whatever has been returned or applied to the dues. It
  /// is deliberately not part of [received]: a deposit is held, not
  /// earned, and must never make a customer look paid up.
  final double depositHeld;

  const CustomerBalance({
    required this.customerId,
    required this.customerName,
    required this.billed,
    required this.received,
    this.depositHeld = 0,
  });

  double get outstanding {
    final due = billed - received;
    return due < 0 ? 0 : due;
  }

  /// Money received beyond what has been billed - an advance sitting
  /// with the operator.
  double get advance {
    final extra = received - billed;
    return extra < 0 ? 0 : extra;
  }
}


/// The deposit on one storage record: what was agreed, what actually
/// came in, and what is still lying with the godown.
class DepositSummary {
  final double agreed;
  final double received;
  final double returned;
  final double adjusted;

  const DepositSummary({
    this.agreed = 0,
    this.received = 0,
    this.returned = 0,
    this.adjusted = 0,
  });

  /// Still held for the customer, and owed back to them at the end.
  double get held {
    final balance = received - returned - adjusted;
    return balance < 0 ? 0 : balance;
  }

  /// Agreed on the storage record but never actually receipted.
  double get notYetTaken {
    final gap = agreed - received;
    return gap < 0 ? 0 : gap;
  }

  bool get isEmpty => agreed <= 0.004 && received <= 0.004;
}

/// One line of a customer statement, oldest first.
class StatementEntry {
  final String date;
  final String reference;
  final String particulars;

  /// What the customer was charged (a bill).
  final double debit;

  /// What the customer paid (a receipt).
  final double credit;

  final double runningBalance;

  const StatementEntry({
    required this.date,
    required this.reference,
    required this.particulars,
    this.debit = 0,
    this.credit = 0,
    this.runningBalance = 0,
  });
}

/// Bills and payments: raising them, numbering them, and keeping every
/// balance in step.
class BillingRepository {
  BillingRepository._() {
    CustomerLookupService.instance.extraSources.add(_suggestions);
  }

  static final BillingRepository instance = BillingRepository._();

  final DatabaseHelper _db = DatabaseHelper.instance;
  final BillingDao _dao = BillingDao.instance;

  Future<List<BillModel>> getAllBills() => _dao.getAllBills();

  Future<BillModel?> getBillById(String id) => _dao.getBillById(id);

  Future<List<BillModel>> getBillsForCustomer(String customerId) async {
    final all = await _dao.getAllBills();
    return all.where((b) => b.customerId == customerId).toList();
  }

  Future<List<BillModel>> getBillsForBooking(String bookingId) async {
    final all = await _dao.getAllBills();
    return all.where((b) => b.bookingId == bookingId).toList();
  }

  Future<List<PaymentModel>> getAllPayments() => _dao.getAllPayments();

  Future<PaymentModel?> getPaymentById(String id) => _dao.getPaymentById(id);

  Future<List<PaymentModel>> getPaymentsForBill(String billId) =>
      _dao.getPaymentsForBill(billId);

  Future<List<PaymentModel>> getPaymentsForCustomer(String customerId) async {
    final all = await _dao.getAllPayments();
    return all.where((p) => p.customerId == customerId).toList();
  }

  /// Every deposit entry recorded against one storage record.
  Future<List<PaymentModel>> getDepositEntriesForBooking(String bookingId) async {
    final all = await _dao.getAllPayments();
    return all
        .where((p) =>
            p.bookingId == bookingId &&
            (p.paymentType.isDepositIn || p.paymentType.lowersDeposit))
        .toList();
  }

  /// The deposit position of one storage record. [agreed] comes from
  /// the storage record; everything else from the receipts actually
  /// issued, so the two can be compared.
  Future<DepositSummary> depositForBooking(
    String bookingId, {
    double agreed = 0,
  }) async {
    final entries = await getDepositEntriesForBooking(bookingId);

    var received = 0.0;
    var returned = 0.0;
    var adjusted = 0.0;
    for (final entry in entries) {
      switch (entry.paymentType) {
        case PaymentType.securityDeposit:
          received += entry.amount;
        case PaymentType.depositRefund:
          returned += entry.amount;
        case PaymentType.depositAdjusted:
          adjusted += entry.amount;
        default:
          break;
      }
    }

    return DepositSummary(
      agreed: agreed,
      received: received,
      returned: returned,
      adjusted: adjusted,
    );
  }

  Future<List<CustomerSuggestion>> _suggestions() async {
    final bills = await _dao.getAllBills();
    return [
      for (final b in bills)
        CustomerSuggestion(
          name: b.customerName,
          phone: b.customerPhone,
          gst: b.customerGst,
          address: b.customerAddress,
          city: b.customerCity,
          state: b.customerState,
          pincode: b.customerPincode,
          customerId: b.customerId,
          source: 'Storage Bill',
        ),
    ];
  }

  // ==========================
  // Raising a bill
  // ==========================

  /// A not-yet-saved bill for [booking], covering the period that
  /// follows whatever has already been billed. The operator can change
  /// every part of it before saving.
  Future<BillModel> draftForBooking(
    StorageBookingModel booking, {
    DateTime? upto,
  }) async {
    final from = StorageChargeCalculator.nextPeriodStart(booking);
    final to = upto ?? DateTime.now();
    final now = DateTime.now();

    final lines = <BillLineModel>[];
    if (booking.rentRate > 0 && !to.isBefore(from)) {
      lines.add(StorageChargeCalculator.line(
        booking,
        id: IdGenerator.generateId(),
        from: from,
        to: to,
      ));
    }

    return BillModel(
      id: IdGenerator.generateId(),
      billDate: now.toIso8601String(),
      bookingId: booking.id,
      bookingNo: booking.bookingNo,
      customerId: booking.customerId,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      customerGst: booking.customerGst,
      customerAddress: booking.customerAddress,
      customerCity: booking.customerCity,
      customerState: booking.customerState,
      customerPincode: booking.customerPincode,
      periodFrom: _isoDate(from),
      periodTo: _isoDate(to),
      dueDate: _isoDate(now.add(const Duration(days: 7))),
      createdAt: '',
      lines: lines,
    );
  }

  static String _isoDate(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-'
      '${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';

  Future<int> _maxSerialInFinancialYear(
    DatabaseExecutor executor,
    int fyStart,
  ) async {
    final rows = await executor.query(
      DatabaseConstants.invoiceTable,
      columns: ['invoice_no'],
      where: 'company_id = ? AND invoice_no LIKE ?',
      whereArgs: [TenantScope.companyId, '%/$fyStart/%'],
    );

    var maxNumber = 0;
    for (final row in rows) {
      final no = row['invoice_no'] as String? ?? '';
      final match = RegExp(r'(\d+)$').firstMatch(no);
      final number = match != null ? int.tryParse(match.group(1)!) ?? 0 : 0;
      if (number > maxNumber) maxNumber = number;
    }
    return maxNumber;
  }

  /// Saves a bill: a new one gets a financial-year-scoped number
  /// allocated atomically, an existing one keeps its number. Saving a
  /// bill raised against a storage record also moves that record's
  /// rent-billed-upto date, so the next bill starts the day after.
  Future<BillModel> saveBill(BillModel bill) async {
    final now = DateTime.now();
    final nowIso = now.toIso8601String();

    final company = await CompanyController.instance.getCompany();
    final companyState = (company?.state ?? '').trim().toLowerCase();
    final customerState = bill.customerState.trim().toLowerCase();
    final interState = companyState.isNotEmpty &&
        customerState.isNotEmpty &&
        companyState != customerState;

    var customerId = bill.customerId;
    try {
      customerId = await CustomerRepository.instance.ensureCustomer(
        name: bill.customerName,
        phone: bill.customerPhone,
        gst: bill.customerGst,
        address: bill.customerAddress,
        city: bill.customerCity,
        state: bill.customerState,
        pincode: bill.customerPincode,
      );
    } catch (_) {
      // The bill must still save even if the master write fails.
    }

    final priced =
        bill.copyWith(customerId: customerId).recalculated(interState: interState);

    final existing = await _dao.getBillById(bill.id);
    if (existing != null) {
      final updated = priced.copyWith(
        billNo: existing.billNo,
        amountPaid: existing.amountPaid,
        createdAt: existing.createdAt,
        lines: [
          for (final line in priced.lines)
            line.copyWith(
              id: line.id.isEmpty ? IdGenerator.generateId() : line.id,
              billId: existing.id,
            ),
        ],
      );
      final restated = updated.copyWith(status: updated.derivedStatus);
      await _db.transaction(
        (txn) => _dao.writeBillWithLines(txn, restated, isNew: false),
      );
      await _syncBookingBilledUpto(restated);
      CustomerLookupService.instance.invalidate();
      return restated;
    }

    const maxAttempts = 5;
    final fyStart = FinancialYear.startYear(now);
    final prefix = (company?.invoicePrefix.isNotEmpty ?? false)
        ? company!.invoicePrefix
        : 'INV';

    var idToUse = priced.id.isEmpty ? IdGenerator.generateId() : priced.id;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        final saved = await _db.transaction((txn) async {
          final serial = await _maxSerialInFinancialYear(txn, fyStart) + attempt;
          final billNo =
              '$prefix/${FinancialYear.documentNumber(date: now, serial: serial)}';

          final withNumber = priced.copyWith(
            id: idToUse,
            billNo: billNo,
            createdAt: priced.createdAt.isEmpty ? nowIso : priced.createdAt,
            lines: [
              for (final line in priced.lines)
                line.copyWith(
                  id: line.id.isEmpty ? IdGenerator.generateId() : line.id,
                  billId: idToUse,
                ),
            ],
          );

          await _dao.writeBillWithLines(txn, withNumber, isNew: true);
          return withNumber;
        });
        await _syncBookingBilledUpto(saved);
        CustomerLookupService.instance.invalidate();
        return saved;
      } on DatabaseException catch (error) {
        final message = error.toString();
        final isUnique = message.contains('UNIQUE constraint failed');
        final isNumberCollision = isUnique && message.contains('invoice_no');
        final isIdCollision = isUnique && message.contains('invoices.id');

        if (isIdCollision && attempt < maxAttempts) {
          idToUse = IdGenerator.generateId();
          continue;
        }
        if (!isNumberCollision || attempt == maxAttempts) rethrow;
      }
    }

    throw StateError('Could not allocate a unique bill number.');
  }

  /// Moves the storage record's rent-billed-upto date to the latest
  /// period any of its bills covers.
  Future<void> _syncBookingBilledUpto(BillModel bill) async {
    if (bill.bookingId.isEmpty) return;

    final bills = await getBillsForBooking(bill.bookingId);
    String latest = '';
    for (final b in bills) {
      if (b.periodTo.isNotEmpty && b.periodTo.compareTo(latest) > 0) {
        latest = b.periodTo;
      }
    }
    await StorageBookingRepository.instance
        .setRentBilledUpto(bill.bookingId, latest);
  }

  Future<void> setBillStatus(String id, BillStatus status) async {
    final existing = await _dao.getBillById(id);
    if (existing == null) return;
    await _dao.updateBillRow(existing.copyWith(status: status));
  }

  /// Deletes a bill and its lines. Receipts that settled it are left in
  /// place but detached, so the money received is never lost - they
  /// become on-account payments against the same customer.
  Future<void> deleteBill(String id) async {
    final bill = await _dao.getBillById(id);
    if (bill == null) return;

    for (final payment in await _dao.getPaymentsForBill(id)) {
      await _dao.updatePayment(payment.copyWith(
        billId: '',
        against: payment.against.isEmpty
            ? 'Received against ${bill.billNo} (bill deleted)'
            : payment.against,
      ));
    }

    await _dao.deleteBill(id);
    if (bill.bookingId.isNotEmpty) {
      await _syncBookingBilledUpto(bill);
    }
    CustomerLookupService.instance.invalidate();
  }

  // ==========================
  // Receiving money
  // ==========================

  Future<int> _maxReceiptSerialInFinancialYear(
    DatabaseExecutor executor,
    int fyStart,
  ) async {
    final rows = await executor.query(
      DatabaseConstants.paymentTable,
      columns: ['receipt_no'],
      where: 'company_id = ? AND receipt_no LIKE ?',
      whereArgs: [TenantScope.companyId, '%/$fyStart/%'],
    );

    var maxNumber = 0;
    for (final row in rows) {
      final no = row['receipt_no'] as String? ?? '';
      final match = RegExp(r'(\d+)$').firstMatch(no);
      final number = match != null ? int.tryParse(match.group(1)!) ?? 0 : 0;
      if (number > maxNumber) maxNumber = number;
    }
    return maxNumber;
  }

  /// Records money received and prints a numbered receipt for it. When
  /// the payment settles a bill, that bill's paid amount and status move
  /// with it.
  Future<PaymentModel> recordPayment(PaymentModel payment) async {
    final now = DateTime.now();
    final nowIso = now.toIso8601String();

    final company = await CompanyController.instance.getCompany();
    final prefix = (company?.receiptPrefix.isNotEmpty ?? false)
        ? company!.receiptPrefix
        : 'MR';

    var customerId = payment.customerId;
    if (customerId.isEmpty && payment.payerName.trim().isNotEmpty) {
      try {
        customerId = await CustomerRepository.instance.ensureCustomer(
          name: payment.payerName,
          phone: payment.payerPhone,
        );
      } catch (_) {}
    }

    const maxAttempts = 5;
    final fyStart = FinancialYear.startYear(now);
    var idToUse = payment.id.isEmpty ? IdGenerator.generateId() : payment.id;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        final saved = await _db.transaction((txn) async {
          final serial =
              await _maxReceiptSerialInFinancialYear(txn, fyStart) + attempt;
          final receiptNo =
              '$prefix/${FinancialYear.documentNumber(date: now, serial: serial)}';

          final withNumber = payment.copyWith(
            id: idToUse,
            receiptNo: receiptNo,
            customerId: customerId,
            createdAt: payment.createdAt.isEmpty ? nowIso : payment.createdAt,
          );

          await _dao.insertPayment(txn, withNumber);
          return withNumber;
        });

        await _restateBill(saved.billId);
        return saved;
      } on DatabaseException catch (error) {
        final message = error.toString();
        final isUnique = message.contains('UNIQUE constraint failed');
        final isNumberCollision = isUnique && message.contains('receipt_no');
        final isIdCollision = isUnique && message.contains('payments.id');

        if (isIdCollision && attempt < maxAttempts) {
          idToUse = IdGenerator.generateId();
          continue;
        }
        if (!isNumberCollision || attempt == maxAttempts) rethrow;
      }
    }

    throw StateError('Could not allocate a unique receipt number.');
  }

  Future<void> updatePayment(PaymentModel payment) async {
    final existing = await _dao.getPaymentById(payment.id);
    await _dao.updatePayment(payment.copyWith(receiptNo: existing?.receiptNo));
    await _restateBill(payment.billId);
    if (existing != null && existing.billId != payment.billId) {
      await _restateBill(existing.billId);
    }
  }

  Future<void> deletePayment(String id) async {
    final payment = await _dao.getPaymentById(id);
    if (payment == null) return;
    await _dao.deletePayment(id);
    await _restateBill(payment.billId);
  }

  /// Recomputes a bill's paid amount and status from its own receipts.
  Future<void> _restateBill(String billId) async {
    if (billId.isEmpty) return;

    final bill = await _dao.getBillById(billId);
    if (bill == null) return;

    final payments = await _dao.getPaymentsForBill(billId);
    final paid = payments
        .where((p) => p.paymentType.settlesDues)
        .fold(0.0, (sum, p) => sum + p.amount);

    final withPaid = bill.copyWith(amountPaid: paid);
    await _dao.updateBillRow(withPaid.copyWith(status: withPaid.derivedStatus));
  }

  // ==========================
  // Balances and statements
  // ==========================

  Future<CustomerBalance> balanceForCustomer(String customerId) async {
    final bills = await getBillsForCustomer(customerId);
    final payments = await getPaymentsForCustomer(customerId);

    var received = 0.0;
    var deposit = 0.0;
    for (final payment in payments) {
      if (payment.paymentType.settlesDues) received += payment.amount;
      if (payment.paymentType.isDepositIn) deposit += payment.amount;
      if (payment.paymentType.lowersDeposit) deposit -= payment.amount;
    }

    return CustomerBalance(
      customerId: customerId,
      customerName: bills.isNotEmpty
          ? bills.first.customerName
          : (payments.isNotEmpty ? payments.first.payerName : ''),
      billed: bills.fold(0.0, (sum, b) => sum + b.grandTotal),
      received: received,
      depositHeld: deposit < 0 ? 0 : deposit,
    );
  }

  /// Bills and receipts for one customer in date order, with a running
  /// balance. This is a business statement, not an accounting ledger.
  Future<List<StatementEntry>> statementForCustomer(
    String customerId, {
    DateTime? from,
    DateTime? to,
  }) async {
    final bills = await getBillsForCustomer(customerId);
    final payments = await getPaymentsForCustomer(customerId);

    final rows = <({String date, StatementEntry entry})>[];

    for (final bill in bills) {
      rows.add((
        date: bill.billDate,
        entry: StatementEntry(
          date: bill.billDate,
          reference: bill.billNo,
          particulars: bill.periodFrom.isEmpty
              ? 'Storage bill'
              : 'Storage bill for ${_short(bill.periodFrom)} to ${_short(bill.periodTo)}',
          debit: bill.grandTotal,
        ),
      ));
    }

    for (final payment in payments) {
      // Deposit taken and deposit returned are the customer's own money
      // moving in and out; they belong on the deposit line, not in the
      // running balance of what is owed.
      if (!payment.paymentType.settlesDues) continue;

      rows.add((
        date: payment.paymentDate,
        entry: StatementEntry(
          date: payment.paymentDate,
          reference: payment.receiptNo,
          particulars: payment.paymentType == PaymentType.depositAdjusted
              ? 'Security deposit adjusted'
              : payment.billId.isEmpty
                  ? (payment.against.trim().isEmpty
                      ? 'Payment received (${payment.mode.label})'
                      : payment.against.trim())
                  : 'Payment received (${payment.mode.label})',
          credit: payment.amount,
        ),
      ));
    }

    rows.sort((a, b) => a.date.compareTo(b.date));

    final entries = <StatementEntry>[];
    var balance = 0.0;
    for (final row in rows) {
      final date = DateTime.tryParse(row.date);
      if (from != null && date != null && date.isBefore(from)) {
        // Before the window: it still moves the opening balance.
        balance += row.entry.debit - row.entry.credit;
        continue;
      }
      if (to != null && date != null && date.isAfter(to)) continue;

      balance += row.entry.debit - row.entry.credit;
      entries.add(StatementEntry(
        date: row.entry.date,
        reference: row.entry.reference,
        particulars: row.entry.particulars,
        debit: row.entry.debit,
        credit: row.entry.credit,
        runningBalance: balance,
      ));
    }

    return entries;
  }

  /// The balance a customer carried into [from] - everything before it.
  Future<double> openingBalance(String customerId, DateTime from) async {
    final bills = await getBillsForCustomer(customerId);
    final payments = await getPaymentsForCustomer(customerId);

    var balance = 0.0;
    for (final bill in bills) {
      final date = DateTime.tryParse(bill.billDate);
      if (date != null && date.isBefore(from)) balance += bill.grandTotal;
    }
    for (final payment in payments) {
      if (!payment.paymentType.settlesDues) continue;
      final date = DateTime.tryParse(payment.paymentDate);
      if (date != null && date.isBefore(from)) balance -= payment.amount;
    }
    return balance;
  }

  static String _short(String iso) {
    final date = DateTime.tryParse(iso);
    if (date == null) return iso;
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${date.day.toString().padLeft(2, '0')} ${months[date.month - 1]} ${date.year}';
  }
}
