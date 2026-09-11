/// How a subscription payment was made (Section 29) - deliberately a
/// separate enum from core/invoice/payment_mode.dart's PaymentMode:
/// that enum is for customer-facing Invoice payments (a different
/// domain), and already lacks several values this specification
/// explicitly requires (MANUAL_UPI, PAYMENT_GATEWAY, UPI_AUTOMATED).
/// Current implementation only ever writes manualUpi (Section 29's own
/// "Current implementation: MANUAL_UPI") - the other values exist so
/// a future automated-payment phase has somewhere to write without a
/// schema change, exactly as the task requires.
enum SubscriptionPaymentMethod {
  manualUpi,
  bankTransfer,
  cash,
  paymentGateway,
  upiAutomated,
  other;

  String get code => switch (this) {
    SubscriptionPaymentMethod.manualUpi => 'MANUAL_UPI',
    SubscriptionPaymentMethod.bankTransfer => 'BANK_TRANSFER',
    SubscriptionPaymentMethod.cash => 'CASH',
    SubscriptionPaymentMethod.paymentGateway => 'PAYMENT_GATEWAY',
    SubscriptionPaymentMethod.upiAutomated => 'UPI_AUTOMATED',
    SubscriptionPaymentMethod.other => 'OTHER',
  };

  String get label => switch (this) {
    SubscriptionPaymentMethod.manualUpi => 'Manual UPI',
    SubscriptionPaymentMethod.bankTransfer => 'Bank Transfer',
    SubscriptionPaymentMethod.cash => 'Cash',
    SubscriptionPaymentMethod.paymentGateway => 'Payment Gateway',
    SubscriptionPaymentMethod.upiAutomated => 'UPI Automated',
    SubscriptionPaymentMethod.other => 'Other',
  };

  static SubscriptionPaymentMethod fromCode(String? code) {
    for (final method in SubscriptionPaymentMethod.values) {
      if (method.code == code) return method;
    }
    return SubscriptionPaymentMethod.manualUpi;
  }
}
