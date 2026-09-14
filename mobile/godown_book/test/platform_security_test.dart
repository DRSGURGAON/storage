import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/subscription/document_type.dart';
import 'package:godown_book/core/subscription/platform_audit_log_service.dart';
import 'package:godown_book/core/subscription/subscription_access_service.dart';
import 'package:godown_book/core/subscription/super_admin_scope.dart';
import 'package:godown_book/features/subscription/models/subscription_model.dart';
import 'package:godown_book/features/subscription/repositories/subscription_repository.dart';
import 'package:godown_book/features/subscription/services/super_admin_firestore_service.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

/// The app side of the production security model: Super Admin is the
/// ID-token claim and nothing else, the free-copy counters travel as a
/// map the rules can check, and privileged actions leave an audit
/// entry.
void main() {
  group('SuperAdminScope', () {
    tearDown(() {
      SuperAdminScope.claimsOverride = null;
      SuperAdminScope.clear();
    });

    test('only the superadmin claim grants access', () {
      expect(SuperAdminScope.grantsSuperAdmin({'role': 'superadmin'}), isTrue);
      expect(SuperAdminScope.grantsSuperAdmin({'role': 'admin'}), isFalse);
      expect(SuperAdminScope.grantsSuperAdmin({'superadmin': true}), isFalse);
      expect(SuperAdminScope.grantsSuperAdmin({}), isFalse);
      expect(SuperAdminScope.grantsSuperAdmin(null), isFalse);
    });

    test('refresh reads the token claims and a failed read denies', () async {
      SuperAdminScope.claimsOverride = () async => {'role': 'superadmin'};
      await SuperAdminScope.refresh();
      expect(SuperAdminScope.isSuperAdmin, isTrue);

      SuperAdminScope.clear();
      SuperAdminScope.claimsOverride = () async => {'role': 'user'};
      await SuperAdminScope.refresh();
      expect(SuperAdminScope.isSuperAdmin, isFalse);

      SuperAdminScope.clear();
      SuperAdminScope.claimsOverride = () async => null;
      await SuperAdminScope.refresh();
      expect(SuperAdminScope.isSuperAdmin, isFalse);
    });

    test('the app can never grant Super Admin from a phone', () async {
      final service = SuperAdminFirestoreService.instance;
      expect(await service.canBootstrap(), isFalse);
      expect(
        () => service.bootstrapFirstSuperAdmin(mobileNumber: '9999999999'),
        throwsUnsupportedError,
      );
      expect(
        () => service.add(uid: 'x', mobileNumber: '9999999999'),
        throwsUnsupportedError,
      );
    });
  });

  group('free-copy counters', () {
    test('travel as a map next to the legacy JSON, and the map wins on read', () {
      const model = SubscriptionModel(
        id: 's',
        companyId: 'c',
        demoGenerationsUsedJson: '{"bill":2,"quotation":1}',
        createdAt: '',
        updatedAt: '',
      );
      final cloud = model.toFirestore();
      expect(cloud['demoGenerationsUsed'], {'bill': 2, 'quotation': 1});
      expect(cloud['demoGenerationsUsedJson'], '{"bill":2,"quotation":1}');

      final back = SubscriptionModel.fromFirestore({
        ...cloud,
        // A tampered legacy string is ignored when the protected map exists.
        'demoGenerationsUsedJson': '{}',
      }, 'c');
      expect(back.demoGenerationsUsed, {'bill': 2, 'quotation': 1});

      final legacy = SubscriptionModel.fromFirestore({
        'companyId': 'c',
        'demoGenerationsUsedJson': '{"bill":1}',
      }, 'c');
      expect(legacy.demoGenerationsUsed, {'bill': 1});
    });
  });

  group('privileged actions', () {
    late Database db;
    late FakeFirebaseFirestore cloud;

    setUp(() async {
      db = await openTestDatabase();
      cloud = FakeFirebaseFirestore();
      SubscriptionRepository.firestoreOverride = cloud;
      SubscriptionRepository.currentUidOverride = 'uid-admin';
      PlatformAuditLogService.firestoreOverride = cloud;
      PlatformAuditLogService.currentUidOverride = 'uid-admin';
      PlatformAuditLogService.recorded.clear();
      SuperAdminScope.overrideForTesting(true);
    });

    tearDown(() async {
      SubscriptionRepository.firestoreOverride = null;
      SubscriptionRepository.currentUidOverride = null;
      PlatformAuditLogService.firestoreOverride = null;
      PlatformAuditLogService.currentUidOverride = null;
      SuperAdminScope.overrideForTesting(null);
      await db.close();
    });

    test('suspending a subscription writes a platform audit entry', () async {
      final repo = SubscriptionRepository.instance;
      await repo.getOrCreateForCompany('company-test');
      await repo.suspend('company-test', remarks: 'Non-payment');

      final entries = await cloud.collection('platformAuditLogs').get();
      expect(entries.docs, hasLength(1));
      final entry = entries.docs.single.data();
      expect(entry['actorUid'], 'uid-admin');
      expect(entry['action'], PlatformAuditAction.subscriptionSuspended);
      expect(entry['targetCompanyId'], 'company-test');
      expect(entry['metadata'], {'remarks': 'Non-payment'});
      expect(entry['createdAt'], isNotNull);

      // The counters the company already used stay exactly as they were.
      expect(
        await SubscriptionAccessService.instance
            .getRemainingDemoGenerations(DocumentType.bill),
        2,
      );
    });

    test('nothing is written when nobody is signed in', () async {
      PlatformAuditLogService.currentUidOverride = '';
      await PlatformAuditLogService.instance.record(action: 'X');
      expect((await cloud.collection('platformAuditLogs').get()).docs, isEmpty);
    });
  });
}
