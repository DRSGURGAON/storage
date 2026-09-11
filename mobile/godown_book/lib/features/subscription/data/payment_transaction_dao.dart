import '../../../core/database/database_helper.dart';
import '../models/payment_transaction_model.dart';

/// Same deliberate non-scoped pattern as SubscriptionDao - see that
/// file's own doc comment for why.
class PaymentTransactionDao {
  PaymentTransactionDao._();

  static final PaymentTransactionDao instance = PaymentTransactionDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<List<PaymentTransactionModel>> getByCompanyId(
    String companyId,
  ) async {
    final db = await _db.database;

    final data = await db.query(
      'payment_transactions',
      where: 'company_id = ?',
      whereArgs: [companyId],
      orderBy: 'created_at DESC',
    );

    return data.map((e) => PaymentTransactionModel.fromMap(e)).toList();
  }

  Future<PaymentTransactionModel?> getById(String id) async {
    final db = await _db.database;

    final data = await db.query(
      'payment_transactions',
      where: 'id = ?',
      whereArgs: [id],
    );

    if (data.isEmpty) return null;

    return PaymentTransactionModel.fromMap(data.first);
  }

  Future<void> insert(PaymentTransactionModel transaction) async {
    final db = await _db.database;

    await db.insert('payment_transactions', transaction.toMap());
  }

  Future<void> update(PaymentTransactionModel transaction) async {
    final db = await _db.database;

    await db.update(
      'payment_transactions',
      transaction.toMap(),
      where: 'id = ?',
      whereArgs: [transaction.id],
    );
  }

  /// Super Admin's Payment Verification Queue (Section 15) - every
  /// company's transactions with a given status, unfiltered by company.
  Future<List<PaymentTransactionModel>> getAllByStatus(String status) async {
    final db = await _db.database;

    final data = await db.query(
      'payment_transactions',
      where: 'status = ?',
      whereArgs: [status],
      orderBy: 'created_at ASC',
    );

    return data.map((e) => PaymentTransactionModel.fromMap(e)).toList();
  }
}
