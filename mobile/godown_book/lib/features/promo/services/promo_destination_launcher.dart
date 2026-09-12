import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/contact/contact_launcher.dart';
import '../models/promo_offer.dart';

/// Turns an offer's destination into an action, and nothing else:
/// in-app routes only from the model's allowlist, web only over https
/// in an external browser, phone and WhatsApp through the app's own
/// ContactLauncher. Remote data chooses among these; it never supplies
/// code.
class PromoDestinationLauncher {
  PromoDestinationLauncher._();

  /// Test seam for the URL launcher.
  static Future<bool> Function(Uri uri)? launchOverride;

  /// Returns false when nothing could be opened, so the caller can say
  /// so rather than leave a dead button.
  static Future<bool> open(BuildContext context, PromoOffer offer) async {
    switch (offer.destinationType) {
      case PromoDestinationType.inApp:
      case PromoDestinationType.feature:
        if (!PromoOffer.allowedInternalRoutes.contains(offer.internalRoute)) {
          return false;
        }
        return _push(context, offer.internalRoute);
      case PromoDestinationType.subscription:
        return _push(context, '/subscription');
      case PromoDestinationType.webUrl:
        final uri = offer.webUri;
        if (uri == null || uri.scheme != 'https') return false;
        return _launch(uri);
      case PromoDestinationType.whatsapp:
        if (launchOverride != null) {
          return launchOverride!(Uri.parse('https://wa.me/${ContactLauncher.normalise(offer.destinationUrl)}'));
        }
        await ContactLauncher.openWhatsAppWithChoice(context, offer.destinationUrl);
        return true;
      case PromoDestinationType.phone:
        if (launchOverride != null) {
          return launchOverride!(Uri.parse('tel:${offer.destinationUrl}'));
        }
        return ContactLauncher.call(offer.destinationUrl);
    }
  }

  static Future<bool> _push(BuildContext context, String route) async {
    // Customers and Documents are shell tabs - switched to, never
    // stacked, the same way the dashboard's own _open() treats them.
    if (route == '/customers' || route == '/documents') {
      context.go(route);
    } else {
      await context.push(route);
    }
    return true;
  }

  static Future<bool> _launch(Uri uri) async {
    final launch = launchOverride;
    if (launch != null) return launch(uri);
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }
}
