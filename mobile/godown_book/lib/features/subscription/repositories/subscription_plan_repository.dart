import '../../../core/subscription/super_admin_scope.dart';
import '../data/subscription_plan_dao.dart';
import '../models/subscription_plan_model.dart';

class SubscriptionPlanRepository {
  SubscriptionPlanRepository._();

  static final SubscriptionPlanRepository instance =
      SubscriptionPlanRepository._();

  final SubscriptionPlanDao _dao = SubscriptionPlanDao.instance;

  /// Every company reads active plans - no restriction, this is what
  /// the Subscription screen shows to any signed-in user.
  Future<List<SubscriptionPlanModel>> getActivePlans() async {
    return _dao.getAll(activeOnly: true);
  }

  /// Super Admin's plan-management screen - every plan including
  /// inactive ones, unlike getActivePlans() (what customers see).
  Future<List<SubscriptionPlanModel>> getAllPlans() async {
    return _dao.getAll(activeOnly: false);
  }

  Future<SubscriptionPlanModel?> getById(String id) async {
    return _dao.getById(id);
  }

  /// Super Admin only (Section 32: "Only authorized Super Admin can:
  /// Create/edit plans, Change prices"). Enforced here, not only by
  /// hiding a settings screen - a caller that bypasses the UI still
  /// gets rejected.
  Future<void> updatePlan(SubscriptionPlanModel plan) async {
    await _requireSuperAdmin();

    await _dao.update(plan);
  }

  Future<void> setRecommended(String planId) async {
    await _requireSuperAdmin();

    await _dao.setRecommended(planId);
  }

  Future<void> _requireSuperAdmin() async {
    await SuperAdminScope.refresh();

    if (!SuperAdminScope.isSuperAdmin) {
      throw SuperAdminRequiredException();
    }
  }
}
