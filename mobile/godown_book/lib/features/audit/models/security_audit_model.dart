/// One security-sensitive event, append-only - the same shape/pattern
/// as JobActivityModel (id, description, actor, timestamp), applied to
/// a different domain: JobActivityModel is scoped to one Booking
/// (bookingId is required, since every Booking event is about that
/// specific job); security events are not about any one booking, so
/// entityType/entityId are optional free-form references (e.g.
/// entityType: 'invoice', entityId: the invoice's id) rather than a
/// required foreign key. This is not a duplicate audit system - it is
/// the same established append-only-log pattern this project already
/// uses, applied where JobActivityModel's booking-specific shape
/// genuinely doesn't fit.
class SecurityAuditModel {
  final String id;

  /// e.g. 'ROLE_CHANGED', 'USER_DEACTIVATED', 'INVOICE_FINALIZED',
  /// 'PAYMENT_MODIFIED', 'COMPANY_SETTINGS_CHANGED' - see
  /// SecurityAuditType for the fixed set this project actually writes.
  final String eventType;

  final String description;

  final String? entityType;
  final String? entityId;

  final String? actorMobileNumber;

  final String createdAt;

  const SecurityAuditModel({
    required this.id,
    required this.eventType,
    required this.description,
    this.entityType,
    this.entityId,
    this.actorMobileNumber,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'event_type': eventType,
      'description': description,
      'entity_type': entityType,
      'entity_id': entityId,
      'actor_mobile_number': actorMobileNumber,
      'created_at': createdAt,
    };
  }

  factory SecurityAuditModel.fromMap(Map<String, dynamic> map) {
    return SecurityAuditModel(
      id: map['id'] as String,
      eventType: map['event_type'] as String? ?? '',
      description: map['description'] as String? ?? '',
      entityType: map['entity_type'] as String?,
      entityId: map['entity_id'] as String?,
      actorMobileNumber: map['actor_mobile_number'] as String?,
      createdAt: map['created_at'] as String? ?? '',
    );
  }
}
