import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/subscription/subscription_status.dart';
import 'package:godown_book/features/promo/models/promo_offer.dart';
import 'package:godown_book/features/promo/repositories/promo_repository.dart';
import 'package:godown_book/features/promo/services/promo_selector.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The promotional card is remote data rendered on the operator's home
/// screen. These tests pin down what may reach it: only a complete,
/// well-formed offer pointing somewhere the app already goes; only one
/// at a time; never anything that can throw.
Map<String, Object?> offer({
  String id = 'website-offer',
  bool enabled = true,
  String category = 'BUSINESS_GROWTH',
  String title = 'Get a Professional Website',
  String ctaText = 'GET OFFER',
  String destinationType = 'WEB_URL',
  String destinationUrl = 'https://example.com/offer',
  String internalRoute = '',
  int priority = 0,
  Object? startAt,
  Object? endAt,
  String targetAudience = 'ALL',
  bool dismissible = true,
  int showCount = 0,
  String imageUrl = '',
  String partnerName = '',
  String partnerLabel = '',
}) {
  return {
    'id': id,
    'enabled': enabled,
    'category': category,
    'title': title,
    'subtitle': 'Grow Your Storage Business Online',
    'bullets': ['More customers', 'Mobile friendly', 'Special pricing', 'Fourth'],
    'imageUrl': imageUrl,
    'ctaText': ctaText,
    'destinationType': destinationType,
    'destinationUrl': destinationUrl,
    'internalRoute': internalRoute,
    'priority': priority,
    'startAt': startAt,
    'endAt': endAt,
    'targetAudience': targetAudience,
    'dismissible': dismissible,
    'showCount': showCount,
    'partnerName': partnerName,
    'partnerLabel': partnerLabel,
  };
}

final now = DateTime.utc(2026, 9, 15, 12);

