import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';

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

  const PlatformSettings({
    this.upiId = '',
    this.merchantName = '',
    this.qr1,
    this.qr2,
    this.qrLabel1 = '',
    this.qrLabel2 = '',
    this.signBaseUrl = '',
  });

  bool get hasAnyQr => qr1 != null || qr2 != null;
}

class PlatformSettingsService {
  PlatformSettingsService._();

  static final PlatformSettingsService instance = PlatformSettingsService._();

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
      FirebaseFirestore.instance.doc(_docPath);

  /// Reads the platform settings. Returns null when the document does
  /// not exist yet or is unreachable - callers must treat that as
  /// "not configured" and must NOT substitute the signed-in company's
  /// own UPI details, which is exactly the bug this class fixes.
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
      );
    } catch (_) {
      // Offline, permission denied, or no document yet - all mean the
      // same thing to the caller: nothing authoritative to show.
      return null;
    }
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
      'updatedAt': DateTime.now().toIso8601String(),
    }, SetOptions(merge: true)).timeout(_timeout);
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
