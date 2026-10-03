import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/subscription/platform_audit_log_service.dart';
import 'package:godown_book/core/subscription/super_admin_scope.dart';
import 'package:godown_book/features/subscription/repositories/subscription_plan_repository.dart';
import 'package:godown_book/features/subscription/services/platform_plans_service.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

/// Plan prices are the Super Admin's, not each device's: what the
/// Super Admin saves has to reach every company's install, and a
/// device that cannot reach it has to keep showing the seeded launch
/// prices rather than zero.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Database db;
  late FakeFirebaseFirestore cloud;
  final repo = SubscriptionPlanRepository.instance;

  setUp(() async {
    db = await openTestDatabase();
    cloud = FakeFirebaseFirestore();
    PlatformPlansService.firestoreOverride = cloud;
    PlatformAuditLogService.firestoreOverride = cloud;
    PlatformAuditLogService.currentUidOverride = 'uid-admin';
    SuperAdminScope.overrideForTesting(true);
    SubscriptionPlanRepository.resetPublishedPriceSync();
  });

  tearDown(() async {
    PlatformPlansService.firestoreOverride = null;
    PlatformAuditLogService.firestoreOverride = null;
    PlatformAuditLogService.currentUidOverride = null;
    SuperAdminScope.overrideForTesting(null);
    await db.close();
  });

  Future<double> priceOf(String code) async {
    final plans = await repo.getAllPlans();
    return plans.firstWhere((p) => p.code == code).price;
  }

  group('what the Super Admin saves', () {
    test('a price change is published for every company to read', () async {
      final quarterly = (await repo.getAllPlans())
          .firstWhere((p) => p.code == 'PLAN_QUARTERLY');

      await repo.updatePlan(quarterly.copyWith(price: 899, taxPercent: 18));

      final published = await PlatformPlansService.instance.fetch();
      final shared =
          published!.firstWhere((p) => p.code == 'PLAN_QUARTERLY');
      expect(shared.price, 899);
      expect(shared.taxPercent, 18);
    });

    test('publishing is written to the platform audit log', () async {
      final yearly =
          (await repo.getAllPlans()).firstWhere((p) => p.code == 'PLAN_YEARLY');

      await repo.updatePlan(yearly.copyWith(price: 3499));

      final audit = await cloud.collection('platformAuditLogs').get();
      expect(
        audit.docs.map((d) => d.data()['action']),
        contains(PlatformAuditAction.platformPlansPublished),
      );
    });

    test('nobody but a Super Admin can change a price', () async {
      SuperAdminScope.overrideForTesting(false);
      final quarterly = (await repo.getAllPlans())
          .firstWhere((p) => p.code == 'PLAN_QUARTERLY');

      await expectLater(
        repo.updatePlan(quarterly.copyWith(price: 1)),
        throwsA(isA<SuperAdminRequiredException>()),
      );
      expect(await PlatformPlansService.instance.fetch(), isNull);
    });
  });

  group('what another company\'s install shows', () {
    test('the published price replaces the seeded one', () async {
      await cloud.doc(PlatformPlansService.docPath).set({
        'plans': [
          {'code': 'PLAN_QUARTERLY', 'price': 999, 'taxPercent': 18},
        ],
      });

      expect(await priceOf('PLAN_QUARTERLY'), 999);
      final quarterly = (await repo.getAllPlans())
          .firstWhere((p) => p.code == 'PLAN_QUARTERLY');
      expect(quarterly.taxPercent, 18);
    });

    test('nothing published: the seeded launch prices stand', () async {
      expect(await priceOf('PLAN_QUARTERLY'), 699);
      expect(await priceOf('PLAN_YEARLY'), 2699);
    });

    test('a plan the document never mentions keeps its own price', () async {
      await cloud.doc(PlatformPlansService.docPath).set({
        'plans': [
          {'code': 'PLAN_QUARTERLY', 'price': 999},
        ],
      });

      expect(await priceOf('PLAN_YEARLY'), 2699);
    });

    test('a plan this install has never seeded is ignored', () async {
      await cloud.doc(PlatformPlansService.docPath).set({
        'plans': [
          {'code': 'PLAN_FROM_A_NEWER_APP', 'price': 1},
          {'code': 'PLAN_YEARLY', 'price': 3999},
        ],
      });

      final plans = await repo.getAllPlans();
      expect(plans.map((p) => p.code), isNot(contains('PLAN_FROM_A_NEWER_APP')));
      expect(plans.firstWhere((p) => p.code == 'PLAN_YEARLY').price, 3999);
    });

    test('the published recommendation moves the highlight', () async {
      await cloud.doc(PlatformPlansService.docPath).set({
        'plans': [
          {'code': 'PLAN_QUARTERLY', 'price': 699, 'isRecommended': true},
          {'code': 'PLAN_YEARLY', 'price': 2699},
        ],
      });

      final plans = await repo.getAllPlans();
      expect(
        plans.where((p) => p.isRecommended).map((p) => p.code),
        ['PLAN_QUARTERLY'],
        reason: 'exactly one plan is ever highlighted',
      );
    });

    test('an unreachable document leaves the seeded prices alone', () async {
      PlatformPlansService.firestoreOverride = null; // no Firebase in a test
      expect(await priceOf('PLAN_QUARTERLY'), 699);
    });
  });

  group('a published value that would price a plan wrongly', () {
    Future<void> publishRaw(Map<String, Object?> plan) =>
        cloud.doc(PlatformPlansService.docPath).set({
          'plans': [plan],
        });

    test('a negative price is rejected', () async {
      await publishRaw({'code': 'PLAN_QUARTERLY', 'price': -1});
      expect(await priceOf('PLAN_QUARTERLY'), 699);
    });

    test('a discount larger than the price is rejected', () async {
      await publishRaw({
        'code': 'PLAN_QUARTERLY',
        'price': 500,
        'discountAmount': 900,
      });
      expect(await priceOf('PLAN_QUARTERLY'), 699);
    });

    test('a tax above 100% is rejected', () async {
      await publishRaw({
        'code': 'PLAN_QUARTERLY',
        'price': 500,
        'taxPercent': 180,
      });
      expect(await priceOf('PLAN_QUARTERLY'), 699);
    });

    test('a missing price is rejected, not read as free', () async {
      await publishRaw({'code': 'PLAN_QUARTERLY'});
      expect(await priceOf('PLAN_QUARTERLY'), 699);
    });

    test('a malformed entry does not stop the valid ones', () async {
      await cloud.doc(PlatformPlansService.docPath).set({
        'plans': [
          'not a plan at all',
          {'price': 10},
          {'code': 'PLAN_YEARLY', 'price': 3999},
        ],
      });

      expect(await priceOf('PLAN_YEARLY'), 3999);
    });
  });
}
