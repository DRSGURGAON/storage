/// A company's subscription/access state (Section 3 of the
/// specification) - deliberately its own enum, not reused from
/// anywhere else, since this is a genuinely new domain concept.
enum SubscriptionStatus {
  limited,
  paymentPending,
  paymentSubmitted,
  paymentUnderReview,
  active,
  expiringSoon,
  expired,
  suspended,
  cancelled;

  String get code => switch (this) {
    SubscriptionStatus.limited => 'LIMITED',
    SubscriptionStatus.paymentPending => 'PAYMENT_PENDING',
    SubscriptionStatus.paymentSubmitted => 'PAYMENT_SUBMITTED',
    SubscriptionStatus.paymentUnderReview => 'PAYMENT_UNDER_REVIEW',
    SubscriptionStatus.active => 'ACTIVE',
    SubscriptionStatus.expiringSoon => 'EXPIRING_SOON',
    SubscriptionStatus.expired => 'EXPIRED',
    SubscriptionStatus.suspended => 'SUSPENDED',
    SubscriptionStatus.cancelled => 'CANCELLED',
  };

  String get label => switch (this) {
    SubscriptionStatus.limited => 'Limited Access',
    SubscriptionStatus.paymentPending => 'Payment Pending',
    SubscriptionStatus.paymentSubmitted => 'Payment Submitted',
    SubscriptionStatus.paymentUnderReview => 'Payment Under Review',
    SubscriptionStatus.active => 'Active',
    SubscriptionStatus.expiringSoon => 'Expiring Soon',
    SubscriptionStatus.expired => 'Expired',
    SubscriptionStatus.suspended => 'Suspended',
    SubscriptionStatus.cancelled => 'Cancelled',
  };

  /// True for any status where the company should be treated as having
  /// full (non-demo) access - only ACTIVE and EXPIRING_SOON (a warning
  /// state, not a restriction - Section 20 shows the warning without
  /// cutting anyone off early).
  bool get grantsFullAccess =>
      this == SubscriptionStatus.active ||
      this == SubscriptionStatus.expiringSoon;

  static SubscriptionStatus fromCode(String? code) {
    for (final status in SubscriptionStatus.values) {
      if (status.code == code) return status;
    }
    return SubscriptionStatus.limited;
  }
}
