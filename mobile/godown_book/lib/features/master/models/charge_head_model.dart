/// How a charge line prints on a bill.
///
/// A line can carry an amount, or be marked as included in the rent,
/// excluded, or not applicable - and the customer must be able to see
/// which is which.
enum ChargeMode {
  amount,
  included,
  excluded,
  notApplicable;

  String get code => switch (this) {
    ChargeMode.amount => 'AMOUNT',
    ChargeMode.included => 'INCLUDED',
    ChargeMode.excluded => 'EXCLUDED',
    ChargeMode.notApplicable => 'NA',
  };

  String get label => switch (this) {
    ChargeMode.amount => 'Amount',
    ChargeMode.included => 'Included',
    ChargeMode.excluded => 'Excluded',
    ChargeMode.notApplicable => 'N/A',
  };

  /// What the customer sees in the Amount column.
  String get printedValue => switch (this) {
    ChargeMode.amount => '',
    ChargeMode.included => 'Included',
    ChargeMode.excluded => 'Excluded',
    ChargeMode.notApplicable => 'N/A',
  };

  static ChargeMode fromCode(String? code) => switch (code) {
    'INCLUDED' => ChargeMode.included,
    'EXCLUDED' => ChargeMode.excluded,
    'NA' => ChargeMode.notApplicable,
    _ => ChargeMode.amount,
  };
}

/// A configurable charge head in the Master.
///
/// Everything that can appear as a line on a rent bill lives here, so new
/// heads (Fumigation, Crane, Insurance...) can be added without a release.
class ChargeHeadModel {
  final String id;
  final String code;
  final String chargeName;

  /// Mode pre-selected when a new bill is started.
  final ChargeMode defaultMode;

  /// Amount pre-filled when [defaultMode] is [ChargeMode.amount].
  final double defaultAmount;

  /// Whether GST applies to this line.
  final bool taxable;

  /// System heads cannot be deleted - the print layout depends on them.
  final bool isSystem;

  final int sortOrder;
  final bool isActive;

  /// Optional longer-form explanation of what this charge covers - shown
  /// in Masters, not on the printed quotation/invoice (which use
  /// chargeName only, unchanged).
  final String description;

  const ChargeHeadModel({
    required this.id,
    required this.code,
    required this.chargeName,
    this.defaultMode = ChargeMode.amount,
    this.defaultAmount = 0,
    this.taxable = true,
    this.isSystem = false,
    required this.sortOrder,
    this.isActive = true,
    this.description = '',
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'code': code,
      'charge_name': chargeName,
      'default_mode': defaultMode.code,
      'default_amount': defaultAmount,
      'taxable': taxable ? 1 : 0,
      'is_system': isSystem ? 1 : 0,
      'sort_order': sortOrder,
      'is_active': isActive ? 1 : 0,
      'description': description,
    };
  }

  factory ChargeHeadModel.fromMap(Map<String, dynamic> map) {
    return ChargeHeadModel(
      id: map['id'] as String,
      code: map['code'] as String,
      chargeName: map['charge_name'] as String,
      defaultMode: ChargeMode.fromCode(map['default_mode'] as String?),
      defaultAmount: (map['default_amount'] ?? 0).toDouble(),
      taxable: (map['taxable'] ?? 1) == 1,
      isSystem: (map['is_system'] ?? 0) == 1,
      sortOrder: map['sort_order'] as int,
      isActive: (map['is_active'] ?? 1) == 1,
      description: map['description'] as String? ?? '',
    );
  }

  ChargeHeadModel copyWith({
    String? id,
    String? code,
    String? chargeName,
    ChargeMode? defaultMode,
    double? defaultAmount,
    bool? taxable,
    bool? isSystem,
    int? sortOrder,
    bool? isActive,
    String? description,
  }) {
    return ChargeHeadModel(
      id: id ?? this.id,
      code: code ?? this.code,
      chargeName: chargeName ?? this.chargeName,
      defaultMode: defaultMode ?? this.defaultMode,
      defaultAmount: defaultAmount ?? this.defaultAmount,
      taxable: taxable ?? this.taxable,
      isSystem: isSystem ?? this.isSystem,
      sortOrder: sortOrder ?? this.sortOrder,
      isActive: isActive ?? this.isActive,
      description: description ?? this.description,
    );
  }
}
