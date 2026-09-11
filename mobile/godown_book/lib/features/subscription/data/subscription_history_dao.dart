import '../../../core/database/database_helper.dart';
import '../models/subscription_history_model.dart';

class SubscriptionHistoryDao {
  SubscriptionHistoryDao._();

  static final SubscriptionHistoryDao instance = SubscriptionHistoryDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<void> insert(SubscriptionHistoryModel history) async {
    final db = await _db.database;

    await db.insert('subscription_history', history.toMap());
  }

  Future<List<SubscriptionHistoryModel>> getByCompanyId(
    String companyId,
  ) async {
    final db = await _db.database;

    final data = await db.query(
      'subscription_history',
      where: 'company_id = ?',
      whereArgs: [companyId],
      orderBy: 'authorization_date DESC',
    );

    return data.map((e) => SubscriptionHistoryModel.fromMap(e)).toList();
  }
}
