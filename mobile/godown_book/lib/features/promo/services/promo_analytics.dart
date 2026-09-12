import 'package:flutter/foundation.dart';

import '../models/promo_offer.dart';

/// The three things worth knowing about an offer: it was seen, it was
/// tapped, it was dismissed. Parameters carry the offer's id, category
/// and destination so a report can be cut by any of them.
///
/// The app has no analytics provider yet, so the default sink only
/// logs in debug builds. When one is adopted (Firebase Analytics, for
/// instance) it plugs in here by implementing [log] - the banner and
/// its tests do not change.
abstract class PromoAnalytics {
  static const String impressionEvent = 'promo_impression';
  static const String clickEvent = 'promo_click';
  static const String dismissEvent = 'promo_dismiss';

  /// The sink in use. Replaceable at startup or in a test.
  static PromoAnalytics instance = const DebugPromoAnalytics();

  const PromoAnalytics();

  void log(String event, Map<String, Object> parameters);

  void impression(PromoOffer offer) => log(impressionEvent, _params(offer));

  void click(PromoOffer offer) => log(clickEvent, _params(offer));

  void dismiss(PromoOffer offer) => log(dismissEvent, _params(offer));

  static Map<String, Object> _params(PromoOffer offer) => {
        'promo_id': offer.id,
        'promo_category': offer.category.code,
        'destination_type': offer.destinationType.code,
        if (offer.partnerName.isNotEmpty) 'partner_name': offer.partnerName,
      };
}

/// Debug-only console output; silent in release builds.
class DebugPromoAnalytics extends PromoAnalytics {
  const DebugPromoAnalytics();

  @override
  void log(String event, Map<String, Object> parameters) {
    if (kDebugMode) debugPrint('[promo] $event $parameters');
  }
}
