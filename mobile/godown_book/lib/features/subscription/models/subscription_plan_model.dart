/// A configurable subscription plan (Section 2) - platform-wide, not
/// scoped to any one company (a Quarterly plan is the same plan every
/// company sees). Prices are NOT hardcoded - Super Admin configures
/// them, matching the task's explicit "Plan prices must NOT be
/// hard-coded" instruction. The 4 default plans (Quarterly/Half-Yearly/
/// Yearly/2-Year) are seeded once with price 0 (Super Admin must set
/// real prices before anyone can subscribe) - same idempotent
/// code-based-skip seeding pattern already used throughout this
/// project (charge heads, default roles).
class SubscriptionPlanModel {
  final String id;
  final String code;
  final String name;

  /// Plan length in months - the unit Section 2's examples use
  /// throughout (3/6/12/24).
  final int durationMonths;

  final double price;
  final double discountAmount;
  final double taxPercent;

  final int sortOrder;
  final bool isActive;

  /// Highlighted as the suggested plan on the Subscription screen
  /// (Section 7: "Highlight recommended plan if configured by Admin").
  /// At most one plan should have this true at a time - enforced at
  /// the repository layer, not the database (matches how isSystem/
  /// isDefault flags are handled elsewhere in this project).
  final bool isRecommended;

  const SubscriptionPlanModel({
    required this.id,
    required this.code,
    required this.name,
    required this.durationMonths,
    this.price = 0,
    this.discountAmount = 0,
    this.taxPercent = 0,
    this.sortOrder = 0,
    this.isActive = true,
    this.isRecommended = false,
  });

  /// Final payable amount after discount and tax - computed, not
  /// stored, so changing taxPercent/discountAmount later never leaves
  /// a stale total lying around.
  double get finalAmount {
    final afterDiscount = price - discountAmount;
    final tax = afterDiscount * (taxPercent / 100);

    return afterDiscount + tax;
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'code': code,
      'name': name,
      'duration_months': durationMonths,
      'price': price,
      'discount_amount': discountAmount,
      'tax_percent': taxPercent,
      'sort_order': sortOrder,
      'is_active': isActive ? 1 : 0,
      'is_recommended': isRecommended ? 1 : 0,
    };
  }

  factory SubscriptionPlanModel.fromMap(Map<String, dynamic> map) {
    return SubscriptionPlanModel(
      id: map['id'] as String,
      code: map['code'] as String,
      name: map['name'] as String,
      durationMonths: map['duration_months'] as int? ?? 0,
      price: (map['price'] as num?)?.toDouble() ?? 0,
      discountAmount: (map['discount_amount'] as num?)?.toDouble() ?? 0,
      taxPercent: (map['tax_percent'] as num?)?.toDouble() ?? 0,
      sortOrder: map['sort_order'] as int? ?? 0,
      isActive: map['is_active'] == 1,
      isRecommended: map['is_recommended'] == 1,
    );
  }

  SubscriptionPlanModel copyWith({
    String? name,
    int? durationMonths,
    double? price,
    double? discountAmount,
    double? taxPercent,
    int? sortOrder,
    bool? isActive,
    bool? isRecommended,
  }) {
    return SubscriptionPlanModel(
      id: id,
      code: code,
      name: name ?? this.name,
      durationMonths: durationMonths ?? this.durationMonths,
      price: price ?? this.price,
      discountAmount: discountAmount ?? this.discountAmount,
      taxPercent: taxPercent ?? this.taxPercent,
      sortOrder: sortOrder ?? this.sortOrder,
      isActive: isActive ?? this.isActive,
      isRecommended: isRecommended ?? this.isRecommended,
    );
  }
}
