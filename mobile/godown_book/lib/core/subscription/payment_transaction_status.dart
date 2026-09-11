/// A subscription payment's verification state (Sections 13, 16, 17) -
/// distinct from SubscriptionStatus: a company's overall subscription
/// status is derived from its Subscription record, while this tracks
/// one specific PaymentTransaction through the admin verification
/// workflow.
enum PaymentTransactionStatus {
  underReview,
  verified,
  rejected;

  String get code => switch (this) {
    PaymentTransactionStatus.underReview => 'UNDER_REVIEW',
    PaymentTransactionStatus.verified => 'VERIFIED',
    PaymentTransactionStatus.rejected => 'REJECTED',
  };

  String get label => switch (this) {
    PaymentTransactionStatus.underReview => 'Under Review',
    PaymentTransactionStatus.verified => 'Verified',
    PaymentTransactionStatus.rejected => 'Rejected',
  };

  static PaymentTransactionStatus fromCode(String? code) {
    for (final status in PaymentTransactionStatus.values) {
      if (status.code == code) return status;
    }
    return PaymentTransactionStatus.underReview;
  }
}
