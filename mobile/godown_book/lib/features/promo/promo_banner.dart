import 'package:flutter/material.dart';

import '../../core/subscription/subscription_status.dart';
import 'models/promo_offer.dart';
import 'repositories/promo_repository.dart';
import 'services/promo_analytics.dart';
import 'services/promo_destination_launcher.dart';
import 'services/promo_selector.dart';
import 'widgets/promo_banner_card.dart';

export 'models/promo_offer.dart';

/// The one promotional card on the dashboard - or nothing at all.
///
/// Drop it into a list and forget it: it fetches its own offers
/// (PromoRepository), picks one (PromoSelector) and renders it
/// (PromoBannerCard). While loading, when nothing applies, or when
/// anything fails, it is a zero-height SizedBox - no spinner, no gap,
/// no exception reaching the dashboard.
///
/// [subscriptionStatus] and [subscriptionActive] are whatever the host
/// already knows; they only narrow the audience and may be null.
class PromoBanner extends StatefulWidget {
  final SubscriptionStatus? subscriptionStatus;
  final bool? subscriptionActive;

  /// Test seams. Production leaves them null.
  final PromoRepository? repository;
  final PromoAnalytics? analytics;
  final DateTime Function()? clock;

  const PromoBanner({
    super.key,
    this.subscriptionStatus,
    this.subscriptionActive,
    this.repository,
    this.analytics,
    this.clock,
  });

  @override
  State<PromoBanner> createState() => _PromoBannerState();
}

class _PromoBannerState extends State<PromoBanner> {
  List<PromoOffer> _offers = const [];
  Set<String> _dismissed = const {};
  Map<String, int> _impressions = const {};
  PromoOffer? _shown;

  /// Ids already counted as seen in this widget's lifetime, so a
  /// rebuild is not another impression.
  final Set<String> _counted = {};

  PromoRepository get _repo => widget.repository ?? PromoRepository.instance;
  PromoAnalytics get _analytics => widget.analytics ?? PromoAnalytics.instance;
  DateTime get _now => (widget.clock ?? DateTime.now)();

  PromoAudienceContext get _audience => PromoAudienceContext(
        subscriptionStatus: widget.subscriptionStatus,
        subscriptionActive: widget.subscriptionActive,
      );

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(PromoBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.subscriptionStatus != widget.subscriptionStatus ||
        oldWidget.subscriptionActive != widget.subscriptionActive) {
      _reselect();
    }
  }

  Future<void> _load() async {
    List<PromoOffer> offers;
    Set<String> dismissed;
    Map<String, int> impressions;
    try {
      offers = await _repo.load();
      dismissed = await _repo.dismissedIds();
      impressions = await _repo.impressions();
    } catch (_) {
      // The repository already swallows everything; this is belt and
      // braces so a bug there can never take the dashboard with it.
      return;
    }
    if (!mounted) return;
    setState(() {
      _offers = offers;
      _dismissed = dismissed;
      _impressions = impressions;
    });
    _reselect();
  }

  void _reselect() {
    final next = PromoSelector.select(
      _offers,
      now: _now,
      context: _audience,
      dismissedIds: _dismissed,
      impressions: _impressions,
    );
    if (next?.id == _shown?.id) return;
    setState(() => _shown = next);
    if (next != null && _counted.add(next.id)) {
      _analytics.impression(next);
      _repo.recordImpression(next.id);
    }
  }

  Future<void> _onTap(PromoOffer offer) async {
    _analytics.click(offer);
    final messenger = ScaffoldMessenger.maybeOf(context);
    final opened = await PromoDestinationLauncher.open(context, offer);
    if (!opened && mounted) {
      messenger?.showSnackBar(
        const SnackBar(content: Text('Could not open this offer right now.')),
      );
    }
  }

  Future<void> _onDismiss(PromoOffer offer) async {
    _analytics.dismiss(offer);
    setState(() {
      _dismissed = {..._dismissed, offer.id};
    });
    _reselect();
    await _repo.dismiss(offer.id);
  }

  @override
  Widget build(BuildContext context) {
    final offer = _shown;
    if (offer == null) return const SizedBox.shrink();
    return PromoBannerCard(
      key: ValueKey('promo-${offer.id}'),
      offer: offer,
      onTap: () => _onTap(offer),
      onDismiss: offer.dismissible ? () => _onDismiss(offer) : null,
    );
  }
}
