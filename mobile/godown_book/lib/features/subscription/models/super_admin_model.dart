/// A platform-level Super Admin (Sections 14, 32) - the mechanism
/// behind SuperAdminScope's cross-company access check. Deliberately
/// NOT company-scoped (no company_id) and NOT part of the existing
/// per-company RoleModel/UserModel system: those model "who can do
/// what within one company" (see PermissionService), while Super Admin
/// is "who can see/act across every company's subscriptions" - a
/// fundamentally different, platform-wide authorization tier that
/// Option A's design explicitly calls for (a Super Admin Dashboard
/// showing "TOTAL COMPANIES" - impossible to express as a permission
/// within any single company's Role system).
///
/// Identified the same way every other session-level check in this
/// project already works: by the signed-in mobile number (see
/// PermissionService.currentMobileNumberOverride) - not a second
/// authentication system, an additional authorization check layered
/// on the same verified phone number OtpAuthService already confirmed.
class SuperAdminModel {
  final String id;
  final String mobileNumber;
  final String name;
  final bool isActive;
  final String createdAt;

  const SuperAdminModel({
    required this.id,
    required this.mobileNumber,
    this.name = '',
    this.isActive = true,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'mobile_number': mobileNumber,
      'name': name,
      'is_active': isActive ? 1 : 0,
      'created_at': createdAt,
    };
  }

  factory SuperAdminModel.fromMap(Map<String, dynamic> map) {
    return SuperAdminModel(
      id: map['id'] as String,
      mobileNumber: map['mobile_number'] as String,
      name: map['name'] as String? ?? '',
      isActive: map['is_active'] == 1,
      createdAt: map['created_at'] as String? ?? '',
    );
  }

  /// Firestore's own document shape, at superAdmins/{uid} - the uid IS
  /// the document id (see SuperAdminFirestoreService's own doc
  /// comment for why this is what a Security Rules check needs), so
  /// [uid] is still written into the body too for a reader that got
  /// this via a collection query rather than a direct doc lookup.
  Map<String, dynamic> toFirestore(String uid) {
    return {
      'id': id,
      'uid': uid,
      'mobileNumber': mobileNumber,
      'name': name,
      'isActive': isActive,
      'createdAt': createdAt,
    };
  }

  factory SuperAdminModel.fromFirestore(
    Map<String, dynamic> data,
    String documentId,
  ) {
    return SuperAdminModel(
      id: data['id'] as String? ?? documentId,
      mobileNumber: data['mobileNumber'] as String? ?? '',
      name: data['name'] as String? ?? '',
      isActive: data['isActive'] as bool? ?? true,
      createdAt: data['createdAt'] as String? ?? '',
    );
  }
}
