/// A user within one company, associated to a mobile number and a role.
///
/// This is new: the existing authentication system (see
/// core/auth/auth_session.dart) verifies a single mobile number per
/// device and has no concept of distinct user identities - "today one
/// subscriber owns exactly one company" (TenantScope's own doc
/// comment). This model does NOT replace or duplicate that - it is a
/// company-owned record of who is allowed to use the app and with what
/// role, looked up by the mobile number OtpAuthService already
/// verifies. Authentication (proving this is really that phone number)
/// stays exactly where it was; this model only adds authorization
/// (what that verified phone number is allowed to do).
class UserModel {
  final String id;

  final String name;
  final String mobileNumber;

  final String roleId;

  final bool isActive;

  final String createdAt;

  const UserModel({
    required this.id,
    required this.name,
    required this.mobileNumber,
    required this.roleId,
    this.isActive = true,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'name': name,
      'mobile_number': mobileNumber,
      'role_id': roleId,
      'is_active': isActive ? 1 : 0,
      'created_at': createdAt,
    };
  }

  factory UserModel.fromMap(Map<String, dynamic> map) {
    return UserModel(
      id: map['id'] as String,
      name: map['name'] as String? ?? '',
      mobileNumber: map['mobile_number'] as String,
      roleId: map['role_id'] as String,
      isActive: map['is_active'] == 1,
      createdAt: map['created_at'] as String? ?? '',
    );
  }

  UserModel copyWith({
    String? name,
    String? roleId,
    bool? isActive,
  }) {
    return UserModel(
      id: id,
      name: name ?? this.name,
      mobileNumber: mobileNumber,
      roleId: roleId ?? this.roleId,
      isActive: isActive ?? this.isActive,
      createdAt: createdAt,
    );
  }
}
