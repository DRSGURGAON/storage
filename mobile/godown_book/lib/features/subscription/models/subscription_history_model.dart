import '../../../core/subscription/subscription_status.dart';

/// One historical subscription period (Section 23) - append-only,
/// never edited or deleted ("Never delete historical subscription
/// records"). A new row is written every time a subscription is
/// activated, renewed, or manually authorized - SubscriptionModel
/// itself only ever holds the current/latest state, this is the full
/// timeline.
class SubscriptionHistoryModel {
  final String id;
  final String companyId;
  final String subscriptionId;

  final String planId;
  final String planName;
  final double amount;

  final String startDate;
  final String endDate;

  final String? paymentReference;
  final String? paymentMethod;

  /// Mobile number of the admin who authorized this period - null for
  /// a fully self-service flow with no distinct authorizer (kept for
  /// symmetry with the audit log's actor field).
  final String? authorizedByMobileNumber;
  final String authorizationDate;

  final SubscriptionStatus status;
  final String remarks;

  const SubscriptionHistoryModel({
    required this.id,
    required this.companyId,
    required this.subscriptionId,
    required this.planId,
    required this.planName,
    required this.amount,
    required this.startDate,
    required this.endDate,
    this.paymentReference,
    this.paymentMethod,
    this.authorizedByMobileNumber,
    required this.authorizationDate,
    required this.status,
    this.remarks = '',
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'company_id': companyId,
      'subscription_id': subscriptionId,
      'plan_id': planId,
      'plan_name': planName,
      'amount': amount,
      'start_date': startDate,
      'end_date': endDate,
      'payment_reference': paymentReference,
      'payment_method': paymentMethod,
      'authorized_by_mobile_number': authorizedByMobileNumber,
      'authorization_date': authorizationDate,
      'status': status.code,
      'remarks': remarks,
    };
  }

  factory SubscriptionHistoryModel.fromMap(Map<String, dynamic> map) {
    return SubscriptionHistoryModel(
      id: map['id'] as String,
      companyId: map['company_id'] as String? ?? '',
      subscriptionId: map['subscription_id'] as String? ?? '',
      planId: map['plan_id'] as String? ?? '',
      planName: map['plan_name'] as String? ?? '',
      amount: (map['amount'] as num?)?.toDouble() ?? 0,
      startDate: map['start_date'] as String? ?? '',
      endDate: map['end_date'] as String? ?? '',
      paymentReference: map['payment_reference'] as String?,
      paymentMethod: map['payment_method'] as String?,
      authorizedByMobileNumber:
          map['authorized_by_mobile_number'] as String?,
      authorizationDate: map['authorization_date'] as String? ?? '',
      status: SubscriptionStatus.fromCode(map['status'] as String?),
      remarks: map['remarks'] as String? ?? '',
    );
  }
}
