import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/services.dart' show rootBundle;

import '../../../core/constants/platform_defaults.dart';
import '../../../core/subscription/platform_audit_log_service.dart';

/// The Super Admin's own platform-wide payment configuration, shared
/// with every company that installs the app.
///
/// WHY THIS EXISTS: subscription_settings is a LOCAL SQLite table, so a
/// QR uploaded by the Super Admin only ever existed on the Super
/// Admin's own device. Every other company's install started with an
/// empty row and fell through to a fallback that generated a QR from
/// THAT company's own UPI id - meaning a customer opening the
/// subscription screen was shown a QR that paid themselves. This is
/// the fix: one document, read by everyone, written only by a Super
/// Admin.
///
/// WHAT SHOWS BEFORE ANYTHING IS PUBLISHED: the details bundled with
/// the app (PlatformDefaults) - a real QR, UPI ID and support number -
/// so a fresh install, or one with no network, still shows the right
/// place to pay. [effective] is the one call screens should make: it
/// is the published document with every gap filled from the bundle.
///
/// IMAGES ARE BASE64 IN THE DOCUMENT, NOT FIREBASE STORAGE: a payment
/// QR is a few tens of kilobytes, comfortably inside Firestore's own
/// 1MB per-document limit, and keeping it here means no extra SDK, no
/// second set of security rules, no storage billing, and Firestore's
/// own offline cache serves it when the device is offline. [maxQrBytes]
/// guards the limit explicitly rather than letting a large upload fail
/// the write with an opaque error.
class PlatformSettings {
  final String upiId;
  final String merchantName;

  /// Raw PNG/JPEG bytes of each QR, decoded from the stored base64.
  /// Null when that slot has never been configured.
  final Uint8List? qr1;
  final Uint8List? qr2;

  final String qrLabel1;
  final String qrLabel2;

  /// Where the customer signing page is hosted, e.g.
  /// https://godown-book.web.app/sign. One address for the whole app -
  /// it is the app owner's own hosting, not a per-company value.
  final String signBaseUrl;

  /// Where a customer sends the payment screenshot, and the number the
  /// dashboard's support buttons dial. The platform owner's own, never
  /// a company's.
  final String whatsappNumber;
  final String supportPhoneNumber;

  const PlatformSettings({
    this.upiId = '',
    this.merchantName = '',
    this.qr1,
    this.qr2,
    this.qrLabel1 = '',
    this.qrLabel2 = '',
    this.signBaseUrl = '',
    this.whatsappNumber = '',
    this.supportPhoneNumber = '',
  });

  bool get hasAnyQr => qr1 != null || qr2 != null;
}

class PlatformSettingsService {
  PlatformSettingsService._();

  static final PlatformSettingsService instance = PlatformSettingsService._();

  /// Tests point this at a FakeFirebaseFirestore; production leaves it
  /// null and talks to FirebaseFirestore.instance exactly as before.
  static FirebaseFirestore? firestoreOverride;

  /// Single shared document. Not company-scoped on purpose - this is
  /// the platform owner's own payment detail, identical for everyone.
  static const String _docPath = 'platformSettings/DEFAULT';

  /// Per-image ceiling. Firestore's own hard limit is 1MB for the
  /// WHOLE document, and base64 inflates bytes by roughly a third, so
  /// two images plus the text fields must stay well under it. 300KB of
  /// raw image is ~400KB encoded - two of those still leaves headroom.
  static const int maxQrBytes = 300 * 1024;

  static const Duration _timeout = Duration(seconds: 10);

  DocumentReference<Map<String, dynamic>> get _doc =>
      (firestoreOverride ?? FirebaseFirestore.instance).doc(_docPath);

  /// Reads the published platform settings. Returns null when the
  /// document does not exist yet or is unreachable - callers must treat
  /// that as "not published" and must NOT substitute the signed-in
  /// company's own UPI details, which is exactly the bug this class
  /// fixes. Screens wanting something to show should call [effective].
  Future<PlatformSettings?> fetch() async {
    try {
      final snapshot = await _doc.get().timeout(_timeout);
      final data = snapshot.data();
      if (data == null) return null;

      return PlatformSettings(
        upiId: data['upiId'] as String? ?? '',
        merchantName: data['merchantName'] as String? ?? '',
        qr1: _decode(data['qrBase64_1'] as String?),
        qr2: _decode(data['qrBase64_2'] as String?),
        qrLabel1: data['qrLabel1'] as String? ?? '',
        qrLabel2: data['qrLabel2'] as String? ?? '',
        signBaseUrl: data['signBaseUrl'] as String? ?? '',
        whatsappNumber: data['whatsappNumber'] as String? ?? '',
        supportPhoneNumber: data['supportPhoneNumber'] as String? ?? '',
      );
    } catch (_) {
      // Offline, permission denied, or no document yet - all mean the
      // same thing to the caller: nothing authoritative to show.
      return null;
    }
  }

