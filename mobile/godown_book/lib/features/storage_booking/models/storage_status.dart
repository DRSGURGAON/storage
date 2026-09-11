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

/// How the rent rate on a booking is applied.
enum RentBasis {
  monthly,
  daily;

  String get code => switch (this) {
        RentBasis.monthly => 'MONTHLY',
        RentBasis.daily => 'DAILY',
      };

  String get label => switch (this) {
        RentBasis.monthly => 'Per month',
        RentBasis.daily => 'Per day',
      };

  static RentBasis fromCode(String? code) =>
      code == 'DAILY' ? RentBasis.daily : RentBasis.monthly;
}
