/// One promotional offer as it arrives from the platform's remote
/// configuration (Firestore `platformSettings/promotions`, see
/// PromoRepository) - a StorageBill Pro feature announcement, a
/// subscription nudge, or a partner's offer. The same shape serves all
/// three, so a future Business Marketplace is a matter of publishing
/// more of these, not of new code.
///
/// Everything remote is untrusted: [PromoOffer.tryParse] returns null
/// for anything it cannot fully validate, and nothing here is ever
/// executed - a destination is data that PromoDestinationLauncher
/// interprets against fixed allowlists.
library;

/// What the offer is about. Decides the badge the card wears.
enum PromoCategory {
  businessGrowth('BUSINESS_GROWTH', 'SPECIAL OFFER'),
  operations('OPERATIONS', 'SPECIAL OFFER'),
  securityProtection('SECURITY_PROTECTION', 'SPECIAL OFFER'),
  paymentsFinance('PAYMENTS_FINANCE', 'SPECIAL OFFER'),
  storagebillFeature('STORAGEBILL_FEATURE', 'STORAGEBILL FEATURE'),
  partnerOffer('PARTNER_OFFER', 'PARTNER OFFER');

  final String code;

  /// The badge shown when the offer does not name its own.
  final String defaultBadge;

  const PromoCategory(this.code, this.defaultBadge);

  static PromoCategory? fromCode(String? code) {
    for (final c in values) {
      if (c.code == code) return c;
    }
    return null;
  }
}

/// Where the CTA takes the user. Each type is interpreted by
/// PromoDestinationLauncher against its own allowlist.
enum PromoDestinationType {
  inApp('IN_APP'),
  webUrl('WEB_URL'),
  whatsapp('WHATSAPP'),
  phone('PHONE'),
  subscription('SUBSCRIPTION'),
  feature('FEATURE');

  final String code;

  const PromoDestinationType(this.code);

  static PromoDestinationType? fromCode(String? code) {
    for (final t in values) {
      if (t.code == code) return t;
    }
    return null;
  }
}

/// Who should see the offer, in terms of the company's own
/// subscription state - the only audience signal the app has locally.
enum PromoAudience {
  all('ALL'),
  active('ACTIVE'),
  notActive('NOT_ACTIVE'),
  limited('LIMITED'),
  expiringSoon('EXPIRING_SOON'),
  expired('EXPIRED');

  final String code;

  const PromoAudience(this.code);

  static PromoAudience? fromCode(String? code) {
    for (final a in values) {
      if (a.code == code) return a;
    }
    return null;
  }
}

class PromoOffer {
  final String id;
  final bool enabled;
  final PromoCategory category;

  /// Badge text override. Empty means the category's own default.
  final String badge;
  final String title;
  final String subtitle;
  final String description;

  /// Up to three short benefit lines. More are ignored at render time.
  final List<String> bullets;

  /// https image, or empty for a text-only card.
  final String imageUrl;
  final String ctaText;
  final PromoDestinationType destinationType;

  /// The https URL for WEB_URL, or the phone number for WHATSAPP/PHONE.
  final String destinationUrl;

  /// A GoRouter path for IN_APP/FEATURE - one of [allowedInternalRoutes].
  final String internalRoute;
  final int priority;
  final DateTime? startAt;
  final DateTime? endAt;
  final PromoAudience targetAudience;
  final bool dismissible;

  /// Maximum number of times to show this offer on this device; 0 =
  /// no limit.
  final int showCount;
  final String partnerName;

  /// Badge text for a partner's offer, e.g. "PARTNER OFFER" or
  /// "SPONSORED". Shown instead of the category badge when set, so a
  /// paid promotion is always labelled as one.
  final String partnerLabel;

  const PromoOffer({
    required this.id,
    required this.enabled,
    required this.category,
    this.badge = '',
    required this.title,
    this.subtitle = '',
    this.description = '',
    this.bullets = const [],
    this.imageUrl = '',
    required this.ctaText,
    required this.destinationType,
    this.destinationUrl = '',
    this.internalRoute = '',
    this.priority = 0,
    this.startAt,
    this.endAt,
    this.targetAudience = PromoAudience.all,
    this.dismissible = true,
    this.showCount = 0,
    this.partnerName = '',
    this.partnerLabel = '',
  });

  /// The only in-app screens an offer may point at: every route here
  /// exists in AppRouter and needs no `extra` argument. Anything else
  /// makes the offer invalid rather than risking a route that throws.
  static const Set<String> allowedInternalRoutes = {
    '/subscription',
    '/subscription-history',
    '/settings',
    '/company-settings',
    '/kyc',
    '/reports',
    '/quotations',
    '/storage',
    '/storage-create',
    '/bills',
    '/payments',
    '/customers',
    '/customer-create',
    '/documents',
    '/users-roles',
    '/cloud-backup',
    '/charge-heads',
    '/storage-locations',
  };

  /// True when the offer comes from a named partner - the card must
  /// then say so.
  bool get isPartnerOffer =>
      partnerName.isNotEmpty || category == PromoCategory.partnerOffer;

  /// The badge the card shows.
  String get badgeText {
    if (partnerLabel.isNotEmpty) return partnerLabel;
    if (badge.isNotEmpty) return badge;
    if (isPartnerOffer) return PromoCategory.partnerOffer.defaultBadge;
    return category.defaultBadge;
  }

  /// The offer's visibility window contains [now].
  bool isLiveAt(DateTime now) {
    final start = startAt;
    final end = endAt;
    if (start != null && now.isBefore(start)) return false;
    if (end != null && now.isAfter(end)) return false;
    return true;
  }

