import '../../../core/subscription/super_admin_scope.dart';
import '../data/subscription_settings_dao.dart';
import '../models/subscription_settings_model.dart';

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
  }
}
