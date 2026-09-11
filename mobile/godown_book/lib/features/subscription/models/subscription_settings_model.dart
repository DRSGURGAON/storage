/// Platform-wide subscription configuration (Sections 9, 31) - a
/// single row, exactly like CompanyModel's own "one row per install"
/// pattern (fixed id, always upserted rather than inserted fresh).
/// Deliberately NOT scoped to any one company - the UPI ID, QR, contact
/// numbers, demo limits, watermark text, and expiry-warning schedule
/// apply to the whole platform (this is Super Admin territory, not
/// per-company settings, matching Option A's cross-company Super Admin
/// design).
///
/// V1 correction: subscription payment is completely off-app -
/// merchantName is the payment RECEIVER'S name shown to the customer
/// (not an in-app merchant/payment-gateway concept), and
/// whatsappNumber/supportPhoneNumber are where the customer sends their
/// payment screenshot externally. There is no payment-processing
/// field anywhere in this model, deliberately.
class SubscriptionSettingsModel {
  /// Always 'DEFAULT' - the single-row pattern.
  final String id;

  final String upiId;

  /// The payment receiver's name, shown to the customer alongside the
  /// UPI ID/QR - who they are actually paying.
  final String merchantName;

  /// The first of 2 Super Admin payment QR images the user can choose
  /// between (Section 9-10, extended to 2 QRs per explicit
  /// requirement) - genuinely displayed exactly as uploaded, never
  /// synthesized from a UPI link.
  final String? qrImagePath;

  /// Optional label for [qrImagePath] (e.g. "SBI"), shown above it so
  /// the user can tell the 2 QRs apart when choosing.
  final String? qrLabel1;

  /// The second payment QR image, alongside [qrImagePath].
  final String? qrImagePath2;

  /// Optional label for [qrImagePath2] (e.g. "HDFC Bank").
  final String? qrLabel2;

  /// Where the customer sends their payment screenshot after paying
  /// off-app - no in-app upload, this is purely informational contact
  /// detail displayed in the Help Center.
  final String whatsappNumber;
  final String supportPhoneNumber;

  final String paymentInstructions;

  /// Free document-generation copies allowed per document type before
  /// a subscription is required (Section 5) - Super Admin configurable,
  /// applies uniformly to every document type (the spec doesn't ask
  /// for a per-type override, just a configurable single limit).
  final int demoGenerationLimit;

  final String watermarkText;
  final double watermarkOpacity;

  /// Days-before-expiry to show a warning (Section 20) - stored as a
  /// comma-separated list of day counts (e.g. "30,15,7,3,1") rather
  /// than fixed columns, so Super Admin can add/remove warning points
  /// without a schema change.
  final String expiryWarningDaysCsv;

  final int gracePeriodDays;

  final String updatedAt;

  const SubscriptionSettingsModel({
    this.id = 'DEFAULT',
    this.upiId = '',
    this.merchantName = '',
    this.qrImagePath,
    this.qrLabel1,
    this.qrImagePath2,
    this.qrLabel2,
    this.whatsappNumber = '',
    this.supportPhoneNumber = '',
    this.paymentInstructions = '',
    this.demoGenerationLimit = 2,
    this.watermarkText = 'DEMO - UNLICENSED COPY',
    // Trial-period default (Phase: pre-launch) - genuinely 5%
    // opacity, lowered from 15% per explicit instruction: "bilkul
    // kam kar do, halka dikhe" (make it genuinely much lighter,
    // barely visible) - the previous 15% was reported as too dark.
    // Raise this again once the app is genuinely out of trial and
    // launched.
    this.watermarkOpacity = 0.05,
    this.expiryWarningDaysCsv = '30,15,7,3,1',
    this.gracePeriodDays = 0,
    required this.updatedAt,
  });

  List<int> get expiryWarningDays => expiryWarningDaysCsv
      .split(',')
      .map((e) => int.tryParse(e.trim()))
      .whereType<int>()
      .toList();

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'upi_id': upiId,
      'merchant_name': merchantName,
      'qr_image_path': qrImagePath,
      'qr_label_1': qrLabel1,
      'qr_image_path_2': qrImagePath2,
      'qr_label_2': qrLabel2,
      'whatsapp_number': whatsappNumber,
      'support_phone_number': supportPhoneNumber,
      'payment_instructions': paymentInstructions,
      'demo_generation_limit': demoGenerationLimit,
      'watermark_text': watermarkText,
      'watermark_opacity': watermarkOpacity,
      'expiry_warning_days_csv': expiryWarningDaysCsv,
      'grace_period_days': gracePeriodDays,
      'updated_at': updatedAt,
    };
  }

  factory SubscriptionSettingsModel.fromMap(Map<String, dynamic> map) {
    return SubscriptionSettingsModel(
      id: map['id'] as String? ?? 'DEFAULT',
      upiId: map['upi_id'] as String? ?? '',
      merchantName: map['merchant_name'] as String? ?? '',
      qrImagePath: map['qr_image_path'] as String?,
      qrLabel1: map['qr_label_1'] as String?,
      qrImagePath2: map['qr_image_path_2'] as String?,
      qrLabel2: map['qr_label_2'] as String?,
      whatsappNumber: map['whatsapp_number'] as String? ?? '',
      supportPhoneNumber: map['support_phone_number'] as String? ?? '',
      paymentInstructions: map['payment_instructions'] as String? ?? '',
      demoGenerationLimit: map['demo_generation_limit'] as int? ?? 2,
      watermarkText:
          map['watermark_text'] as String? ?? 'DEMO - UNLICENSED COPY',
      watermarkOpacity:
          (map['watermark_opacity'] as num?)?.toDouble() ?? 0.05,
      expiryWarningDaysCsv:
          map['expiry_warning_days_csv'] as String? ?? '30,15,7,3,1',
      gracePeriodDays: map['grace_period_days'] as int? ?? 0,
      updatedAt: map['updated_at'] as String? ?? '',
    );
  }

  SubscriptionSettingsModel copyWith({
    String? upiId,
    String? merchantName,
    String? qrImagePath,
    String? qrLabel1,
    String? qrImagePath2,
    String? qrLabel2,
    String? whatsappNumber,
    String? supportPhoneNumber,
    String? paymentInstructions,
    int? demoGenerationLimit,
    String? watermarkText,
    double? watermarkOpacity,
    String? expiryWarningDaysCsv,
    int? gracePeriodDays,
  }) {
    return SubscriptionSettingsModel(
      id: id,
      upiId: upiId ?? this.upiId,
      merchantName: merchantName ?? this.merchantName,
      qrImagePath: qrImagePath ?? this.qrImagePath,
      qrLabel1: qrLabel1 ?? this.qrLabel1,
      qrImagePath2: qrImagePath2 ?? this.qrImagePath2,
      qrLabel2: qrLabel2 ?? this.qrLabel2,
      whatsappNumber: whatsappNumber ?? this.whatsappNumber,
      supportPhoneNumber: supportPhoneNumber ?? this.supportPhoneNumber,
      paymentInstructions: paymentInstructions ?? this.paymentInstructions,
      demoGenerationLimit: demoGenerationLimit ?? this.demoGenerationLimit,
      watermarkText: watermarkText ?? this.watermarkText,
      watermarkOpacity: watermarkOpacity ?? this.watermarkOpacity,
      expiryWarningDaysCsv:
          expiryWarningDaysCsv ?? this.expiryWarningDaysCsv,
      gracePeriodDays: gracePeriodDays ?? this.gracePeriodDays,
      updatedAt: DateTime.now().toIso8601String(),
    );
  }
}
