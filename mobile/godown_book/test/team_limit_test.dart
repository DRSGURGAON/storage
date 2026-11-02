import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/subscription/super_admin_scope.dart';
import 'package:godown_book/core/tenant/tenant_scope.dart';
import 'package:godown_book/features/subscription/models/subscription_plan_model.dart';
import 'package:godown_book/features/subscription/repositories/subscription_repository.dart';
import 'package:godown_book/features/subscription/repositories/subscription_settings_repository.dart';
import 'package:godown_book/features/users/repositories/role_repository.dart';
import 'package:godown_book/features/users/repositories/user_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

const _yearly = SubscriptionPlanModel(
  id: 'PLAN_YEARLY',
  code: 'PLAN_YEARLY',
  name: 'Yearly',
  durationMonths: 12,
  price: 2499,
);

void main() {
  late Database db;
  final users = UserRepository.instance;

  setUp(() async {
    db = await openTestDatabase();
    SubscriptionRepository.firestoreOverride = FakeFirebaseFirestore();
    SubscriptionRepository.currentUidOverride = 'uid-test';
    // Both activating a plan and publishing Limited-mode settings are
    // Super Admin actions; UserRepository's own checks (team size,
    // usersCreate permission) are not, and run as the unmanaged-admin
    // default the same way the rest of the app does in a test.
    SuperAdminScope.overrideForTesting(true);
  });

  tearDown(() async {
    SubscriptionRepository.firestoreOverride = null;
    SubscriptionRepository.currentUidOverride = null;
    SuperAdminScope.overrideForTesting(null);
    await db.close();
  });

  Future<String> firstRoleId() async =>
      (await RoleRepository.instance.getAll()).first.id;

  test('an unsubscribed company is owner-only by default', () async {
    await SubscriptionRepository.instance.getOrCreateForCompany(TenantScope.companyId);

    expect(await users.teamLimit(), 1);
    expect(await users.activeTeamSize(), 1);

    final roleId = await firstRoleId();
    expect(
      () => users.createUser(name: 'Staff A', mobileNumber: '9000000001', roleId: roleId),
      throwsA(isA<TeamLimitExceededException>()),
    );
  });

  test('the Super Admin can raise the free team size', () async {
    await SubscriptionRepository.instance.getOrCreateForCompany(TenantScope.companyId);
    final settings = await SubscriptionSettingsRepository.instance.get();
    await SubscriptionSettingsRepository.instance
        .save(settings.copyWith(teamUserLimitFree: 3));

    final roleId = await firstRoleId();
    await users.createUser(name: 'Staff A', mobileNumber: '9000000001', roleId: roleId);
    await users.createUser(name: 'Staff B', mobileNumber: '9000000002', roleId: roleId);
    expect(await users.activeTeamSize(), 3);

    expect(
      () => users.createUser(name: 'Staff C', mobileNumber: '9000000003', roleId: roleId),
      throwsA(isA<TeamLimitExceededException>()),
    );
  });

  test('subscribing raises the limit to the paid team size', () async {
    await SubscriptionRepository.instance.getOrCreateForCompany(TenantScope.companyId);
    await SubscriptionRepository.instance.activate(
      companyId: TenantScope.companyId,
      plan: _yearly,
      paymentReference: 'UTR000001',
      paymentMethod: 'MANUAL_UPI',
      authorizedByMobileNumber: '9999999999',
      explicitStartDate: DateTime(2026, 1, 1),
    );

    // Default paid limit is 5 (owner included).
    expect(await users.teamLimit(), 5);

    final roleId = await firstRoleId();
    for (var i = 1; i <= 4; i++) {
      await users.createUser(
        name: 'Staff $i',
        mobileNumber: '900000000$i',
        roleId: roleId,
      );
    }
    expect(await users.activeTeamSize(), 5);
  });

  test('a lower limit deactivates the most recently added members first',
      () async {
    await SubscriptionRepository.instance.getOrCreateForCompany(TenantScope.companyId);
    final settings = await SubscriptionSettingsRepository.instance.get();
    await SubscriptionSettingsRepository.instance
        .save(settings.copyWith(teamUserLimitFree: 4));

    final roleId = await firstRoleId();
    await users.createUser(name: 'First', mobileNumber: '9000000001', roleId: roleId);
    await users.createUser(name: 'Second', mobileNumber: '9000000002', roleId: roleId);
    await users.createUser(name: 'Third', mobileNumber: '9000000003', roleId: roleId);
    expect(await users.activeTeamSize(), 4);

    // The plan the company is actually on only covers 2, owner
    // included - as if the subscription had lapsed to a smaller
    // allowance.
    final lowered = await SubscriptionSettingsRepository.instance.get();
    await SubscriptionSettingsRepository.instance
        .save(lowered.copyWith(teamUserLimitFree: 2));

    await users.enforceTeamLimit();

    final active = (await users.getAll()).where((u) => u.isActive).toList();
    expect(active, hasLength(1));
    expect(active.single.name, 'First');
    expect(await users.activeTeamSize(), 2);

    // Deactivated, not deleted.
    final all = await users.getAll();
    expect(all, hasLength(3));
    expect(all.where((u) => !u.isActive).map((u) => u.name),
        containsAll(['Second', 'Third']));
  });
}