void main() {
  group('PromoOffer.tryParse', () {
    test('a complete offer parses with every field', () {
      final o = PromoOffer.tryParse(offer(
        startAt: '2026-09-01T00:00:00Z',
        endAt: '2026-12-31T23:59:59Z',
        priority: 5,
        partnerName: 'WebWorks',
        partnerLabel: 'SPONSORED',
      ))!;
      expect(o.id, 'website-offer');
      expect(o.category, PromoCategory.businessGrowth);
      expect(o.destinationType, PromoDestinationType.webUrl);
      expect(o.webUri, Uri.parse('https://example.com/offer'));
      expect(o.priority, 5);
      expect(o.startAt, DateTime.utc(2026, 9, 1));
      expect(o.endAt, DateTime.utc(2026, 12, 31, 23, 59, 59));
      expect(o.bullets, hasLength(4));
      expect(o.isPartnerOffer, isTrue);
      expect(o.badgeText, 'SPONSORED');
    });

    test('the badge follows the category unless the offer names its own', () {
      expect(PromoOffer.tryParse(offer())!.badgeText, 'SPECIAL OFFER');
      expect(PromoOffer.tryParse(offer(category: 'STORAGEBILL_FEATURE'))!.badgeText,
          'STORAGEBILL FEATURE');
      expect(PromoOffer.tryParse(offer(category: 'PARTNER_OFFER'))!.badgeText,
          'PARTNER OFFER');
      expect(PromoOffer.tryParse(offer()..['badge'] = 'NEW')!.badgeText, 'NEW');
      expect(PromoOffer.tryParse(offer(partnerName: 'Acme'))!.badgeText, 'PARTNER OFFER');
    });

    test('missing required fields make the offer invalid', () {
      expect(PromoOffer.tryParse(offer(id: '')), isNull);
      expect(PromoOffer.tryParse(offer(title: '  ')), isNull);
      expect(PromoOffer.tryParse(offer(ctaText: '')), isNull);
      expect(PromoOffer.tryParse(offer(category: 'ADS')), isNull);
      expect(PromoOffer.tryParse(offer(destinationType: 'DEEP_LINK')), isNull);
      expect(PromoOffer.tryParse(offer(targetAudience: 'EVERYONE')), isNull);
    });

    test('garbage is not an offer', () {
      expect(PromoOffer.tryParse(null), isNull);
      expect(PromoOffer.tryParse('offer'), isNull);
      expect(PromoOffer.tryParse(42), isNull);
      expect(PromoOffer.tryParse(<String, Object?>{}), isNull);
      expect(PromoOffer.tryParse({'id': 1, 'title': true, 'ctaText': []}), isNull);
    });

    test('a web destination must be https with a real host', () {
      expect(PromoOffer.tryParse(offer(destinationUrl: 'http://example.com')), isNull);
      expect(PromoOffer.tryParse(offer(destinationUrl: 'javascript:alert(1)')), isNull);
      expect(PromoOffer.tryParse(offer(destinationUrl: 'not a url')), isNull);
      expect(PromoOffer.tryParse(offer(destinationUrl: 'https://localhost')), isNull);
      expect(PromoOffer.tryParse(offer(destinationUrl: '')), isNull);
      expect(PromoOffer.tryParse(offer(destinationUrl: 'https://example.com/x?y=1')),
          isNotNull);
    });

    test('an in-app destination must be a route the app already has', () {
      expect(
          PromoOffer.tryParse(
              offer(destinationType: 'IN_APP', internalRoute: '/subscription')),
          isNotNull);
      expect(
          PromoOffer.tryParse(offer(destinationType: 'FEATURE', internalRoute: '/reports')),
          isNotNull);
      expect(PromoOffer.tryParse(offer(destinationType: 'IN_APP', internalRoute: '/admin')),
          isNull);
      expect(
          PromoOffer.tryParse(
              offer(destinationType: 'IN_APP', internalRoute: '/storage-detail')),
          isNull,
          reason: 'routes that need an extra argument are not allowed');
      expect(PromoOffer.tryParse(offer(destinationType: 'IN_APP', internalRoute: '')),
          isNull);
      expect(PromoOffer.tryParse(offer(destinationType: 'SUBSCRIPTION', destinationUrl: '')),
          isNotNull);
    });

    test('phone and WhatsApp destinations need a plausible number', () {
      expect(PromoOffer.tryParse(offer(destinationType: 'WHATSAPP', destinationUrl: '+91 98765 43210')),
          isNotNull);
      expect(PromoOffer.tryParse(offer(destinationType: 'PHONE', destinationUrl: '9876543210')),
          isNotNull);
      expect(PromoOffer.tryParse(offer(destinationType: 'PHONE', destinationUrl: '12345')),
          isNull);
      expect(PromoOffer.tryParse(offer(destinationType: 'WHATSAPP', destinationUrl: 'call me')),
          isNull);
    });

    test('an image must be https or absent', () {
      expect(PromoOffer.tryParse(offer(imageUrl: 'https://cdn.example.com/a.png')), isNotNull);
      expect(PromoOffer.tryParse(offer(imageUrl: 'http://cdn.example.com/a.png')), isNull);
      expect(PromoOffer.tryParse(offer(imageUrl: ''))!.imageUrl, '');
    });

    test('dates must parse, and the window must not be inside out', () {
      expect(PromoOffer.tryParse(offer(startAt: 'next tuesday')), isNull);
      expect(PromoOffer.tryParse(offer(endAt: '2026-13-45')), isNull);
      expect(
          PromoOffer.tryParse(
              offer(startAt: '2026-10-01T00:00:00Z', endAt: '2026-09-01T00:00:00Z')),
          isNull);
      expect(PromoOffer.tryParse(offer(startAt: '', endAt: null)), isNotNull);
    });

    test('loose types are tolerated where the meaning is unambiguous', () {
      final o = PromoOffer.tryParse({
        ...offer(),
        'enabled': 'true',
        'priority': '7',
        'showCount': 2.0,
        'dismissible': 'false',
      })!;
      expect(o.enabled, isTrue);
      expect(o.priority, 7);
      expect(o.showCount, 2);
      expect(o.dismissible, isFalse);
    });

    test('parseList keeps the valid ones and drops the rest, in order', () {
      final list = PromoOffer.parseList([
        offer(id: 'a'),
        'junk',
        offer(id: 'b', destinationUrl: 'ftp://x'),
        null,
        offer(id: 'c', priority: 3),
      ]);
      expect(list.map((o) => o.id), ['a', 'c']);
      expect(PromoOffer.parseList('nope'), isEmpty);
      expect(PromoOffer.parseList(null), isEmpty);
    });
  });

  group('PromoSelector', () {
    PromoOffer p(Map<String, Object?> m) => PromoOffer.tryParse(m)!;

    test('a valid, enabled, live offer is selected', () {
      final chosen = PromoSelector.select([p(offer())], now: now);
      expect(chosen?.id, 'website-offer');
    });

    test('a disabled offer is not shown', () {
      expect(PromoSelector.select([p(offer(enabled: false))], now: now), isNull);
    });

    test('an expired offer is not shown', () {
      expect(
          PromoSelector.select([p(offer(endAt: '2026-09-01T00:00:00Z'))], now: now), isNull);
    });

    test('a future offer is not shown yet', () {
      expect(
          PromoSelector.select([p(offer(startAt: '2026-10-01T00:00:00Z'))], now: now),
          isNull);
      expect(
          PromoSelector.select(
              [p(offer(startAt: '2026-09-01T00:00:00Z', endAt: '2026-09-30T00:00:00Z'))],
              now: now),
          isNotNull);
    });

    test('only the highest-priority offer is shown when several apply', () {
      final chosen = PromoSelector.select([
        p(offer(id: 'low', priority: 1)),
        p(offer(id: 'high', priority: 9)),
        p(offer(id: 'mid', priority: 5)),
        p(offer(id: 'higher-but-off', priority: 99, enabled: false)),
      ], now: now);
      expect(chosen?.id, 'high');
    });

    test('equal priority keeps the published order', () {
      final chosen = PromoSelector.select([
        p(offer(id: 'first', priority: 3)),
        p(offer(id: 'second', priority: 3)),
      ], now: now);
      expect(chosen?.id, 'first');
    });

    test('a dismissed offer gives way to the next one', () {
      final chosen = PromoSelector.select([
        p(offer(id: 'top', priority: 9)),
        p(offer(id: 'next', priority: 1)),
      ], now: now, dismissedIds: {'top'});
      expect(chosen?.id, 'next');
    });

    test('an offer with a show count stops after that many impressions', () {
      final offers = [p(offer(id: 'twice', showCount: 2))];
      expect(PromoSelector.select(offers, now: now, impressions: {'twice': 1}), isNotNull);
      expect(PromoSelector.select(offers, now: now, impressions: {'twice': 2}), isNull);
      expect(
          PromoSelector.select([p(offer(id: 'unlimited'))],
              now: now, impressions: {'unlimited': 500}),
          isNotNull);
    });

    test('the audience is matched against the subscription state', () {
      const active = PromoAudienceContext(
          subscriptionStatus: SubscriptionStatus.active, subscriptionActive: true);
      const lapsed = PromoAudienceContext(
          subscriptionStatus: SubscriptionStatus.active, subscriptionActive: false);
      const limited = PromoAudienceContext(
          subscriptionStatus: SubscriptionStatus.limited, subscriptionActive: false);
      const expiring = PromoAudienceContext(
          subscriptionStatus: SubscriptionStatus.expiringSoon, subscriptionActive: true);

      final upgrade = p(offer(id: 'upgrade', targetAudience: 'NOT_ACTIVE'));
      final thanks = p(offer(id: 'thanks', targetAudience: 'ACTIVE'));
      final renew = p(offer(id: 'renew', targetAudience: 'EXPIRED'));
      final trial = p(offer(id: 'trial', targetAudience: 'LIMITED'));
      final soon = p(offer(id: 'soon', targetAudience: 'EXPIRING_SOON'));
      final all = [upgrade, thanks, renew, trial, soon];

      String? pick(PromoAudienceContext c) =>
          PromoSelector.select(all, now: now, context: c)?.id;

      expect(pick(active), 'thanks');
      expect(pick(expiring), 'thanks', reason: 'expiring soon still has access');
      expect(pick(limited), 'upgrade');
      expect(pick(lapsed), 'upgrade');
      expect(PromoSelector.select([renew], now: now, context: lapsed)?.id, 'renew');
      expect(PromoSelector.select([trial], now: now, context: limited)?.id, 'trial');
      expect(PromoSelector.select([soon], now: now, context: expiring)?.id, 'soon');
      expect(PromoSelector.select([soon], now: now, context: active), isNull);
    });

    test('while the subscription is unknown, only offers for everyone show', () {
      final chosen = PromoSelector.select([
        p(offer(id: 'targeted', targetAudience: 'ACTIVE', priority: 9)),
        p(offer(id: 'everyone', targetAudience: 'ALL')),
      ], now: now);
      expect(chosen?.id, 'everyone');
    });

    test('nothing valid means nothing shown', () {
      expect(PromoSelector.select(const [], now: now), isNull);
    });
  });

  group('PromoRepository', () {
    late FakeFirebaseFirestore firestore;
    final repo = PromoRepository.instance;

    setUp(() {
      SharedPreferences.setMockInitialValues({});
      firestore = FakeFirebaseFirestore();
      PromoRepository.firestoreOverride = firestore;
      PromoRepository.fetchOverride = null;
    });

    tearDown(() {
      PromoRepository.firestoreOverride = null;
      PromoRepository.fetchOverride = null;
    });

    test('reads the published document, Firestore timestamps included', () async {
      await firestore.doc(PromoRepository.docPath).set({
        'version': 1,
        'promos': [
          offer(id: 'a', startAt: Timestamp.fromDate(DateTime.utc(2026, 9, 1))),
          offer(id: 'b', endAt: Timestamp.fromDate(DateTime.utc(2026, 12, 31))),
        ],
      });
      final offers = await repo.load();
      expect(offers.map((o) => o.id), ['a', 'b']);
      expect(offers.first.startAt, DateTime.utc(2026, 9, 1));
      expect(offers.last.endAt, DateTime.utc(2026, 12, 31));
    });

    test('no document yet means no offers, not an error', () async {
      expect(await repo.load(), isEmpty);
    });

    test('a malformed document does not crash and yields nothing', () async {
      await firestore.doc(PromoRepository.docPath).set({'promos': 'not a list'});
      expect(await repo.load(), isEmpty);

      await firestore.doc(PromoRepository.docPath).set({'promos': [1, 'x', null, {}]});
      expect(await repo.load(), isEmpty);

      await firestore.doc(PromoRepository.docPath).set({'promos': {'id': 'map-not-list'}});
      expect(await repo.load(), isEmpty);
    });

    test('a failed fetch falls back to the last document that arrived', () async {
      await firestore.doc(PromoRepository.docPath).set({'promos': [offer(id: 'cached')]});
      expect((await repo.load()).single.id, 'cached');

      PromoRepository.fetchOverride = () async => throw StateError('offline');
      expect((await repo.load()).single.id, 'cached');
    });

    test('a failed fetch with nothing cached is simply no offers', () async {
      PromoRepository.fetchOverride = () async => throw StateError('offline');
      expect(await repo.load(), isEmpty);
    });

    test('a corrupt cache is ignored', () async {
      SharedPreferences.setMockInitialValues({PromoRepository.lastKnownKey: '{not json'});
      PromoRepository.fetchOverride = () async => throw StateError('offline');
      expect(await repo.load(), isEmpty);
    });

    test('dismissals and impressions persist per device', () async {
      expect(await repo.dismissedIds(), isEmpty);
      await repo.dismiss('a');
      await repo.dismiss('b');
      await repo.dismiss('a');
      expect(await repo.dismissedIds(), {'a', 'b'});

      expect(await repo.impressions(), isEmpty);
      await repo.recordImpression('a');
      await repo.recordImpression('a');
      await repo.recordImpression('b');
      expect(await repo.impressions(), {'a': 2, 'b': 1});
    });
  });
}
