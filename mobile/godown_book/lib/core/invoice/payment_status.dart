/// Derived/updated consistently from Total, Amount Paid, and Balance -
/// see InvoiceRepository's payment-recalculation logic, which is the
/// single place this status is ever computed from those numbers.
enum PaymentStatus {
  unpaid,
  partiallyPaid,
  paid,
  cancelled;

  String get code => switch (this) {
    PaymentStatus.unpaid => 'UNPAID',
    PaymentStatus.partiallyPaid => 'PARTIALLY_PAID',
    PaymentStatus.paid => 'PAID',
    PaymentStatus.cancelled => 'CANCELLED',
  };

  String get label => switch (this) {
    PaymentStatus.unpaid => 'Unpaid',
    PaymentStatus.partiallyPaid => 'Partially Paid',
    PaymentStatus.paid => 'Paid',
    PaymentStatus.cancelled => 'Cancelled',
  };

  static PaymentStatus fromCode(String? code) {
    for (final status in PaymentStatus.values) {
      if (status.code == code) return status;
    }
    return PaymentStatus.unpaid;
  }

  /// Computes the status purely from amounts - Cancelled is deliberately
  /// excluded here since it's an explicit user action, not something
  /// derivable from a balance (a cancelled invoice can have any balance).
  static PaymentStatus fromAmounts({
    required double grandTotal,
    required double amountPaid,
  }) {
    if (amountPaid <= 0) return PaymentStatus.unpaid;
    if (amountPaid >= grandTotal) return PaymentStatus.paid;
    return PaymentStatus.partiallyPaid;
  }
}
