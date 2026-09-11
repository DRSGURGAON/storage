import '../../../core/database/database_helper.dart';
import '../models/subscription_plan_model.dart';

/// Platform-wide - deliberately does NOT use the *Scoped helpers
/// (subscription_plans has no company_id at all; see the model's own
/// doc comment). Direct database access via DatabaseHelper.database is
/// the correct, intentional pattern here, not an oversight.
class SubscriptionPlanDao {
  SubscriptionPlanDao._();

  static final SubscriptionPlanDao instance = SubscriptionPlanDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<List<SubscriptionPlanModel>> getAll({bool activeOnly = false}) async {
    final db = await _db.database;

    final data = await db.query('subscription_plans', orderBy: 'sort_order ASC');
    final plans = data.map((e) => SubscriptionPlanModel.fromMap(e)).toList();

    if (!activeOnly) return plans;

    return plans.where((p) => p.isActive).toList();
  }

  Future<SubscriptionPlanModel?> getById(String id) async {
    final db = await _db.database;

    final data = await db.query(
      'subscription_plans',
      where: 'id = ?',
      whereArgs: [id],
    );

    if (data.isEmpty) return null;

    return SubscriptionPlanModel.fromMap(data.first);
  }

  Future<void> update(SubscriptionPlanModel plan) async {
    final db = await _db.database;

    await db.update(
      'subscription_plans',
      plan.toMap(),
      where: 'id = ?',
      whereArgs: [plan.id],
    );
  }

  /// Clears is_recommended on every other plan before setting it on
  /// [planId] - keeps "at most one recommended plan" true without a
  /// database-level constraint (SQLite has no partial-unique-index
  /// short syntax worth adding for a single boolean flag here).
  Future<void> setRecommended(String planId) async {
    final db = await _db.database;

    await db.transaction((txn) async {
      await txn.update('subscription_plans', {'is_recommended': 0});
      await txn.update(
        'subscription_plans',
        {'is_recommended': 1},
        where: 'id = ?',
        whereArgs: [planId],
      );
    });
  }
}
