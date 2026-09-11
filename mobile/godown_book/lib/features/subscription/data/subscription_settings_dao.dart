import 'package:sqflite/sqflite.dart';

import '../../../core/database/database_helper.dart';
import '../models/subscription_settings_model.dart';

class SubscriptionSettingsDao {
  SubscriptionSettingsDao._();

  static final SubscriptionSettingsDao instance =
      SubscriptionSettingsDao._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  Future<SubscriptionSettingsModel> get() async {
    final db = await _db.database;

    final data = await db.query(
      'subscription_settings',
      where: 'id = ?',
      whereArgs: ['DEFAULT'],
    );

    if (data.isEmpty) {
      return SubscriptionSettingsModel(updatedAt: DateTime.now().toIso8601String());
    }

    return SubscriptionSettingsModel.fromMap(data.first);
  }

  Future<void> save(SubscriptionSettingsModel settings) async {
    final db = await _db.database;

    await db.insert(
      'subscription_settings',
      settings.toMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }
}
