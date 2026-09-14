import 'dart:typed_data';

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/constants/platform_defaults.dart';
import 'package:godown_book/core/subscription/platform_audit_log_service.dart';
import 'package:godown_book/features/subscription/models/subscription_settings_model.dart';
import 'package:godown_book/features/subscription/services/platform_settings_service.dart';

/// The payment details a customer sees: shipped with the app so they
/// show on day one and offline, replaced by whatever the Super Admin
/// publishes, and never a company's own UPI.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

  group('what ships in the app', () {
    test('a UPI ID, a payee and a ten-digit support number', () {
      expect(PlatformDefaults.upiId, contains('@'));
      expect(PlatformDefaults.merchantName, isNotEmpty);
      expect(PlatformDefaults.supportPhone, matches(RegExp(r'^\d{10}$')));
      expect(PlatformDefaults.whatsappNumber, matches(RegExp(r'^\d{10}$')));
    });

    test('a fresh install already carries the support number and UPI', () {
      const fresh = SubscriptionSettingsModel(updatedAt: '');
      expect(fresh.supportPhoneNumber, PlatformDefaults.supportPhone);
      expect(fresh.whatsappNumber, PlatformDefaults.whatsappNumber);
      expect(fresh.upiId, PlatformDefaults.upiId);
      expect(fresh.merchantName, PlatformDefaults.merchantName);
    });

    test('the bundled QR is a real PNG that names the same account', () async {
      final shipped = await PlatformSettingsService.instance.bundled();
      expect(shipped.qr1, isNotNull);
      expect(shipped.qr1!.take(8).toList(), pngSignature);
      expect(shipped.qr1!.length, lessThan(PlatformSettingsService.maxQrBytes));
      expect(shipped.qrLabel1, PlatformDefaults.qrLabel);
      expect(shipped.upiId, PlatformDefaults.upiId);
      expect(shipped.supportPhoneNumber, PlatformDefaults.supportPhone);
    });

    test('the UPI link every UPI app opens', () {
      final link = PlatformDefaults.upiLink(
        upiId: 'someone@bank',
        payeeName: 'Priyanka Kumari',
      );
      expect(link, startsWith('upi://pay?'));
      final uri = Uri.parse(link);
      expect(uri.queryParameters['pa'], 'someone@bank');
      expect(uri.queryParameters['pn'], 'Priyanka Kumari');
      expect(uri.queryParameters['cu'], 'INR');
      expect(uri.queryParameters.containsKey('am'), isFalse);
    });
  });

  group('what the screen shows', () {
    late FakeFirebaseFirestore cloud;

    setUp(() {
      cloud = FakeFirebaseFirestore();
      PlatformSettingsService.firestoreOverride = cloud;
      PlatformAuditLogService.firestoreOverride = cloud;
      PlatformAuditLogService.currentUidOverride = 'uid-admin';
    });

    tearDown(() {
      PlatformSettingsService.firestoreOverride = null;
      PlatformAuditLogService.firestoreOverride = null;
      PlatformAuditLogService.currentUidOverride = null;
    });

    test('nothing published yet: the bundle, QR included', () async {
      final shown = await PlatformSettingsService.instance.effective();
      expect(shown.upiId, PlatformDefaults.upiId);
      expect(shown.qr1, isNotNull);
      expect(shown.whatsappNumber, PlatformDefaults.whatsappNumber);
    });

    test('only the signing address published: bundle fills the rest', () async {
      await cloud.doc('platformSettings/DEFAULT').set({
        'signBaseUrl': 'https://example.web.app/sign',
      });

      final shown = await PlatformSettingsService.instance.effective();
      expect(shown.signBaseUrl, 'https://example.web.app/sign');
      expect(shown.upiId, PlatformDefaults.upiId);
      expect(shown.qr1, isNotNull);
      expect(shown.qrLabel1, PlatformDefaults.qrLabel);
      expect(shown.supportPhoneNumber, PlatformDefaults.supportPhone);
    });

    test('a published number and QR replace the bundled ones', () async {
      await PlatformSettingsService.instance.publish(
        upiId: 'shop@upi',
        merchantName: 'The Shop',
        qr1: Uint8List.fromList([1, 2, 3]),
        qrLabel1: 'SBI',
        qrLabel2: '',
        whatsappNumber: '9000000001',
        supportPhoneNumber: '9000000002',
      );

      final shown = await PlatformSettingsService.instance.effective();
      expect(shown.upiId, 'shop@upi');
      expect(shown.merchantName, 'The Shop');
      expect(shown.qr1, [1, 2, 3]);
      expect(shown.qr2, isNull, reason: 'a published QR never mixes with the bundled one');
      expect(shown.qrLabel1, 'SBI');
      expect(shown.whatsappNumber, '9000000001');
      expect(shown.supportPhoneNumber, '9000000002');

      final audit = await cloud.collection('platformAuditLogs').get();
      expect(audit.docs.single.data()['action'], PlatformAuditAction.platformSettingsPublished);
    });
  });
}
