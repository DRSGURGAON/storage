/// Where a bill stands, in the words an operator would use. Paid,
/// Partly Paid and Overdue are worked out from what has been received
/// and the due date; Draft and Sent are the operator's own choice.
enum BillStatus {
  draft,
  sent,
  partlyPaid,
  paid,
  overdue;

  String get code => switch (this) {
        BillStatus.draft => 'DRAFT',
        BillStatus.sent => 'SENT',
        BillStatus.partlyPaid => 'PARTLY_PAID',
        BillStatus.paid => 'PAID',
        BillStatus.overdue => 'OVERDUE',
      };

  String get label => switch (this) {
        BillStatus.draft => 'Draft',
        BillStatus.sent => 'Sent',
        BillStatus.partlyPaid => 'Partly Paid',
        BillStatus.paid => 'Paid',
        BillStatus.overdue => 'Overdue',
      };

  static BillStatus fromCode(String? code) => switch (code) {
        'SENT' => BillStatus.sent,
        'PARTLY_PAID' => BillStatus.partlyPaid,
        'PAID' => BillStatus.paid,
        'OVERDUE' => BillStatus.overdue,
        _ => BillStatus.draft,
      };
}

/// One line on a bill - the storage charge for the period, or a service
/// like loading, handling or pickup.
class BillLineModel {
  final String id;
  final String billId;
  final int sortOrder;

  final String chargeName;

  /// How the amount was arrived at, in plain words - e.g.
  /// "01 Sep 2026 to 30 Sep 2026, 1 month at Rs. 3500.00 per month".
  final String description;

  final double quantity;
  final double rate;
  final double amount;
  final bool taxable;

  const BillLineModel({
    required this.id,
    this.billId = '',
    this.sortOrder = 0,
    required this.chargeName,
    this.description = '',
    this.quantity = 1,
    this.rate = 0,
    this.amount = 0,
    this.taxable = true,
  });

  BillLineModel copyWith({
    String? id,
    String? billId,
    int? sortOrder,
    String? chargeName,
    String? description,
    double? quantity,
    double? rate,
    double? amount,
    bool? taxable,
  }) {
    return BillLineModel(
      id: id ?? this.id,
      billId: billId ?? this.billId,
      sortOrder: sortOrder ?? this.sortOrder,
      chargeName: chargeName ?? this.chargeName,
      description: description ?? this.description,
      quantity: quantity ?? this.quantity,
      rate: rate ?? this.rate,
      amount: amount ?? this.amount,
      taxable: taxable ?? this.taxable,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'invoice_id': billId,
        'sort_order': sortOrder,
        'charge_name': chargeName,
        'description': description,
        'quantity': quantity,
        'rate': rate,
        'amount': amount,
        'taxable': taxable ? 1 : 0,
      };

  factory BillLineModel.fromMap(Map<String, dynamic> map) {
    String text(String key) => (map[key] as String?) ?? '';
    double number(String key) => (map[key] as num?)?.toDouble() ?? 0;

    return BillLineModel(
      id: map['id'] as String,
      billId: text('invoice_id'),
      sortOrder: (map['sort_order'] as int?) ?? 0,
      chargeName: text('charge_name'),
      description: text('description'),
      quantity: number('quantity'),
      rate: number('rate'),
      amount: number('amount'),
      taxable: ((map['taxable'] as int?) ?? 1) == 1,
    );
  }
}

/// A storage bill: what one customer owes for one period, plus whatever
/// services were provided. Normally raised against a storage record,
/// but booking_id is optional so a one-off bill works too.
class BillModel {
  final String id;
  final String billNo;
  final String billDate;

  final String bookingId;
  final String bookingNo;
  final String customerId;

  final String customerName;
  final String customerPhone;
  final String customerGst;
  final String customerAddress;
  final String customerCity;
  final String customerState;
  final String customerPincode;

  /// The storage period this bill covers - empty on a bill that has no
  /// storage line.
  final String periodFrom;
  final String periodTo;
  final String dueDate;

  final double discountValue;
  final double gstPercent;
  final double cgstAmount;
  final double sgstAmount;
  final double igstAmount;

  /// Kept in step by the payments layer - never recomputed on read.
  final double amountPaid;

  final BillStatus status;
  final String notes;

  final String createdAt;
  final List<BillLineModel> lines;

  const BillModel({
    required this.id,
    this.billNo = '',
    required this.billDate,
    this.bookingId = '',
    this.bookingNo = '',
    this.customerId = '',
    required this.customerName,
    this.customerPhone = '',
    this.customerGst = '',
    this.customerAddress = '',
    this.customerCity = '',
    this.customerState = '',
    this.customerPincode = '',
    this.periodFrom = '',
    this.periodTo = '',
    this.dueDate = '',
    this.discountValue = 0,
    this.gstPercent = 0,
    this.cgstAmount = 0,
    this.sgstAmount = 0,
    this.igstAmount = 0,
    this.amountPaid = 0,
    this.status = BillStatus.draft,
    this.notes = '',
    required this.createdAt,
    this.lines = const [],
  });

  double get subtotal => lines.fold(0.0, (sum, line) => sum + line.amount);

  double get taxableBase {
    final taxable =
        lines.where((l) => l.taxable).fold(0.0, (sum, line) => sum + line.amount);
    final base = taxable - discountValue;
    return base < 0 ? 0 : base;
  }

  double get gstAmount => cgstAmount + sgstAmount + igstAmount;

  double get grandTotal {
    final total = subtotal - discountValue + gstAmount;
    return total < 0 ? 0 : total;
  }

  double get balanceDue {
    final due = grandTotal - amountPaid;
    return due < 0 ? 0 : due;
  }

