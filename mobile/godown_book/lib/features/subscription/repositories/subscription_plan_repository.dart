import 'package:flutter/foundation.dart';

import '../../../core/subscription/super_admin_scope.dart';
import '../data/subscription_plan_dao.dart';
import '../models/subscription_plan_model.dart';
import '../services/platform_plans_service.dart';

class SubscriptionPlanRepository {
  SubscriptionPlanRepository._();

  static final SubscriptionPlanRepository instance =
      SubscriptionPlanRepository._();

  final SubscriptionPlanDao _dao = SubscriptionPlanDao.instance;

  /// One sync attempt per app run, like the update check - a price the
  /// Super Admin changes is not something every rebuild of a list needs
  /// to go to the network for, and a device that is offline now should
  /// not stall the subscription screen again on the next tap.
  bool _synced = false;

  @visibleForTesting
  static void resetPublishedPriceSync() => instance._synced = false;

  /// Every company reads active plans - no restriction, this is what
  /// the Subscription screen shows to any signed-in user.
  Future<List<SubscriptionPlanModel>> getActivePlans() async {
    await _applyPublishedPrices();

    return _dao.getAll(activeOnly: true);
  }

  /// Super Admin's plan-management screen - every plan including
  /// inactive ones, unlike getActivePlans() (what customers see).
  Future<List<SubscriptionPlanModel>> getAllPlans() async {
    await _applyPublishedPrices();

    return _dao.getAll(activeOnly: false);
  }

  Future<SubscriptionPlanModel?> getById(String id) async {
    return _dao.getById(id);
  }

  /// Super Admin only (Section 32: "Only authorized Super Admin can:
  /// Create/edit plans, Change prices"). Enforced here, not only by
  /// hiding a settings screen - a caller that bypasses the UI still
  /// gets rejected.
  ///
  /// The price is saved on this device and then published, so every
  /// other company's install picks it up. A failed publish throws
  /// AFTER the local row is written: the edit genuinely did happen
  /// here, and the caller says exactly that rather than asking for it
  /// to be entered again.
  Future<void> updatePlan(SubscriptionPlanModel plan) async {
    await _requireSuperAdmin();

    await _dao.update(plan);
    await _publish();
  }

  Future<void> setRecommended(String planId) async {
    await _requireSuperAdmin();

    await _dao.setRecommended(planId);
    await _publish();
  }

  Future<void> _publish() async {
    await PlatformPlansService.instance.publish(
      await _dao.getAll(activeOnly: false),
    );
  }

  /// Takes whatever the Super Admin has published and writes it onto
  /// this device's rows. Nothing published, nothing reachable, or a
  /// plan this install has never seeded all leave the local prices
  /// alone - the seeded launch prices are a sane thing to show, zero
  /// is not.
  Future<void> _applyPublishedPrices() async {
    if (_synced) return;
    _synced = true; // one attempt per run, whether or not it succeeds

    final published = await PlatformPlansService.instance.fetch();
    if (published == null) return;

    final local = {
      for (final plan in await _dao.getAll(activeOnly: false)) plan.code: plan,
    };

    for (final price in published) {
      final plan = local[price.code];
      if (plan == null) continue;
      if (price.matches(plan)) continue;

      await _dao.update(
        plan.copyWith(
          price: price.price,
          discountAmount: price.discountAmount,
          taxPercent: price.taxPercent,
        ),
      );
    }

    // At most one recommended plan, and only when the document names
    // one this install actually has: setRecommended clears the flag on
    // every other row, so calling it for an unknown code would leave
    // the screen with no highlighted plan at all.
    for (final price in published) {
      if (!price.isRecommended) continue;

      final plan = local[price.code];
      if (plan == null) continue;
      if (!plan.isRecommended) await _dao.setRecommended(plan.id);
      break;
    }
  }

  Future<void> _requireSuperAdmin() async {
    await SuperAdminScope.refresh();

    if (!SuperAdminScope.isSuperAdmin) {
      throw SuperAdminRequiredException();
    }
  }
}
