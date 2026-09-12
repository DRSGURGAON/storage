import '../../../core/subscription/subscription_status.dart';
import '../models/promo_offer.dart';

/// What the app knows about the company that decides which audience
/// it belongs to. Null fields mean "not known yet" (still loading, or
/// no company) - then only offers for everyone match.
class PromoAudienceContext {
  final SubscriptionStatus? subscriptionStatus;

  /// SubscriptionAccessService.isSubscriptionActive() - accounts for a
  /// lapsed ACTIVE subscription, which the status alone does not.
  final bool? subscriptionActive;

  const PromoAudienceContext({this.subscriptionStatus, this.subscriptionActive});

  static const unknown = PromoAudienceContext();

  bool matches(PromoAudience audience) {
    switch (audience) {
      case PromoAudience.all:
        return true;
      case PromoAudience.active:
        return subscriptionActive == true;
      case PromoAudience.notActive:
        return subscriptionActive == false;
      case PromoAudience.limited:
        return subscriptionStatus == SubscriptionStatus.limited;
      case PromoAudience.expiringSoon:
        return subscriptionStatus == SubscriptionStatus.expiringSoon;
      case PromoAudience.expired:
        final status = subscriptionStatus;
        if (status == null) return false;
        if (status == SubscriptionStatus.expired) return true;
        // ACTIVE on paper but past its last day.
        return status.grantsFullAccess && subscriptionActive == false;
    }
  }
}

/// Picks the one offer the dashboard shows. Pure: same inputs, same
/// answer, so every rule has a test.
class PromoSelector {
  PromoSelector._();

  /// Order of the rules, as specified: enabled → live now → audience →
  /// not dismissed → under its show count → highest priority. Ties keep
  /// the published order.
  static PromoOffer? select(
    List<PromoOffer> offers, {
    required DateTime now,
    PromoAudienceContext context = PromoAudienceContext.unknown,
    Set<String> dismissedIds = const {},
    Map<String, int> impressions = const {},
  }) {
    PromoOffer? best;
    for (final offer in offers) {
      if (!offer.enabled) continue;
      if (!offer.isLiveAt(now)) continue;
      if (!context.matches(offer.targetAudience)) continue;
      if (dismissedIds.contains(offer.id)) continue;
      if (offer.showCount > 0 && (impressions[offer.id] ?? 0) >= offer.showCount) {
        continue;
      }
      if (best == null || offer.priority > best.priority) best = offer;
    }
    return best;
  }
}
