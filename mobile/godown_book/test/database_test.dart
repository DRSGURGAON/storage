import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/database/app_database.dart';
import 'package:godown_book/core/database/database_constants.dart';
import 'package:godown_book/core/database/database_helper.dart';
import 'package:godown_book/core/permissions/permission.dart';
import 'package:godown_book/core/tenant/tenant_migrator.dart';
import 'package:godown_book/core/tenant/tenant_scope.dart';
import 'package:godown_book/features/master/repositories/charge_head_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

void main() {
  late Database db;

  setUp(() async {
    db = await openTestDatabase();
  });

  tearDown(() async {
    await db.close();
  });

  test('creates every table the app reads', () async {
    final rows = await db.rawQuery(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    final names = rows.map((r) => r['name']).toSet();

    for (final table in DatabaseConstants.tenantTables) {
      expect(names, contains(table), reason: '$table missing');
    }
    for (final table in [
      DatabaseConstants.companyTable,
      'subscription_plans',
      'subscriptions',
      'payment_transactions',
      'payment_proofs',
      'subscription_history',
      'subscription_settings',
      'super_admins',
      DatabaseConstants.cloudSyncStateTable,
    ]) {
      expect(names, contains(table), reason: '$table missing');
    }
  });

  test('every tenant table carries a company_id column', () async {
    for (final table in DatabaseConstants.tenantTables) {
      final columns = await db.rawQuery('PRAGMA table_info($table)');
      final columnNames = columns.map((c) => c['name']).toSet();
      expect(columnNames, contains('company_id'), reason: table);
    }
  });

  test('seeds charge heads, roles, plans and settings', () async {
    expect(
      (await db.query('charge_heads')).length,
      10,
    );
    final storageRent = await db.query(
      'charge_heads',
      where: 'code = ?',
      whereArgs: ['CHG001'],
    );
    expect(storageRent.single['charge_name'], 'Storage Rent');
    expect(storageRent.single['is_system'], 1);

    final roles = await db.query('roles', orderBy: 'sort_order');
    expect(roles.map((r) => r['code']), [
      'ROLE_COMPANY_ADMIN',
      'ROLE_MANAGER',
      'ROLE_GODOWN_STAFF',
      'ROLE_ACCOUNTS',
      'ROLE_STAFF',
    ]);

    final adminGrants = await db.query(
      'role_permissions',
      where: 'role_id = ?',
      whereArgs: ['ROLE_COMPANY_ADMIN'],
    );
    expect(
      adminGrants.map((g) => g['permission_code']).toSet(),
      Permission.values.map((p) => p.code).toSet(),
    );

    // Every seeded grant names a real permission - a stale code here
    // would silently grant nothing.
    final allGrants = await db.query('role_permissions');
    for (final grant in allGrants) {
      expect(
        Permission.fromCode(grant['permission_code'] as String),
        isNotNull,
        reason: '${grant['role_id']} grants unknown ${grant['permission_code']}',
      );
    }

    final plans = await db.query('subscription_plans', orderBy: 'sort_order');
    expect(plans.map((p) => p['price']), [699.0, 1399.0, 2699.0, 5299.0]);
    expect(
      plans.where((p) => p['is_recommended'] == 1).single['code'],
      'PLAN_YEARLY',
    );

    final settings = await db.query('subscription_settings');
    expect(settings.single['demo_generation_limit'], 3);
    expect(settings.single['watermark_text'], 'DEMO - UNLICENSED COPY');
  });

  test('seeding again does not duplicate rows', () async {
    Future<List<int>> counts() async => [
          (await db.query('charge_heads')).length,
          (await db.query('roles')).length,
          (await db.query('role_permissions')).length,
          (await db.query('subscription_plans')).length,
          (await db.query('subscription_settings')).length,
        ];
    final before = await counts();

    // onCreate already ran every seed; an upgrade step re-running them
    // must leave every count unchanged.
    final app = AppDatabase.instance;
    await app.seedChargeHeads(db);
    await app.seedDefaultRoles(db);
    await app.seedSubscriptionPlans(db);
    await app.seedSubscriptionSettings(db);

    expect(await counts(), before);
  });

  test('scoped helpers never cross companies', () async {
    final helper = DatabaseHelper.instance;

    TenantScope.set('company-a');
    await helper.insertScoped('customers', {
      'id': 'c1',
      'customer_name': 'Alpha Traders',
      'created_at': '2026-09-01T00:00:00',
    });

    TenantScope.set('company-b');
    await helper.insertScoped('customers', {
      'id': 'c2',
      'customer_name': 'Beta Stores',
      'created_at': '2026-09-01T00:00:00',
    });

    expect(
      (await helper.queryScoped('customers')).map((r) => r['id']),
      ['c2'],
    );

    // A scoped update/delete on another company's row is a no-op.
    expect(await helper.updateScoped('customers', {'city': 'X'}, 'c1'), 0);
    expect(await helper.deleteScoped('customers', 'c1'), 0);

    TenantScope.set('company-a');
    expect(
      (await helper.queryScoped('customers')).map((r) => r['id']),
      ['c1'],
    );
  });

  test('seeded rows are claimed by the first company', () async {
    TenantScope.set('company-first');
    // Charge heads are seeded before any company exists (company_id '').
    expect(await ChargeHeadRepository.instance.getAll(), isEmpty);

    final claimed = await TenantMigrator.claimUnassignedRows('company-first');
    expect(claimed, greaterThanOrEqualTo(10));

    expect((await ChargeHeadRepository.instance.getAll()).length, 10);
  });
}
