/// The platform owner's own payment and support details, as shipped
/// inside the app.
///
/// These are what every install shows from its very first launch,
/// with no network and before a Super Admin has published anything:
/// the QR a customer scans to pay for a subscription, the UPI ID it
/// resolves to, and the number they send the payment screenshot to.
/// The published platform settings (platformSettings/DEFAULT, see
/// PlatformSettingsService) override every one of these the moment
/// they exist, so changing a number or a QR later is a publish from
/// the Super Admin screen, not an app release.
///
/// The UPI ID and payee name are exactly what the bundled QR encodes
/// (upi://pay?pa=...&pn=...), decoded from the image itself, so the
/// "Pay in UPI app" button, the copyable UPI ID and the scannable QR
/// all point at the same account.
class PlatformDefaults {
  PlatformDefaults._();

  /// Where subscription payments go.
  static const String upiId = 'defencerelocationservices@oksbi';

  /// Who the customer sees they are paying, the way the bank names the
  /// account. Kept the same as the QR so the customer's UPI app and this
  /// screen agree.
  static const String merchantName = 'Priyanka Kumari';

  /// Where a payment screenshot is sent, and who a customer calls.
  static const String supportPhone = '7042889134';
  static const String whatsappNumber = '7042889134';

  /// The Google Pay QR for [upiId], bundled so it shows offline and on
  /// day one. Declared under assets/images/ in pubspec.yaml.
  static const String qrAsset = 'assets/images/payment_qr_gpay.png';
  static const String qrLabel = 'Google Pay';

  /// The published website. Google Play's listing points at these
  /// same pages, and the app links to them rather than carrying a
  /// second copy of the policy text that could drift from the one the
  /// Play listing shows.
  static const String websiteUrl = 'https://drsgurgaon.github.io/storage/';
  static const String privacyPolicyUrl =
      'https://drsgurgaon.github.io/storage/privacy.html';
  static const String termsUrl = 'https://drsgurgaon.github.io/storage/terms.html';
  static const String supportUrl =
      'https://drsgurgaon.github.io/storage/support.html';

  /// The UPI deep link every UPI app understands. No amount is put in:
  /// the customer chooses a plan and types its price, exactly as the
  /// subscription screen already asks them to, and a wrong amount from
  /// a stale plan price is worse than none.
  static String upiLink({required String upiId, required String payeeName}) {
    final name = payeeName.trim().isEmpty ? 'Payment' : payeeName.trim();
    return 'upi://pay?pa=${Uri.encodeComponent(upiId.trim())}'
        '&pn=${Uri.encodeComponent(name)}&cu=INR';
  }
}
