enum PaymentMode {
  cash,
  upi,
  bankTransfer,
  card,
  cheque,
  other;

  String get code => switch (this) {
    PaymentMode.cash => 'CASH',
    PaymentMode.upi => 'UPI',
    PaymentMode.bankTransfer => 'BANK_TRANSFER',
    PaymentMode.card => 'CARD',
    PaymentMode.cheque => 'CHEQUE',
    PaymentMode.other => 'OTHER',
  };

  String get label => switch (this) {
    PaymentMode.cash => 'Cash',
    PaymentMode.upi => 'UPI',
    PaymentMode.bankTransfer => 'Bank Transfer',
    PaymentMode.card => 'Card',
    PaymentMode.cheque => 'Cheque',
    PaymentMode.other => 'Other',
  };

  static PaymentMode fromCode(String? code) {
    for (final mode in PaymentMode.values) {
      if (mode.code == code) return mode;
    }
    return PaymentMode.cash;
  }
}
