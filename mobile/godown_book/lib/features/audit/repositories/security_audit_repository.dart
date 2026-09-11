import '../../../core/permissions/permission_service.dart';
import '../../../core/utils/id_generator.dart';
import '../data/security_audit_dao.dart';
import '../models/security_audit_model.dart';

/// Fixed set of security-sensitive event types this project actually
/// writes - matches the task's own list exactly, not an open-ended
/// string any caller can invent.
class SecurityAuditType {
  static const roleChanged = 'ROLE_CHANGED';
  static const permissionChanged = 'PERMISSION_CHANGED';
  static const userActivated = 'USER_ACTIVATED';
  static const userDeactivated = 'USER_DEACTIVATED';
  static const invoiceFinalized = 'INVOICE_FINALIZED';
  static const invoiceModified = 'INVOICE_MODIFIED';
  static const paymentModified = 'PAYMENT_MODIFIED';
  static const companySettingsChanged = 'COMPANY_SETTINGS_CHANGED';

  // Subscription (Section 24's exact event list)
  static const subscriptionPaymentSubmitted = 'SUBSCRIPTION_PAYMENT_SUBMITTED';
  static const subscriptionPaymentViewed = 'SUBSCRIPTION_PAYMENT_VIEWED';
  static const subscriptionPaymentVerified = 'SUBSCRIPTION_PAYMENT_VERIFIED';
  static const subscriptionPaymentRejected = 'SUBSCRIPTION_PAYMENT_REJECTED';
  static const subscriptionActivated = 'SUBSCRIPTION_ACTIVATED';
  static const subscriptionManuallyActivated =
      'SUBSCRIPTION_MANUALLY_ACTIVATED';
  static const subscriptionRenewed = 'SUBSCRIPTION_RENEWED';
  static const subscriptionSuspended = 'SUBSCRIPTION_SUSPENDED';
  static const subscriptionCancelled = 'SUBSCRIPTION_CANCELLED';
  static const subscriptionPlanChanged = 'SUBSCRIPTION_PLAN_CHANGED';
  static const subscriptionExpiryChanged = 'SUBSCRIPTION_EXPIRY_CHANGED';
}

class SecurityAuditRepository {
  SecurityAuditRepository._();

  static final SecurityAuditRepository instance =
      SecurityAuditRepository._();

  final SecurityAuditDao _dao = SecurityAuditDao.instance;

  Future<List<SecurityAuditModel>> getAll({int limit = 100}) async {
    return _dao.getAll(limit: limit);
  }

  /// Records one event - actorMobileNumber is read from
  /// PermissionService's current session automatically, so every call
  /// site doesn't need to thread it through separately.
  Future<void> record({
    required String eventType,
    required String description,
    String? entityType,
    String? entityId,
  }) async {
    await _dao.insert(
      SecurityAuditModel(
        id: IdGenerator.generateId(),
        eventType: eventType,
        description: description,
        entityType: entityType,
        entityId: entityId,
        actorMobileNumber: PermissionService.currentMobileNumberOverride,
        createdAt: DateTime.now().toIso8601String(),
      ),
    );
  }
}
