import 'package:cloud_firestore/cloud_firestore.dart';

import '../../../core/subscription/platform_audit_log_service.dart';
import '../models/subscription_plan_model.dart';

/// The Super Admin's plan prices, shared with every company that
/// installs the app.
///
/// WHY THIS EXISTS: subscription_plans is a LOCAL SQLite table, seeded
/// once with the launch prices compiled into the app. A price the
/// Super Admin changed therefore only ever applied on the Super
/// Admin's own device - every other company carried on being quoted
/// the seeded price, and the settings screen said so in as many words
/// ("plan prices are saved on this device only"). This is the same bug
/// PlatformSettingsService fixes for the UPI ID and the QR, and takes
/// the same shape of fix: one document, read by everyone, written only
/// by a Super Admin. The Firestore rule on platformSettings/{document}
/// enforces that server-side, so a modified client cannot publish its
/// own prices to the whole platform.
///
/// WHAT IS PUBLISHED: only the commercial terms the Super Admin can
/// actually edit - price, discount, tax and which plan is recommended.
/// A plan's name and length are the app's own: letting a document
/// rewrite them would mean an old publish could silently turn a
/// 12-month plan into a 3-month one.
///
/// Plans are matched by [SubscriptionPlanModel.code], never by row
/// order: a document published by a newer app may name a plan an older
/// install has never seeded, and an older document may be missing one.
/// Both cases leave the local row exactly as it is rather than invent
/// or delete a plan.
class PlatformPlanPrice {
  final String code;
  final double price;
  final double discountAmount;
  final double taxPercent;
  final bool isRecommended;

  const PlatformPlanPrice({
    required this.code,
    required this.price,
    this.discountAmount = 0,
    this.taxPercent = 0,
    this.isRecommended = false,
  });

  factory PlatformPlanPrice.of(SubscriptionPlanModel plan) {
    return PlatformPlanPrice(
      code: plan.code,
      price: plan.price,
      discountAmount: plan.discountAmount,
      taxPercent: plan.taxPercent,
      isRecommended: plan.isRecommended,
    );
  }

  /// Null for anything that is not a usable price. A published
  /// document is ordinary remote data: a negative price, a discount
  /// larger than the price or a tax above 100% would all show the
  /// customer a nonsense amount, so they are rejected here rather than
  /// written into the local table.
  static PlatformPlanPrice? tryParse(Object? raw) {
    if (raw is! Map) return null;

    final code = raw['code'];
    if (code is! String || code.trim().isEmpty) return null;

    final price = _number(raw['price']);
    if (price == null || price < 0 || !price.isFinite) return null;

    final discount = _number(raw['discountAmount']) ?? 0;
    if (discount < 0 || discount > price) return null;

    final tax = _number(raw['taxPercent']) ?? 0;
    if (tax < 0 || tax > 100) return null;

    return PlatformPlanPrice(
      code: code.trim(),
      price: price,
      discountAmount: discount,
      taxPercent: tax,
      isRecommended: raw['isRecommended'] == true,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'code': code,
      'price': price,
      'discountAmount': discountAmount,
      'taxPercent': taxPercent,
      'isRecommended': isRecommended,
    };
  }

  /// True when this plan's row already carries these terms, so a sync
  /// that changes nothing writes nothing.
  bool matches(SubscriptionPlanModel plan) {
    return plan.price == price &&
        plan.discountAmount == discountAmount &&
        plan.taxPercent == taxPercent;
  }

  static double? _number(Object? value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value.trim());
    return null;
  }
}

class PlatformPlansService {
  PlatformPlansService._();

  static final PlatformPlansService instance = PlatformPlansService._();

  /// Tests point this at a FakeFirebaseFirestore; production leaves it
  /// null and talks to FirebaseFirestore.instance.
  static FirebaseFirestore? firestoreOverride;

  /// Beside platformSettings/DEFAULT (payment details) and
  /// platformSettings/promotions (the dashboard banner) - the same
  /// collection, so the same rule already covers it and nothing needs
  /// deploying for this to work.
  static const String docPath = 'platformSettings/plans';

  static const Duration _timeout = Duration(seconds: 10);

  DocumentReference<Map<String, dynamic>> get _doc =>
      (firestoreOverride ?? FirebaseFirestore.instance).doc(docPath);

  /// The published prices, or null when nothing is published yet, the
  /// document holds nothing usable, or the device cannot reach it.
  /// Null means "no instruction from the platform" - the caller keeps
  /// the prices it already has, and must never fall back to zero.
  Future<List<PlatformPlanPrice>?> fetch() async {
    try {
      final snapshot = await _doc.get().timeout(_timeout);
      final raw = snapshot.data()?['plans'];
      if (raw is! List) return null;

      final parsed = raw
          .map(PlatformPlanPrice.tryParse)
          .whereType<PlatformPlanPrice>()
          .toList();

      return parsed.isEmpty ? null : parsed;
    } catch (_) {
      // Offline, permission denied, or no document yet - all mean the
      // same thing to the caller.
      return null;
    }
  }

  /// Publishes every plan's terms. Only a Super Admin can succeed; the
  /// rule rejects anybody else, and the caller surfaces that rather
  /// than pretending the price reached the other companies.
  Future<void> publish(List<SubscriptionPlanModel> plans) async {
    await _doc.set({
      'plans': [for (final plan in plans) PlatformPlanPrice.of(plan).toMap()],
      'updatedAt': DateTime.now().toIso8601String(),
    }, SetOptions(merge: true)).timeout(_timeout);

    await PlatformAuditLogService.instance.record(
      action: PlatformAuditAction.platformPlansPublished,
      metadata: {
        for (final plan in plans) plan.code: plan.finalAmount,
      },
    );
  }
}