  /// The details shipped inside the app (PlatformDefaults), with the
  /// bundled QR loaded from assets. Never fails: if the asset somehow
  /// cannot be read, the QR slot is simply empty and the UPI ID still
  /// stands.
  Future<PlatformSettings> bundled() async {
    Uint8List? qr;
    try {
      final data = await rootBundle.load(PlatformDefaults.qrAsset);
      qr = data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
    } catch (_) {
      qr = null;
    }

    return PlatformSettings(
      upiId: PlatformDefaults.upiId,
      merchantName: PlatformDefaults.merchantName,
      qr1: qr,
      qrLabel1: qr == null ? '' : PlatformDefaults.qrLabel,
      whatsappNumber: PlatformDefaults.whatsappNumber,
      supportPhoneNumber: PlatformDefaults.supportPhone,
    );
  }

  /// What a screen should show: the published document where it says
  /// something, the bundle where it does not. A published QR replaces
  /// the bundled one entirely (both slots and labels together, so the
  /// Super Admin's two QRs are never mixed with the shipped one); every
  /// text field falls back on its own.
  Future<PlatformSettings> effective() async {
    final shipped = await bundled();
    final cloud = await fetch();
    if (cloud == null) return shipped;

    final useCloudQr = cloud.hasAnyQr;
    return PlatformSettings(
      upiId: cloud.upiId.isNotEmpty ? cloud.upiId : shipped.upiId,
      merchantName:
          cloud.merchantName.isNotEmpty ? cloud.merchantName : shipped.merchantName,
      qr1: useCloudQr ? cloud.qr1 : shipped.qr1,
      qr2: useCloudQr ? cloud.qr2 : shipped.qr2,
      qrLabel1: useCloudQr ? cloud.qrLabel1 : shipped.qrLabel1,
      qrLabel2: useCloudQr ? cloud.qrLabel2 : shipped.qrLabel2,
      signBaseUrl: cloud.signBaseUrl,
      whatsappNumber: cloud.whatsappNumber.isNotEmpty
          ? cloud.whatsappNumber
          : shipped.whatsappNumber,
      supportPhoneNumber: cloud.supportPhoneNumber.isNotEmpty
          ? cloud.supportPhoneNumber
          : shipped.supportPhoneNumber,
    );
  }

  /// Publishes the platform settings. Only a Super Admin can succeed -
  /// the Firestore rule on this document enforces that server-side, so
  /// a modified client cannot point every customer's QR at itself.
  ///
  /// Throws [ArgumentError] when an image exceeds [maxQrBytes], so the
  /// caller can show a clear message instead of Firestore rejecting
  /// the whole write with an opaque size error.
  Future<void> publish({
    required String upiId,
    required String merchantName,
    Uint8List? qr1,
    Uint8List? qr2,
    required String qrLabel1,
    required String qrLabel2,
    String signBaseUrl = '',
    String whatsappNumber = '',
    String supportPhoneNumber = '',
  }) async {
    if (qr1 != null && qr1.length > maxQrBytes) {
      throw ArgumentError(
        'QR 1 is too large (${(qr1.length / 1024).round()} KB). '
        'Please use an image under ${maxQrBytes ~/ 1024} KB.',
      );
    }
    if (qr2 != null && qr2.length > maxQrBytes) {
      throw ArgumentError(
        'QR 2 is too large (${(qr2.length / 1024).round()} KB). '
        'Please use an image under ${maxQrBytes ~/ 1024} KB.',
      );
    }

    await _doc.set({
      'upiId': upiId,
      'merchantName': merchantName,
      if (qr1 != null) 'qrBase64_1': base64Encode(qr1),
      if (qr2 != null) 'qrBase64_2': base64Encode(qr2),
      'qrLabel1': qrLabel1,
      'qrLabel2': qrLabel2,
      'signBaseUrl': signBaseUrl,
      'whatsappNumber': whatsappNumber,
      'supportPhoneNumber': supportPhoneNumber,
      'updatedAt': DateTime.now().toIso8601String(),
    }, SetOptions(merge: true)).timeout(_timeout);

    await PlatformAuditLogService.instance.record(
      action: PlatformAuditAction.platformSettingsPublished,
      metadata: {
        'upiId': upiId,
        'merchantName': merchantName,
        'qr1': qr1 != null,
        'qr2': qr2 != null,
        'signBaseUrl': signBaseUrl,
        'whatsappNumber': whatsappNumber,
        'supportPhoneNumber': supportPhoneNumber,
      },
    );
  }

  static Uint8List? _decode(String? encoded) {
    if (encoded == null || encoded.isEmpty) return null;

    try {
      return base64Decode(encoded);
    } catch (_) {
      // A corrupted value must not crash the subscription screen -
      // it simply reads as "no QR configured".
      return null;
    }
  }
}
