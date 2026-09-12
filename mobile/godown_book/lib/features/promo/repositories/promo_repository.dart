import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/promo_offer.dart';

/// Where the dashboard's promotional offers come from.
///
/// One Firestore document, `platformSettings/promotions`, holding a
/// `promos` list - the same arrangement as PlatformSettingsService's
/// payment settings: read by every signed-in user, written only by a
/// Super Admin (the existing `platformSettings/{document}` rule covers
/// it, nothing to deploy), editable in the Firebase Console today and
/// from an in-app screen whenever one is built.
///
/// The banner must never be something the app depends on, so every
/// path here ends in a list, possibly empty: a fetch that fails for
/// any reason (offline, permission, timeout, garbage) falls back to
/// the last document that parsed, kept in SharedPreferences, and then
/// to nothing at all. Dismissals and show counts live in the same
/// preferences - per device, like a dismissed banner should be.
class PromoRepository {
  PromoRepository._();

  static final PromoRepository instance = PromoRepository._();

  static const String docPath = 'platformSettings/promotions';

  static const String lastKnownKey = 'promo_last_known_json';
  static const String dismissedKey = 'promo_dismissed_ids';
  static const String impressionsKey = 'promo_impressions_json';

  static const Duration _timeout = Duration(seconds: 10);

  /// Test seam, as on SubscriptionRepository: an in-memory Firestore.
  static FirebaseFirestore? firestoreOverride;

  /// Test seam for the fetch itself, so a failing network can be
  /// simulated without a Firestore that throws.
  static Future<Map<String, dynamic>?> Function()? fetchOverride;

  FirebaseFirestore get _firestore =>
      firestoreOverride ?? FirebaseFirestore.instance;

  /// The offers to choose from, freshest available. Never throws.
  Future<List<PromoOffer>> load() async {
    Map<String, dynamic>? data;
    try {
      data = await (fetchOverride ?? _fetch)();
    } catch (error) {
      debugPrint('Promotions not fetched: $error');
      data = null;
    }

    if (data != null) {
      final offers = PromoOffer.parseList(_plain(data['promos']));
      await _remember(data);
      return offers;
    }

    return _lastKnown();
  }

  Future<Map<String, dynamic>?> _fetch() async {
    final snapshot = await _firestore.doc(docPath).get().timeout(_timeout);
    return snapshot.data();
  }

  /// Keeps the last document that arrived, as JSON, so an offline
  /// launch still shows what the owner last published. Firestore
  /// Timestamps become ISO strings here, which is also what the model
  /// parses.
  Future<void> _remember(Map<String, dynamic> data) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(lastKnownKey, jsonEncode(_plain(data)));
    } catch (_) {
      // A cache that cannot be written is not a reason to hide an
      // offer that just arrived.
    }
  }

  Future<List<PromoOffer>> _lastKnown() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(lastKnownKey);
      if (raw == null || raw.isEmpty) return const [];
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return const [];
      return PromoOffer.parseList(decoded['promos']);
    } catch (_) {
      return const [];
    }
  }

  Future<Set<String>> dismissedIds() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return (prefs.getStringList(dismissedKey) ?? const []).toSet();
    } catch (_) {
      return const {};
    }
  }

  Future<void> dismiss(String id) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final ids = (prefs.getStringList(dismissedKey) ?? const []).toSet()..add(id);
      await prefs.setStringList(dismissedKey, ids.toList());
    } catch (_) {
      // Worst case the offer reappears next launch.
    }
  }

  Future<Map<String, int>> impressions() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(impressionsKey);
      if (raw == null || raw.isEmpty) return const {};
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return const {};
      return {
        for (final e in decoded.entries)
          if (e.key is String && e.value is int) e.key as String: e.value as int,
      };
    } catch (_) {
      return const {};
    }
  }

  Future<void> recordImpression(String id) async {
    try {
      final counts = Map<String, int>.from(await impressions());
      counts[id] = (counts[id] ?? 0) + 1;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(impressionsKey, jsonEncode(counts));
    } catch (_) {
      // Counting is best-effort.
    }
  }

  /// Converts Firestore-specific values (Timestamp, nested maps with
  /// non-string keys) into plain JSON-encodable Dart so the model and
  /// the cache both see one shape.
  static Object? _plain(Object? value) {
    if (value is Timestamp) return value.toDate().toUtc().toIso8601String();
    if (value is DateTime) return value.toUtc().toIso8601String();
    if (value is Map) {
      return {for (final e in value.entries) e.key.toString(): _plain(e.value)};
    }
    if (value is List) return [for (final v in value) _plain(v)];
    return value;
  }
}
