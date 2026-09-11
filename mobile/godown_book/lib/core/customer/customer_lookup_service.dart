import '../../features/customers/repositories/customer_repository.dart';

/// One known customer, assembled from whatever the Customer master (and,
/// through [extraSources], earlier documents) recorded about them.
///
/// Fields are filled opportunistically: whichever source has a
/// non-empty value for a field wins, and later sources never blank out
/// something an earlier one already provided (see
/// CustomerLookupService._merge).
class CustomerSuggestion {
  final String name;
  final String phone;
  final String gst;
  final String address;
  final String city;
  final String state;
  final String pincode;

  /// The Customer master row this came from, when it did - lets a form
  /// link the document back to the master instead of re-creating it.
  final String customerId;

  /// Where this was last seen ("Customer", "Warehouse Receipt", "Bill") -
  /// shown under the suggestion so the user knows why it is offered.
  final String source;

  const CustomerSuggestion({
    required this.name,
    this.phone = '',
    this.gst = '',
    this.address = '',
    this.city = '',
    this.state = '',
    this.pincode = '',
    this.customerId = '',
    this.source = '',
  });

  CustomerSuggestion _merge(CustomerSuggestion other) {
    String pick(String a, String b) => a.trim().isNotEmpty ? a : b;

    return CustomerSuggestion(
      name: name,
      phone: pick(phone, other.phone),
      gst: pick(gst, other.gst),
      address: pick(address, other.address),
      city: pick(city, other.city),
      state: pick(state, other.state),
      pincode: pick(pincode, other.pincode),
      customerId: pick(customerId, other.customerId),
      source: source.isNotEmpty ? source : other.source,
    );
  }

  /// A short line describing what is known, for the dropdown's
  /// second row - never fabricated, only what genuinely exists.
  String get subtitle {
    final bits = <String>[
      if (phone.trim().isNotEmpty) phone.trim(),
      if (city.trim().isNotEmpty) city.trim(),
      if (source.isNotEmpty) 'from $source',
    ];
    return bits.join('  •  ');
  }
}

/// A function that contributes suggestions from one more source (a
/// document repository). Registered by feature code so this core
/// service never imports a feature it doesn't own.
typedef CustomerSuggestionSource = Future<List<CustomerSuggestion>> Function();

/// Suggests customers already recorded anywhere in this company's own
/// data, so the same depositor entered last month comes back as a
/// suggestion when their next Warehouse Receipt or Bill is raised.
///
/// Every repository it reads is already company-scoped (see
/// TenantScope and the DAO layer), so this can never surface another
/// company's customers.
class CustomerLookupService {
  CustomerLookupService._();

  static final CustomerLookupService instance = CustomerLookupService._();

  final List<CustomerSuggestionSource> extraSources = [];

  /// Cached for the life of the screen that asked - these lists are
  /// small (one company's own records) and a fresh database read on
  /// every keystroke would make typing feel sluggish.
  List<CustomerSuggestion>? _cache;

  /// Call after saving a customer or document so the next lookup
  /// genuinely includes what was just entered.
  void invalidate() => _cache = null;

  Future<List<CustomerSuggestion>> _all() async {
    final cached = _cache;
    if (cached != null) return cached;

    final merged = <String, CustomerSuggestion>{};

    void add(CustomerSuggestion s) {
      final key = s.name.trim().toLowerCase();
      if (key.isEmpty) return;
      final existing = merged[key];
      merged[key] = existing == null ? s : existing._merge(s);
    }

    try {
      for (final c in await CustomerRepository.instance.getAll(activeOnly: true)) {
        add(CustomerSuggestion(
          name: c.customerName,
          phone: c.mobileNumber,
          gst: c.gstNumber,
          address: c.address,
          city: c.city,
          state: c.state,
          pincode: c.pincode,
          customerId: c.id,
          source: 'Customer',
        ));
      }
    } catch (_) {
      // A single source being unavailable must not kill suggestions
      // from the others - typing should keep working regardless.
    }

    for (final source in extraSources) {
      try {
        for (final s in await source()) {
          add(s);
        }
      } catch (_) {}
    }

    final list = merged.values.toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));

    _cache = list;
    return list;
  }

  /// Names containing [query] (case-insensitive). An empty query
  /// returns nothing rather than the whole list - a dropdown of every
  /// customer the moment a field is focused is noise, not help.
  Future<List<CustomerSuggestion>> search(String query) async {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return const [];

    final all = await _all();

    return all
        .where((c) =>
            c.name.toLowerCase().contains(q) || c.phone.contains(q))
        .take(6)
        .toList();
  }
}
