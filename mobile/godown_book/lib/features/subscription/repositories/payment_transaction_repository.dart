import '../../../core/subscription/payment_transaction_status.dart';
import '../../../core/subscription/super_admin_scope.dart';
import '../../../core/utils/id_generator.dart';
import '../../audit/repositories/security_audit_repository.dart';
import '../data/payment_proof_dao.dart';
import '../data/payment_transaction_dao.dart';
import '../models/payment_proof_model.dart';
import '../models/payment_transaction_model.dart';
import '../models/subscription_plan_model.dart';
import 'subscription_repository.dart';

class PaymentTransactionRepository {
  PaymentTransactionRepository._();

  static final PaymentTransactionRepository instance =
      PaymentTransactionRepository._();

  final PaymentTransactionDao _dao = PaymentTransactionDao.instance;
  final PaymentProofDao _proofDao = PaymentProofDao.instance;

  Future<List<PaymentTransactionModel>> getByCompanyId(
    String companyId,
  ) async {
    return _dao.getByCompanyId(companyId);
  }

  Future<PaymentTransactionModel?> getById(String id) async {
    return _dao.getById(id);
  }

  /// Super Admin's Payment Verification Queue (Section 15) - see
  /// SubscriptionRepository.getAllAcrossCompanies()'s own doc comment
  /// for the same single-install architectural limitation: on this
  /// app's current offline-first, one-company-per-device-install
  /// architecture, this can only ever surface the current install's
  /// own pending payments, not a genuinely cross-company queue.
  Future<List<PaymentTransactionModel>> getAllUnderReview() async {
    return _dao.getAllByStatus(PaymentTransactionStatus.underReview.code);
  }

  /// Customer submits a payment (Sections 11, 12, 13) - stores the
  /// screenshot as its own PaymentProofModel row (see that model's own
  /// doc comment), then a PaymentTransactionModel referencing it.
  /// Deliberately does NOT touch SubscriptionModel/SubscriptionStatus
  /// at all - "Uploading a screenshot must NOT automatically activate
  /// subscription" (Section 13) means the transaction is recorded as
  /// UNDER_REVIEW and nothing about the company's actual access changes
  /// until a Super Admin acts on it.
  Future<PaymentTransactionModel> submitPayment({
    required String companyId,
    required String subscriptionId,
    required String planId,
    required double amount,
    required String utrNumber,
    required String payerName,
    required String paymentDate,
    required String screenshotFilePath,
    String screenshotFileName = '',
    int screenshotFileSizeBytes = 0,
    String remark = '',
  }) async {
    final now = DateTime.now().toIso8601String();

    final proof = PaymentProofModel(
      id: IdGenerator.generateId(),
      companyId: companyId,
      filePath: screenshotFilePath,
      fileName: screenshotFileName,
      fileSizeBytes: screenshotFileSizeBytes,
      uploadedAt: now,
    );

    await _proofDao.insert(proof);

    final transaction = PaymentTransactionModel(
      id: IdGenerator.generateId(),
      companyId: companyId,
      subscriptionId: subscriptionId,
      planId: planId,
      amount: amount,
      utrNumber: utrNumber,
      payerName: payerName,
      paymentDate: paymentDate,
      proofId: proof.id,
      remark: remark,
      status: PaymentTransactionStatus.underReview,
      createdAt: now,
    );

    await _dao.insert(transaction);

    await SecurityAuditRepository.instance.record(
      eventType: SecurityAuditType.subscriptionPaymentSubmitted,
      description: 'Payment of ₹${amount.toStringAsFixed(2)} submitted '
          'for verification (UTR: $utrNumber).',
      entityType: 'payment_transaction',
      entityId: transaction.id,
    );

    return transaction;
  }

  /// Super Admin verifies a payment (Section 16) - marks the
  /// transaction VERIFIED and activates the subscription in the same
  /// operation, since Section 16's own flow has no gap between the two
  /// ("After authorization: Subscription status = ACTIVE").
  Future<void> verify({
    required PaymentTransactionModel transaction,
    required SubscriptionPlanModel plan,
    required String reviewerMobileNumber,
  }) async {
    await _requireSuperAdmin();

    final now = DateTime.now().toIso8601String();

    await _dao.update(
      transaction.copyWith(
        status: PaymentTransactionStatus.verified,
        reviewedByMobileNumber: reviewerMobileNumber,
        reviewedAt: now,
      ),
    );

    await SubscriptionRepository.instance.activate(
      companyId: transaction.companyId,
      plan: plan,
      paymentReference: transaction.utrNumber,
      paymentMethod: transaction.method.code,
      authorizedByMobileNumber: reviewerMobileNumber,
    );

    await SecurityAuditRepository.instance.record(
      eventType: SecurityAuditType.subscriptionPaymentVerified,
      description: 'Payment ${transaction.id} verified and subscription '
          'activated.',
      entityType: 'payment_transaction',
      entityId: transaction.id,
    );
  }

  /// Super Admin rejects a payment (Section 17) - the company returns
  /// to LIMITED and can submit another payment.
  Future<void> reject({
    required PaymentTransactionModel transaction,
    required String reason,
    required String reviewerMobileNumber,
  }) async {
    await _requireSuperAdmin();

    final now = DateTime.now().toIso8601String();

    await _dao.update(
      transaction.copyWith(
        status: PaymentTransactionStatus.rejected,
        reviewedByMobileNumber: reviewerMobileNumber,
        reviewedAt: now,
        rejectionReason: reason,
      ),
    );

    await SubscriptionRepository.instance.returnToLimitedAfterRejection(
      transaction.companyId,
    );

    await SecurityAuditRepository.instance.record(
      eventType: SecurityAuditType.subscriptionPaymentRejected,
      description: 'Payment ${transaction.id} rejected: $reason',
      entityType: 'payment_transaction',
      entityId: transaction.id,
    );
  }

  Future<void> _requireSuperAdmin() async {
    await SuperAdminScope.refresh();

    if (!SuperAdminScope.isSuperAdmin) {
      throw SuperAdminRequiredException();
    }
  }
}
