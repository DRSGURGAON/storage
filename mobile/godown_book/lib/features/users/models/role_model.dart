/// A role within one company - not a fixed enum, so custom roles can be
/// added later (Section: "do not hardcode the system so additional
/// custom roles cannot be added later") by simply inserting a new row,
/// exactly like ChargeHeadModel/VehicleModel already work for their own
/// domains. The 6 default roles the task requires are seeded exactly
/// like the existing charge-head/CFT seed data (see
/// _seedDefaultRoles in app_database.dart) - same code-based-skip
/// idempotent pattern, not a special case.
class RoleModel {
  final String id;
  final String code;
  final String name;

  /// True for the 6 built-in roles (Company Admin, Manager, Sales,
  /// Operations, Accounts, Staff) - mirrors
  /// ChargeHeadModel.isSystem's exact meaning: shown and usable exactly
  /// like a custom role, but not deletable, since Company Admin in
  /// particular must always exist and always retain full access.
  final bool isSystem;

  final bool isActive;
  final int sortOrder;

  const RoleModel({
    required this.id,
    required this.code,
    required this.name,
    this.isSystem = false,
    this.isActive = true,
    this.sortOrder = 0,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'code': code,
      'name': name,
      'is_system': isSystem ? 1 : 0,
      'is_active': isActive ? 1 : 0,
      'sort_order': sortOrder,
    };
  }

  factory RoleModel.fromMap(Map<String, dynamic> map) {
    return RoleModel(
      id: map['id'] as String,
      code: map['code'] as String,
      name: map['name'] as String,
      isSystem: map['is_system'] == 1,
      isActive: map['is_active'] == 1,
      sortOrder: map['sort_order'] as int? ?? 0,
    );
  }

  RoleModel copyWith({
    String? name,
    bool? isActive,
    int? sortOrder,
  }) {
    return RoleModel(
      id: id,
      code: code,
      name: name ?? this.name,
      isSystem: isSystem,
      isActive: isActive ?? this.isActive,
      sortOrder: sortOrder ?? this.sortOrder,
    );
  }
}