  bool get isSettled => balanceDue <= 0.004;

  String get customerFullAddress {
    final parts = <String>[
      if (customerAddress.trim().isNotEmpty) customerAddress.trim(),
      if (customerCity.trim().isNotEmpty) customerCity.trim(),
      if (customerState.trim().isNotEmpty) customerState.trim(),
    ];
    final line = parts.join(', ');
    return customerPincode.trim().isEmpty ? line : '$line - ${customerPincode.trim()}';
  }

  /// The status the money and the due date imply. Draft and Sent are
  /// kept as the operator left them until something is received.
  BillStatus get derivedStatus {
    if (isSettled && grandTotal > 0) return BillStatus.paid;
    if (amountPaid > 0) return BillStatus.partlyPaid;

    final due = DateTime.tryParse(dueDate);
    if (due != null && DateTime.now().isAfter(due.add(const Duration(days: 1)))) {
      return BillStatus.overdue;
    }
    return status == BillStatus.paid || status == BillStatus.partlyPaid
        ? BillStatus.sent
        : status;
  }

  BillModel recalculated({required bool interState}) {
    final tax = taxableBase * gstPercent / 100;
    return copyWith(
      cgstAmount: interState ? 0 : tax / 2,
      sgstAmount: interState ? 0 : tax / 2,
      igstAmount: interState ? tax : 0,
    );
  }

  BillModel copyWith({
    String? id,
    String? billNo,
    String? billDate,
    String? bookingId,
    String? bookingNo,
    String? customerId,
    String? customerName,
    String? customerPhone,
    String? customerGst,
    String? customerAddress,
    String? customerCity,
    String? customerState,
    String? customerPincode,
    String? periodFrom,
    String? periodTo,
    String? dueDate,
    double? discountValue,
    double? gstPercent,
    double? cgstAmount,
    double? sgstAmount,
    double? igstAmount,
    double? amountPaid,
    BillStatus? status,
    String? notes,
    String? createdAt,
    List<BillLineModel>? lines,
  }) {
    return BillModel(
      id: id ?? this.id,
      billNo: billNo ?? this.billNo,
      billDate: billDate ?? this.billDate,
      bookingId: bookingId ?? this.bookingId,
      bookingNo: bookingNo ?? this.bookingNo,
      customerId: customerId ?? this.customerId,
      customerName: customerName ?? this.customerName,
      customerPhone: customerPhone ?? this.customerPhone,
      customerGst: customerGst ?? this.customerGst,
      customerAddress: customerAddress ?? this.customerAddress,
      customerCity: customerCity ?? this.customerCity,
      customerState: customerState ?? this.customerState,
      customerPincode: customerPincode ?? this.customerPincode,
      periodFrom: periodFrom ?? this.periodFrom,
      periodTo: periodTo ?? this.periodTo,
      dueDate: dueDate ?? this.dueDate,
      discountValue: discountValue ?? this.discountValue,
      gstPercent: gstPercent ?? this.gstPercent,
      cgstAmount: cgstAmount ?? this.cgstAmount,
      sgstAmount: sgstAmount ?? this.sgstAmount,
      igstAmount: igstAmount ?? this.igstAmount,
      amountPaid: amountPaid ?? this.amountPaid,
      status: status ?? this.status,
      notes: notes ?? this.notes,
      createdAt: createdAt ?? this.createdAt,
      lines: lines ?? this.lines,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'invoice_no': billNo,
        'invoice_date': billDate,
        'booking_id': bookingId.isEmpty ? null : bookingId,
        'booking_no': bookingNo,
        'customer_id': customerId,
        'customer_name': customerName,
        'customer_phone': customerPhone,
        'customer_gst': customerGst,
        'customer_address': customerAddress,
        'customer_city': customerCity,
        'customer_state': customerState,
        'customer_pincode': customerPincode,
        'period_from': periodFrom,
        'period_to': periodTo,
        'due_date': dueDate,
        'subtotal': subtotal,
        'discount_value': discountValue,
        'gst_percent': gstPercent,
        'gst_amount': gstAmount,
        'cgst_amount': cgstAmount,
        'sgst_amount': sgstAmount,
        'igst_amount': igstAmount,
        'grand_total': grandTotal,
        'amount_paid': amountPaid,
        'status': status.code,
        'notes': notes,
        'created_at': createdAt,
      };

  factory BillModel.fromMap(
    Map<String, dynamic> map, {
    List<BillLineModel> lines = const [],
  }) {
    String text(String key) => (map[key] as String?) ?? '';
    double number(String key) => (map[key] as num?)?.toDouble() ?? 0;

    return BillModel(
      id: map['id'] as String,
      billNo: text('invoice_no'),
      billDate: text('invoice_date'),
      bookingId: text('booking_id'),
      bookingNo: text('booking_no'),
      customerId: text('customer_id'),
      customerName: text('customer_name'),
      customerPhone: text('customer_phone'),
      customerGst: text('customer_gst'),
      customerAddress: text('customer_address'),
      customerCity: text('customer_city'),
      customerState: text('customer_state'),
      customerPincode: text('customer_pincode'),
      periodFrom: text('period_from'),
      periodTo: text('period_to'),
      dueDate: text('due_date'),
      discountValue: number('discount_value'),
      gstPercent: number('gst_percent'),
      cgstAmount: number('cgst_amount'),
      sgstAmount: number('sgst_amount'),
      igstAmount: number('igst_amount'),
      amountPaid: number('amount_paid'),
      status: BillStatus.fromCode(map['status'] as String?),
      notes: text('notes'),
      createdAt: text('created_at'),
      lines: lines,
    );
  }
}
