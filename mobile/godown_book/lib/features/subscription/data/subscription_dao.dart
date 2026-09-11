import '../../../core/database/database_helper.dart';
import '../models/subscription_model.dart';

/// subscriptions carries company_id but is deliberately NOT in
/// DatabaseConstants.tenantTables (see migrations.dart's own comment
/// above createSubscriptionTable) - Super Admin needs genuine
/// cross-company queries this domain's DAOs must support. Every
/// company-facing method here manually filters by the company_id it's
/// given; only getAllAcrossCompanies() (Super Admin's Dashboard) omits
/// that filter, on purpose.
class SubscriptionDao {
  SubscriptionDao._();

  static final SubscriptionDao instance = SubscriptionDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<SubscriptionModel?> getByCompanyId(String companyId) async {
    final db = await _db.database;

    final data = await db.query(
      'subscriptions',
      where: 'company_id = ?',
      whereArgs: [companyId],
    );

    if (data.isEmpty) return null;

    return SubscriptionModel.fromMap(data.first);
  }

  Future<void> insert(SubscriptionModel subscription) async {
    final db = await _db.database;

    await db.insert('subscriptions', subscription.toMap());
  }

  Future<void> update(SubscriptionModel subscription) async {
    final db = await _db.database;

    await db.update(
      'subscriptions',
      subscription.toMap(),
      where: 'id = ?',
      whereArgs: [subscription.id],
    );
  }

  /// Super Admin only - every company's subscription, unfiltered. The
  /// one legitimate place in this DAO with no company_id WHERE clause.
  Future<List<SubscriptionModel>> getAllAcrossCompanies() async {
    final db = await _db.database;

    final data = await db.query('subscriptions', orderBy: 'updated_at DESC');

    return data.map((e) => SubscriptionModel.fromMap(e)).toList();
  }
}
