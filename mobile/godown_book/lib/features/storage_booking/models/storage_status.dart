/// Where a storage booking stands - derived from its items' released
/// quantities on every goods release, and stored on the row so list
/// screens never re-add them.
enum StorageStatus {
  inStorage,
  partiallyReleased,
  released,
  cancelled;

  String get code => switch (this) {
        StorageStatus.inStorage => 'IN_STORAGE',
        StorageStatus.partiallyReleased => 'PARTIALLY_RELEASED',
        StorageStatus.released => 'RELEASED',
        StorageStatus.cancelled => 'CANCELLED',
      };

  String get label => switch (this) {
        StorageStatus.inStorage => 'In Storage',
        StorageStatus.partiallyReleased => 'Partly Released',
        StorageStatus.released => 'Released',
        StorageStatus.cancelled => 'Cancelled',
      };

  /// Rent keeps accruing while any goods remain in the godown.
  bool get isOpen =>
      this == StorageStatus.inStorage || this == StorageStatus.partiallyReleased;

  static StorageStatus fromCode(String? code) => switch (code) {
        'PARTIALLY_RELEASED' => StorageStatus.partiallyReleased,
        'RELEASED' => StorageStatus.released,
        'CANCELLED' => StorageStatus.cancelled,
        _ => StorageStatus.inStorage,
      };
}

/// How the storage charge on a record is worked out when a bill is
/// raised. Four ways an operator actually charges - nothing more.
enum RentBasis {
  /// A fixed amount for every started month.
  monthly,

  /// An amount for every day the goods are with us.
  daily,

  /// An amount per box or article, for every started month.
  perBoxMonthly,

  /// A flat agreed amount per bill, however long the period is.
  custom;

  String get code => switch (this) {
        RentBasis.monthly => 'MONTHLY',
        RentBasis.daily => 'DAILY',
        RentBasis.perBoxMonthly => 'PER_BOX_MONTHLY',
        RentBasis.custom => 'CUSTOM',
      };

  String get label => switch (this) {
        RentBasis.monthly => 'Per month',
        RentBasis.daily => 'Per day',
        RentBasis.perBoxMonthly => 'Per box / month',
        RentBasis.custom => 'Fixed amount',
      };

  /// What the rate means, for a form hint or a printed line.
  String get rateHint => switch (this) {
        RentBasis.monthly => 'per month',
        RentBasis.daily => 'per day',
        RentBasis.perBoxMonthly => 'per box per month',
        RentBasis.custom => 'per bill',
      };

  static RentBasis fromCode(String? code) => switch (code) {
        'DAILY' => RentBasis.daily,
        'PER_BOX_MONTHLY' => RentBasis.perBoxMonthly,
        'CUSTOM' => RentBasis.custom,
        _ => RentBasis.monthly,
      };
}
