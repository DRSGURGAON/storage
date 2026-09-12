import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:godown_book/app/theme/app_theme.dart';
import 'package:godown_book/features/promo/promo_banner.dart';
import 'package:godown_book/features/promo/repositories/promo_repository.dart';
import 'package:godown_book/features/promo/services/promo_analytics.dart';
import 'package:godown_book/features/promo/services/promo_destination_launcher.dart';
import 'package:godown_book/features/promo/widgets/promo_banner_card.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The card on screen: shows when it should, vanishes without a trace
/// when it should not, and its one button goes exactly where the offer
/// says.
class RecordingPromoAnalytics extends PromoAnalytics {
  final events = <String>[];

  @override
  void log(String event, Map<String, Object> parameters) {
    events.add('$event:${parameters['promo_id']}:${parameters['promo_category']}');
  }
}

Map<String, Object?> offer({
  String id = 'website-offer',
  bool enabled = true,
  String destinationType = 'WEB_URL',
  String destinationUrl = 'https://example.com/offer',
  String internalRoute = '',
  int priority = 0,
  bool dismissible = true,
  String imageUrl = '',
  String targetAudience = 'ALL',
}) {
  return {
    'id': id,
    'enabled': enabled,
    'category': 'BUSINESS_GROWTH',
    'title': 'Get a Professional Website',
    'subtitle': 'Grow Your Storage Business Online',
    'bullets': ['More customers', 'Mobile friendly', 'Special StorageBill user pricing'],
    'imageUrl': imageUrl,
    'ctaText': 'GET OFFER',
    'destinationType': destinationType,
    'destinationUrl': destinationUrl,
    'internalRoute': internalRoute,
    'priority': priority,
    'targetAudience': targetAudience,
    'dismissible': dismissible,
  };
}

final now = DateTime.utc(2026, 9, 15, 12);

/// The banner inside a scrolling column with a marker below it, under
/// a router that knows /subscription - the shape of the real
/// dashboard, reduced to what the tests look at.
Widget host(RecordingPromoAnalytics analytics, {bool? active}) {
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => Scaffold(
          body: ListView(
            children: [
              const Text('ABOVE'),
              PromoBanner(
                analytics: analytics,
                clock: () => now,
                subscriptionActive: active,
              ),
              const Text('BELOW'),
            ],
          ),
        ),
      ),
      GoRoute(
        path: '/subscription',
        builder: (context, state) => const Scaffold(body: Text('SUBSCRIPTION SCREEN')),
      ),
    ],
  );
  return MaterialApp.router(theme: AppTheme.light(), routerConfig: router);
}

