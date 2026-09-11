/// How the money came in.
enum PaymentMode {
  cash,
  upi,
  bankTransfer,
  cheque,
  card,
  other;

  String get code => switch (this) {
        PaymentMode.cash => 'CASH',
        PaymentMode.upi => 'UPI',
        PaymentMode.bankTransfer => 'BANK',
        PaymentMode.cheque => 'CHEQUE',
        PaymentMode.card => 'CARD',
        PaymentMode.other => 'OTHER',
      };

  String get label => switch (this) {
        PaymentMode.cash => 'Cash',
        PaymentMode.upi => 'UPI',
        PaymentMode.bankTransfer => 'Bank Transfer',
        PaymentMode.cheque => 'Cheque',
        PaymentMode.card => 'Card',
        PaymentMode.other => 'Other',
      };

  static PaymentMode fromCode(String? code) => switch (code) {
        'UPI' => PaymentMode.upi,
        'BANK' => PaymentMode.bankTransfer,
        'CHEQUE' => PaymentMode.cheque,
        'CARD' => PaymentMode.card,
        'OTHER' => PaymentMode.other,
        _ => PaymentMode.cash,
      };
}

/// What the payment is for.
enum PaymentType {
  fullPayment,
  partPayment,
  advance,

  /// Deposit taken when the goods came in. It is the customer's money
  /// held by the godown, not income, so it never reduces what the
  /// customer owes - see [isDepositIn].
  securityDeposit,

  /// Deposit handed back to the customer.
  depositRefund,

  /// Deposit kept and applied against the customer's dues. This one
  /// settles bills like any other payment, and reduces the deposit
  /// still held.
  depositAdjusted;

  String get code => switch (this) {
        PaymentType.fullPayment => 'FULL_PAYMENT',
        PaymentType.partPayment => 'PART_PAYMENT',
        PaymentType.advance => 'ADVANCE',
        PaymentType.securityDeposit => 'SECURITY_DEPOSIT',
        PaymentType.depositRefund => 'DEPOSIT_REFUND',
        PaymentType.depositAdjusted => 'DEPOSIT_ADJUSTED',
      };

  String get label => switch (this) {
        PaymentType.fullPayment => 'Full Payment',
        PaymentType.partPayment => 'Part Payment',
        PaymentType.advance => 'Advance',
        PaymentType.securityDeposit => 'Security Deposit',
        PaymentType.depositRefund => 'Deposit Returned',
        PaymentType.depositAdjusted => 'Deposit Adjusted',
      };

  /// Deposit money coming in - held for the customer, never income.
  bool get isDepositIn => this == PaymentType.securityDeposit;

  /// Deposit money going back out.
  bool get isDepositOut => this == PaymentType.depositRefund;

  /// Whether this entry settles what the customer owes. Deposit taken
  /// and deposit returned do not; everything else, including a deposit
  /// applied to the dues, does.
  bool get settlesDues => !isDepositIn && !isDepositOut;

  /// Whether this entry lowers the deposit the godown is holding.
  bool get lowersDeposit =>
      this == PaymentType.depositRefund || this == PaymentType.depositAdjusted;

  static PaymentType fromCode(String? code) => switch (code) {
        'PART_PAYMENT' => PaymentType.partPayment,
        'ADVANCE' => PaymentType.advance,
        'SECURITY_DEPOSIT' => PaymentType.securityDeposit,
        'DEPOSIT_REFUND' => PaymentType.depositRefund,
        'DEPOSIT_ADJUSTED' => PaymentType.depositAdjusted,
        _ => PaymentType.fullPayment,
      };
}

/// One payment received, and the receipt printed for it.
class PaymentModel {
  final String id;
  final String receiptNo;

  /// The bill this settles, when it settles one. Empty for an advance
  /// or an on-account payment.
  final String billId;

  final String customerId;
  final String bookingId;

  final String payerName;
  final String payerPhone;

  /// What the payment is against, in the operator's own words, when it
  /// is not against a specific bill.
  final String against;

  final double amount;
  final PaymentMode mode;
  final PaymentType paymentType;
  final String paymentDate;
  final String referenceNo;
  final String notes;

  final String createdAt;

  const PaymentModel({
    required this.id,
    this.receiptNo = '',
    this.billId = '',
    this.customerId = '',
    this.bookingId = '',
    required this.payerName,
    this.payerPhone = '',
    this.against = '',
    this.amount = 0,
    this.mode = PaymentMode.cash,
    this.paymentType = PaymentType.fullPayment,
    required this.paymentDate,
    this.referenceNo = '',
    this.notes = '',
    required this.createdAt,
  });

  bool get isOnAccount => billId.isEmpty;

  PaymentModel copyWith({
    String? id,
    String? receiptNo,
    String? billId,
    String? customerId,
    String? bookingId,
    String? payerName,
    String? payerPhone,
    String? against,
    double? amount,
    PaymentMode? mode,
    PaymentType? paymentType,
    String? paymentDate,
    String? referenceNo,
    String? notes,
    String? createdAt,
  }) {
    return PaymentModel(
      id: id ?? this.id,
      receiptNo: receiptNo ?? this.receiptNo,
      billId: billId ?? this.billId,
      customerId: customerId ?? this.customerId,
      bookingId: bookingId ?? this.bookingId,
      payerName: payerName ?? this.payerName,
      payerPhone: payerPhone ?? this.payerPhone,
      against: against ?? this.against,
      amount: amount ?? this.amount,
      mode: mode ?? this.mode,
      paymentType: paymentType ?? this.paymentType,
      paymentDate: paymentDate ?? this.paymentDate,
      referenceNo: referenceNo ?? this.referenceNo,
      notes: notes ?? this.notes,
      createdAt: createdAt ?? this.createdAt,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'receipt_no': receiptNo,
        'invoice_id': billId.isEmpty ? null : billId,
        'customer_id': customerId,
        'booking_id': bookingId,
        'payer_name': payerName,
        'payer_phone': payerPhone,
        'against': against,
        'amount': amount,
        'mode': mode.code,
        'payment_type': paymentType.code,
        'payment_date': paymentDate,
        'reference_no': referenceNo,
        'notes': notes,
        'created_at': createdAt,
      };

  factory PaymentModel.fromMap(Map<String, dynamic> map) {
    String text(String key) => (map[key] as String?) ?? '';

    return PaymentModel(
      id: map['id'] as String,
      receiptNo: text('receipt_no'),
      billId: text('invoice_id'),
      customerId: text('customer_id'),
      bookingId: text('booking_id'),
      payerName: text('payer_name'),
      payerPhone: text('payer_phone'),
      against: text('against'),
      amount: (map['amount'] as num?)?.toDouble() ?? 0,
      mode: PaymentMode.fromCode(map['mode'] as String?),
      paymentType: PaymentType.fromCode(map['payment_type'] as String?),
      paymentDate: text('payment_date'),
      referenceNo: text('reference_no'),
      notes: text('notes'),
      createdAt: text('created_at'),
    );
  }
}
