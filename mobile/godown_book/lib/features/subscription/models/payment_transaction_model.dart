import '../../../core/subscription/payment_transaction_status.dart';
import '../../../core/subscription/subscription_payment_method.dart';

/// A single subscription payment submission (Sections 12, 13, 15, 29,
/// 30) - references Company, Subscription, and Plan (never duplicates
/// those records, per the task's explicit "Payment must reference:
/// Company, Subscription, Plan"). Fields for merchant/transaction
/// reference, provider, and provider transaction ID are present now
/// but only ever populated for MANUAL_UPI today (utrNumber) - Section
/// 30's "keep fields ready for... future dynamic QR/payment gateway
/// integration" without a later schema change.
class PaymentTransactionModel {
  final String id;
  final String companyId;
  final String subscriptionId;
  final String planId;

  final SubscriptionPaymentMethod method;
  final double amount;

  /// UTR / transaction number (Section 12) - the reference a customer
  /// provides for a manual UPI payment.
  final String utrNumber;

  final String payerName;
  final String paymentDate;

  /// Path to the uploaded screenshot (Section 12) - see
  /// PaymentProofModel, stored via the existing CompanyImagePicker-style
  /// file-storage architecture (Section: "reuse existing... File
  /// storage").
  final String? proofId;

  final String remark;

  final PaymentTransactionStatus status;

  /// Populated once verified/rejected (Sections 16, 17).
  final String? reviewedByMobileNumber;
  final String? reviewedAt;
  final String? rejectionReason;

  /// Ready for a future payment-gateway/automated-UPI phase (Section
  /// 30) - unused (null) for the current MANUAL_UPI-only
  /// implementation.
  final String? providerReference;
  final String? providerTransactionId;

  final String createdAt;

  const PaymentTransactionModel({
    required this.id,
    required this.companyId,
    required this.subscriptionId,
    required this.planId,
    this.method = SubscriptionPaymentMethod.manualUpi,
    required this.amount,
    this.utrNumber = '',
    this.payerName = '',
    required this.paymentDate,
    this.proofId,
    this.remark = '',
    this.status = PaymentTransactionStatus.underReview,
    this.reviewedByMobileNumber,
    this.reviewedAt,
    this.rejectionReason,
    this.providerReference,
    this.providerTransactionId,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'company_id': companyId,
      'subscription_id': subscriptionId,
      'plan_id': planId,
      'method': method.code,
      'amount': amount,
      'utr_number': utrNumber,
      'payer_name': payerName,
      'payment_date': paymentDate,
      'proof_id': proofId,
      'remark': remark,
      'status': status.code,
      'reviewed_by_mobile_number': reviewedByMobileNumber,
      'reviewed_at': reviewedAt,
      'rejection_reason': rejectionReason,
      'provider_reference': providerReference,
      'provider_transaction_id': providerTransactionId,
      'created_at': createdAt,
    };
  }

  factory PaymentTransactionModel.fromMap(Map<String, dynamic> map) {
    return PaymentTransactionModel(
      id: map['id'] as String,
      companyId: map['company_id'] as String? ?? '',
      subscriptionId: map['subscription_id'] as String? ?? '',
      planId: map['plan_id'] as String? ?? '',
      method: SubscriptionPaymentMethod.fromCode(map['method'] as String?),
      amount: (map['amount'] as num?)?.toDouble() ?? 0,
      utrNumber: map['utr_number'] as String? ?? '',
      payerName: map['payer_name'] as String? ?? '',
      paymentDate: map['payment_date'] as String? ?? '',
      proofId: map['proof_id'] as String?,
      remark: map['remark'] as String? ?? '',
      status: PaymentTransactionStatus.fromCode(map['status'] as String?),
      reviewedByMobileNumber: map['reviewed_by_mobile_number'] as String?,
      reviewedAt: map['reviewed_at'] as String?,
      rejectionReason: map['rejection_reason'] as String?,
      providerReference: map['provider_reference'] as String?,
      providerTransactionId: map['provider_transaction_id'] as String?,
      createdAt: map['created_at'] as String? ?? '',
    );
  }

  PaymentTransactionModel copyWith({
    PaymentTransactionStatus? status,
    String? reviewedByMobileNumber,
    String? reviewedAt,
    String? rejectionReason,
  }) {
    return PaymentTransactionModel(
      id: id,
      companyId: companyId,
      subscriptionId: subscriptionId,
      planId: planId,
      method: method,
      amount: amount,
      utrNumber: utrNumber,
      payerName: payerName,
      paymentDate: paymentDate,
      proofId: proofId,
      remark: remark,
      status: status ?? this.status,
      reviewedByMobileNumber:
          reviewedByMobileNumber ?? this.reviewedByMobileNumber,
      reviewedAt: reviewedAt ?? this.reviewedAt,
      rejectionReason: rejectionReason ?? this.rejectionReason,
      providerReference: providerReference,
      providerTransactionId: providerTransactionId,
      createdAt: createdAt,
    );
  }
}