void main() {
  late RecordingPromoAnalytics analytics;
  late List<Uri> launched;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    analytics = RecordingPromoAnalytics();
    launched = [];
    PromoDestinationLauncher.launchOverride = (uri) async {
      launched.add(uri);
      return true;
    };
  });

  tearDown(() {
    PromoRepository.fetchOverride = null;
    PromoDestinationLauncher.launchOverride = null;
  });

  void publish(List<Map<String, Object?>> promos) {
    PromoRepository.fetchOverride = () async => {'promos': promos};
  }

  testWidgets('a valid offer renders as a card with badge, title and CTA', (tester) async {
    publish([offer()]);
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();

    expect(find.byType(PromoBannerCard), findsOneWidget);
    expect(find.text('SPECIAL OFFER'), findsOneWidget);
    expect(find.text('Get a Professional Website'), findsOneWidget);
    expect(find.text('Grow Your Storage Business Online'), findsOneWidget);
    expect(find.text('More customers'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'GET OFFER'), findsOneWidget);
    expect(analytics.events, ['promo_impression:website-offer:BUSINESS_GROWTH']);
  });

  testWidgets('no valid offer leaves no gap between the widgets around it',
      (tester) async {
    publish([offer(enabled: false)]);
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();

    expect(find.byType(PromoBannerCard), findsNothing);
    expect(tester.getSize(find.byType(PromoBanner)).height, 0);
    final above = tester.getBottomLeft(find.text('ABOVE')).dy;
    final below = tester.getTopLeft(find.text('BELOW')).dy;
    expect(below, above);
    expect(analytics.events, isEmpty);
  });

  testWidgets('a fetch that throws leaves the dashboard untouched', (tester) async {
    PromoRepository.fetchOverride = () async => throw StateError('offline');
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();

    expect(find.byType(PromoBannerCard), findsNothing);
    expect(find.text('BELOW'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('malformed remote data does not crash', (tester) async {
    PromoRepository.fetchOverride = () async => {
          'promos': [
            'x',
            {'id': 'no-title', 'ctaText': 'GO'},
            {...offer(), 'destinationUrl': 'javascript:alert(1)'},
          ],
        };
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();

    expect(find.byType(PromoBannerCard), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('of several valid offers only the highest priority is on screen',
      (tester) async {
    publish([
      {...offer(id: 'low', priority: 1), 'title': 'Low'},
      {...offer(id: 'high', priority: 9), 'title': 'High'},
      {...offer(id: 'mid', priority: 4), 'title': 'Mid'},
    ]);
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();

    expect(find.byType(PromoBannerCard), findsOneWidget);
    expect(find.text('High'), findsOneWidget);
    expect(find.text('Low'), findsNothing);
    expect(find.text('Mid'), findsNothing);
  });

  testWidgets('tapping the CTA opens a web offer in the browser and logs a click',
      (tester) async {
    publish([offer()]);
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'GET OFFER'));
    await tester.pumpAndSettle();

    expect(launched, [Uri.parse('https://example.com/offer')]);
    expect(analytics.events.last, 'promo_click:website-offer:BUSINESS_GROWTH');
  });

  testWidgets('an in-app offer navigates to its route', (tester) async {
    publish([offer(destinationType: 'IN_APP', internalRoute: '/subscription')]);
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'GET OFFER'));
    await tester.pumpAndSettle();

    expect(find.text('SUBSCRIPTION SCREEN'), findsOneWidget);
    expect(launched, isEmpty);
  });

  testWidgets('a SUBSCRIPTION offer goes to the subscription screen', (tester) async {
    publish([offer(destinationType: 'SUBSCRIPTION', destinationUrl: '')]);
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'GET OFFER'));
    await tester.pumpAndSettle();

    expect(find.text('SUBSCRIPTION SCREEN'), findsOneWidget);
  });

  testWidgets('phone and WhatsApp offers hand the number to the launcher',
      (tester) async {
    publish([offer(destinationType: 'PHONE', destinationUrl: '9876543210')]);
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'GET OFFER'));
    await tester.pumpAndSettle();
    expect(launched, [Uri.parse('tel:9876543210')]);

    launched.clear();
    publish([offer(id: 'wa', destinationType: 'WHATSAPP', destinationUrl: '98765 43210')]);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'GET OFFER'));
    await tester.pumpAndSettle();
    expect(launched, [Uri.parse('https://wa.me/919876543210')]);
  });

  testWidgets('a launcher that cannot open the destination says so, quietly',
      (tester) async {
    PromoDestinationLauncher.launchOverride = (uri) async => false;
    publish([offer()]);
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'GET OFFER'));
    await tester.pumpAndSettle();

    expect(find.text('Could not open this offer right now.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('dismissing hides the card, remembers it, and logs the dismissal',
      (tester) async {
    publish([offer()]);
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();

    expect(find.byType(PromoBannerCard), findsNothing);
    expect(tester.getSize(find.byType(PromoBanner)).height, 0);
    expect(analytics.events.last, 'promo_dismiss:website-offer:BUSINESS_GROWTH');
    expect(await PromoRepository.instance.dismissedIds(), {'website-offer'});

    // A fresh launch does not bring it back.
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();
    expect(find.byType(PromoBannerCard), findsNothing);
  });

  testWidgets('a non-dismissible offer has no close control', (tester) async {
    publish([offer(dismissible: false)]);
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();

    expect(find.byType(PromoBannerCard), findsOneWidget);
    expect(find.byIcon(Icons.close), findsNothing);
  });

  testWidgets('an image that fails to load collapses to the text layout',
      (tester) async {
    // flutter_test's HTTP client answers every request with 400.
    publish([offer(imageUrl: 'https://cdn.example.com/missing.png')]);
    await tester.pumpWidget(host(analytics));
    await tester.pumpAndSettle();

    expect(find.byType(PromoBannerCard), findsOneWidget);
    expect(find.text('Get a Professional Website'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the audience narrows once the subscription state is known',
      (tester) async {
    publish([offer(id: 'upgrade', targetAudience: 'NOT_ACTIVE')]);
    await tester.pumpWidget(host(analytics, active: true));
    await tester.pumpAndSettle();
    expect(find.byType(PromoBannerCard), findsNothing);

    await tester.pumpWidget(host(analytics, active: false));
    await tester.pumpAndSettle();
    expect(find.byType(PromoBannerCard), findsOneWidget);
  });
}
