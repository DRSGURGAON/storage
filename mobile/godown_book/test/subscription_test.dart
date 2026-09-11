import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/subscription/document_type.dart';
import 'package:godown_book/core/subscription/sample_documents.dart';
import 'package:godown_book/core/subscription/subscription_access_service.dart';
import 'package:godown_book/core/subscription/subscription_status.dart';
import 'package:godown_book/core/subscription/super_admin_scope.dart';
import 'package:godown_book/core/tenant/tenant_scope.dart';
import 'package:godown_book/features/subscription/repositories/subscription_repository.dart';
import 'package:godown_book/features/subscription/repositories/subscription_settings_repository.dart';
import 'package:godown_book/features/subscription/models/subscription_plan_model.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

const _quarterly = SubscriptionPlanModel(
  id: 'PLAN_QUARTERLY',
  code: 'PLAN_QUARTERLY',
  name: 'Quarterly',
  durationMonths: 3,
  price: 699,
);

void main() {
  late Database db;
  final repo = SubscriptionRepository.instance;
  final access = SubscriptionAccessService.instance;

  setUp(() async {
    db = await openTestDatabase();
    SubscriptionRepository.firestoreOverride = FakeFirebaseFirestore();
    SubscriptionRepository.currentUidOverride = 'uid-test';
    SuperAdminScope.overrideForTesting(true);
  });

  tearDown(() async {
    SubscriptionRepository.firestoreOverride = null;
    SubscriptionRepository.currentUidOverride = null;
    SuperAdminScope.overrideForTesting(null);
    await db.close();
  });

  test('a new company starts limited, with no free copies used', () async {
    final subscription = await repo.getOrCreateForCompany(TenantScope.companyId);

    expect(subscription.status, SubscriptionStatus.limited);
    expect(subscription.ownerUid, 'uid-test');
    expect(await access.isSubscriptionActive(), isFalse);
    expect(await access.isLimitedMode(), isTrue);
  });

  test('the free allowance is two per document type, counted separately', () async {
    final settings = await SubscriptionSettingsRepository.instance.get();
    expect(settings.demoGenerationLimit, 2);

    expect(await access.getRemainingDemoGenerations(DocumentType.bill), 2);

    await access.recordDemoGeneration(DocumentType.bill);
    expect(await access.getRemainingDemoGenerations(DocumentType.bill), 1);
    // A different document type keeps its own count.
    expect(await access.getRemainingDemoGenerations(DocumentType.quotation), 2);

    await access.recordDemoGeneration(DocumentType.bill);
    expect(await access.getRemainingDemoGenerations(DocumentType.bill), 0);

    // Never goes negative, even if a caller records one more.
    await access.recordDemoGeneration(DocumentType.bill);
    expect(await access.getRemainingDemoGenerations(DocumentType.bill), 0);
    expect(await access.getRemainingDemoGenerations(DocumentType.storageReceipt), 2);
  });

  test('the limit follows the Super Admin setting, never a number in a screen',
      () async {
    final settings = await SubscriptionSettingsRepository.instance.get();
    await SubscriptionSettingsRepository.instance
        .save(settings.copyWith(demoGenerationLimit: 5));

    expect(await access.getRemainingDemoGenerations(DocumentType.quotation), 5);

    await access.recordDemoGeneration(DocumentType.quotation);
    expect(await access.getRemainingDemoGenerations(DocumentType.quotation), 4);
  });

  test('activating a subscription unlocks unlimited documents', () async {
    await repo.getOrCreateForCompany(TenantScope.companyId);
    await access.recordDemoGeneration(DocumentType.bill);
    await access.recordDemoGeneration(DocumentType.bill);
    expect(await access.getRemainingDemoGenerations(DocumentType.bill), 0);

    final activated = await repo.activate(
      companyId: TenantScope.companyId,
      plan: _quarterly,
      paymentReference: 'UTR123456',
      paymentMethod: 'MANUAL_UPI',
      authorizedByMobileNumber: '9999999999',
      explicitStartDate: DateTime(2026, 9, 1),
    );

    expect(activated.status, SubscriptionStatus.active);
    expect(DateTime.parse(activated.startDate!), DateTime(2026, 9, 1));
    // Three months from 1 September runs to the last day of November.
    expect(DateTime.parse(activated.expiryDate!), DateTime(2026, 11, 30));
    expect(await access.isSubscriptionActive(), isTrue);
    expect(await access.canGenerateDocument(DocumentType.bill), isTrue);
  });

  test('renewing runs from the day after the current expiry', () async {
    await repo.activate(
      companyId: TenantScope.companyId,
      plan: _quarterly,
      paymentReference: 'UTR1',
      paymentMethod: 'MANUAL_UPI',
      authorizedByMobileNumber: '9999999999',
      explicitStartDate: DateTime(2026, 9, 1),
    );

    final renewed = await repo.activate(
      companyId: TenantScope.companyId,
      plan: _quarterly,
      paymentReference: 'UTR2',
      paymentMethod: 'MANUAL_UPI',
      authorizedByMobileNumber: '9999999999',
    );

    // The first period is kept; only the expiry moves out by a term,
    // starting the day after the old expiry.
    expect(DateTime.parse(renewed.startDate!), DateTime(2026, 9, 1));
    expect(DateTime.parse(renewed.expiryDate!), DateTime(2027, 2, 28));

    final history = await repo.getHistory(TenantScope.companyId);
    expect(history.length, 2);
    expect(history.map((h) => h.paymentReference), containsAll(['UTR1', 'UTR2']));
  });

  test('a lapsed subscription stops granting access and is marked expired',
      () async {
    await repo.activate(
      companyId: TenantScope.companyId,
      plan: _quarterly,
      paymentReference: 'UTR1',
      paymentMethod: 'MANUAL_UPI',
      authorizedByMobileNumber: '9999999999',
      explicitStartDate: DateTime(2024, 1, 1),
    );

    expect(await access.isSubscriptionActive(), isFalse);
    expect(await access.getRemainingDemoGenerations(DocumentType.bill), 2);

    final reloaded = await repo.getOrCreateForCompany(TenantScope.companyId);
    expect(reloaded.status, SubscriptionStatus.expired);
  });

  group('samples', () {
    test('exist for every document a customer is shown', () {
      for (final type in DocumentType.all) {
        if (type == DocumentType.letterHead) continue;
        expect(SampleDocuments.has(type), isTrue, reason: type);
      }
      expect(SampleDocuments.has(DocumentType.letterHead), isFalse);
    });

    test('render, are marked SAMPLE, and touch no real record', () async {
      // A company with nothing of its own saved: the sample still
      // prints, on a stand-in letterhead.
      for (final type in DocumentType.all.where(SampleDocuments.has)) {
        final bytes = await SampleDocuments.build(type, null);
        expect(String.fromCharCodes(bytes.take(5)), '%PDF-', reason: type);
        expect(bytes.length, greaterThan(1000), reason: type);
      }

      expect(SampleDocuments.watermark, 'SAMPLE');

      // Nothing was written anywhere.
      for (final table in [
        'customers',
        'quotations',
        'storage_bookings',
        'invoices',
        'payments',
        'goods_releases',
      ]) {
        expect(await db.query(table), isEmpty, reason: table);
      }

      // And no free copy was used.
      expect(await access.getRemainingDemoGenerations(DocumentType.bill), 2);
    });
  });
}
