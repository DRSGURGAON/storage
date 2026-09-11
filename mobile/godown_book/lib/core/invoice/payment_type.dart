/// What this payment represents in the overall deal - distinct from
/// [PaymentMode], which is only HOW the money arrived (cash, UPI,
/// cheque). A payment can be Cash + Booking Advance, or UPI + Full
/// Payment; the two questions are independent, which is why this is a
/// separate enum rather than more entries on PaymentMode.
enum PaymentType {
  fullPayment,
  advancePayment,
  bookingAdvance;

  String get code => switch (this) {
    PaymentType.fullPayment => 'FULL_PAYMENT',
    PaymentType.advancePayment => 'ADVANCE_PAYMENT',
    PaymentType.bookingAdvance => 'BOOKING_ADVANCE',
  };

  String get label => switch (this) {
    PaymentType.fullPayment => 'Full Payment',
    PaymentType.advancePayment => 'Advance Payment',
    PaymentType.bookingAdvance => 'Booking Advance',
  };

  /// Defaults to full payment for any unrecognised or missing code -
  /// including every receipt saved before this field existed, which
  /// have no payment_type value at all. Full Payment is the safe
  /// default there: it is the most common case, and it never
  /// misrepresents a settled receipt as still owing a balance.
  static PaymentType fromCode(String? code) {
    for (final type in PaymentType.values) {
      if (type.code == code) return type;
    }
    return PaymentType.fullPayment;
  }
}
