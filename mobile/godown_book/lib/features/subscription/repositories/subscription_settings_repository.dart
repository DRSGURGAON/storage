import '../../../core/document_theme/pdf_page_kit.dart';
import '../../../core/subscription/super_admin_scope.dart';
import '../data/subscription_settings_dao.dart';
import '../models/subscription_settings_model.dart';
import '../services/platform_settings_service.dart';

class SubscriptionSettingsRepository {
  SubscriptionSettingsRepository._();

  static final SubscriptionSettingsRepository instance =
      SubscriptionSettingsRepository._();

  final SubscriptionSettingsDao _dao = SubscriptionSettingsDao.instance;

  /// Every company reads settings (UPI ID, QR, instructions) to show
  /// the payment screen - no restriction.
  Future<SubscriptionSettingsModel> get() async {
    return _dao.get();
  }

  /// Super Admin only (Section 32: configuring plans/prices/QR/
  /// payment info is explicitly Super Admin territory).
  Future<void> save(SubscriptionSettingsModel settings) async {
    await SuperAdminScope.refresh();

    if (!SuperAdminScope.isSuperAdmin) {
      throw SuperAdminRequiredException();
    }

    await _dao.save(settings);
    PdfPageKit.demoWatermarkText = settings.watermarkText;
  }

  /// Copies the Limited-mode rules the Super Admin published (free
  /// copies, watermark, expiry warning days, payment note) into this
  /// phone's own settings row.
  ///
  /// The row is local, so before this a change made on the Super
  /// Admin's phone never reached anyone else. Kept in the local row
  /// rather than read from the cloud on every use: the free-copy check
  /// runs before each PDF and must work offline. Run at startup and
  /// when the subscription screen opens; a field never published is
  /// left as it is.
  Future<void> syncPublished() async {
    final local = await _dao.get();
    PdfPageKit.demoWatermarkText = local.watermarkText;

    final cloud = await PlatformSettingsService.instance.fetch();
    if (cloud == null) return;

    final limit = cloud.demoGenerationLimit;
    final days = cloud.expiryWarningDaysCsv.trim();
    final updated = local.copyWith(
      demoGenerationLimit: limit != null && limit >= 0 ? limit : null,
      watermarkText:
          cloud.watermarkText.trim().isEmpty ? null : cloud.watermarkText,
      expiryWarningDaysCsv: days.isEmpty ? null : days,
      // Clearing the note is a real choice, so an empty published
      // value is taken too - but only once the field exists at all,
      // which the other three being published shows.
      paymentInstructions: cloud.paymentInstructions.isNotEmpty ||
              limit != null
          ? cloud.paymentInstructions
          : null,
    );

    if (updated.demoGenerationLimit == local.demoGenerationLimit &&
        updated.watermarkText == local.watermarkText &&
        updated.expiryWarningDaysCsv == local.expiryWarningDaysCsv &&
        updated.paymentInstructions == local.paymentInstructions) {
      return;
    }

    await _dao.save(updated);
    PdfPageKit.demoWatermarkText = updated.watermarkText;
  }
}