  /// The https URL for a WEB_URL offer, already validated.
  Uri? get webUri =>
      destinationType == PromoDestinationType.webUrl ? Uri.tryParse(destinationUrl) : null;

  /// Parses one remote offer. Null for anything malformed, missing a
  /// required field, or pointing somewhere the app will not go. Never
  /// throws.
  static PromoOffer? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final map = raw;

    final id = _string(map['id']);
    final title = _string(map['title']);
    final ctaText = _string(map['ctaText']);
    final category = PromoCategory.fromCode(_string(map['category']));
    final destinationType =
        PromoDestinationType.fromCode(_string(map['destinationType']));
    if (id.isEmpty || title.isEmpty || ctaText.isEmpty) return null;
    if (category == null || destinationType == null) return null;
    if (id.length > 80 || title.length > 120 || ctaText.length > 40) return null;

    final destinationUrl = _string(map['destinationUrl']);
    final internalRoute = _string(map['internalRoute']);
    if (!_destinationValid(destinationType, destinationUrl, internalRoute)) {
      return null;
    }

    final imageUrl = _string(map['imageUrl']);
    if (imageUrl.isNotEmpty && !_isHttps(imageUrl)) return null;

    final startAt = _date(map['startAt']);
    final endAt = _date(map['endAt']);
    if (startAt == null && map['startAt'] != null && _string(map['startAt']).isNotEmpty) {
      return null;
    }
    if (endAt == null && map['endAt'] != null && _string(map['endAt']).isNotEmpty) {
      return null;
    }
    if (startAt != null && endAt != null && endAt.isBefore(startAt)) return null;

    final audienceCode = _string(map['targetAudience']);
    final audience = audienceCode.isEmpty
        ? PromoAudience.all
        : PromoAudience.fromCode(audienceCode);
    if (audience == null) return null;

    final bullets = <String>[];
    final rawBullets = map['bullets'];
    if (rawBullets is List) {
      for (final b in rawBullets) {
        final s = _string(b);
        if (s.isNotEmpty) bullets.add(s);
      }
    }

    return PromoOffer(
      id: id,
      enabled: _bool(map['enabled'], fallback: false),
      category: category,
      badge: _string(map['badge']),
      title: title,
      subtitle: _string(map['subtitle']),
      description: _string(map['description']),
      bullets: List.unmodifiable(bullets),
      imageUrl: imageUrl,
      ctaText: ctaText,
      destinationType: destinationType,
      destinationUrl: destinationUrl,
      internalRoute: internalRoute,
      priority: _int(map['priority']),
      startAt: startAt,
      endAt: endAt,
      targetAudience: audience,
      dismissible: _bool(map['dismissible'], fallback: true),
      showCount: _int(map['showCount']).clamp(0, 1000000),
      partnerName: _string(map['partnerName']),
      partnerLabel: _string(map['partnerLabel']),
    );
  }

  /// Parses the whole `promos` list of the remote document, dropping
  /// every entry that does not parse. Anything that is not a list is
  /// no offers at all.
  static List<PromoOffer> parseList(Object? raw) {
    if (raw is! List) return const [];
    final out = <PromoOffer>[];
    for (final item in raw) {
      final offer = tryParse(item);
      if (offer != null) out.add(offer);
    }
    return out;
  }

  static bool _destinationValid(
    PromoDestinationType type,
    String destinationUrl,
    String internalRoute,
  ) {
    switch (type) {
      case PromoDestinationType.webUrl:
        return _isHttps(destinationUrl);
      case PromoDestinationType.whatsapp:
      case PromoDestinationType.phone:
        final digits = destinationUrl.replaceAll(RegExp(r'[^0-9]'), '');
        return digits.length >= 10 && digits.length <= 15;
      case PromoDestinationType.inApp:
      case PromoDestinationType.feature:
        return allowedInternalRoutes.contains(internalRoute);
      case PromoDestinationType.subscription:
        return true;
    }
  }

  static bool _isHttps(String value) {
    final uri = Uri.tryParse(value);
    return uri != null &&
        uri.scheme == 'https' &&
        uri.host.isNotEmpty &&
        uri.host.contains('.');
  }

  static String _string(Object? v) => v is String ? v.trim() : '';

  static bool _bool(Object? v, {required bool fallback}) {
    if (v is bool) return v;
    if (v is String) {
      if (v.toLowerCase() == 'true') return true;
      if (v.toLowerCase() == 'false') return false;
    }
    return fallback;
  }

  static int _int(Object? v) {
    if (v is int) return v;
    if (v is num) return v.round();
    if (v is String) return int.tryParse(v.trim()) ?? 0;
    return 0;
  }

  /// ISO-8601 strings only - the repository converts Firestore
  /// Timestamps to that form before the model sees them. Dart's own
  /// parser quietly rolls "2026-13-45" over into the next year, so the
  /// calendar fields are range-checked here first.
  static DateTime? _date(Object? v) {
    if (v is DateTime) return v.toUtc();
    if (v is! String) return null;
    final s = v.trim();
    if (s.isEmpty) return null;
    final m = _isoDatePrefix.firstMatch(s);
    if (m == null) return null;
    final month = int.parse(m[2]!);
    final day = int.parse(m[3]!);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return DateTime.tryParse(s)?.toUtc();
  }

  static final RegExp _isoDatePrefix = RegExp(r'^(\d{4})-(\d{2})-(\d{2})');
}
