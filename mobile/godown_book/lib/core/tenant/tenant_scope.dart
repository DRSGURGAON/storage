/// Holds the company (tenant) the app is currently working on.
///
/// Every business row carries a `company_id`. Rather than making each screen
/// remember to pass it, the DAO layer reads it from here. That way a missing
/// tenant filter is impossible to introduce by forgetting a WHERE clause.
///
/// Today one subscriber owns exactly one company, so this is set once at
/// startup. The indirection exists so that adding a company switcher later
/// touches only this class.
class TenantScope {
  TenantScope._();

  static String? _companyId;

  /// The active company id. Throws if the app reached a data call before
  /// onboarding completed - that is a routing bug, not a user error.
  static String get companyId {
    final id = _companyId;

    if (id == null || id.isEmpty) {
      throw StateError(
        'TenantScope has no company. A screen queried data before company '
        'onboarding finished - check the router redirect.',
      );
    }

    return id;
  }

  static String? get companyIdOrNull => _companyId;

  static bool get isReady => _companyId != null && _companyId!.isNotEmpty;

  static void set(String companyId) {
    if (companyId.isEmpty) {
      throw ArgumentError('companyId cannot be empty.');
    }

    _companyId = companyId;
  }

  /// Used on sign-out and in tests.
  static void clear() => _companyId = null;
}
