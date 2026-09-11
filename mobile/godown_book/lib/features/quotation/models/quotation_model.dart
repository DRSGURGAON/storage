import '../../master/models/charge_head_model.dart';

/// Where a quotation stands, in the words an operator would use.
enum QuotationStatus {
  draft,
  sent,
  accepted,
  declined;

  String get code => switch (this) {
        QuotationStatus.draft => 'DRAFT',
        QuotationStatus.sent => 'SENT',
        QuotationStatus.accepted => 'ACCEPTED',
        QuotationStatus.declined => 'DECLINED',
      };

  String get label => switch (this) {
        QuotationStatus.draft => 'Draft',
        QuotationStatus.sent => 'Sent',
        QuotationStatus.accepted => 'Accepted',
        QuotationStatus.declined => 'Declined',
      };

  static QuotationStatus fromCode(String? code) => switch (code) {
        'SENT' => QuotationStatus.sent,
        'ACCEPTED' => QuotationStatus.accepted,
        'DECLINED' => QuotationStatus.declined,
        _ => QuotationStatus.draft,
      };
}

/// One service line on a quotation - packing, loading, transport,
/// storage, handling or anything the operator adds.
class QuotationLineModel {
  final String id;
  final String quotationId;
  final int sortOrder;

  /// The charge head this line came from, when it came from the master.
  final String chargeHeadId;

  final String serviceName;
  final String description;

  /// Amount / Included / Excluded / N/A - reused from the charge-head
  /// master so a line prints the same way it was configured.
  final ChargeMode mode;

  final double quantity;
  final double rate;
  final double amount;
  final bool taxable;

  const QuotationLineModel({
    required this.id,
    this.quotationId = '',
    this.sortOrder = 0,
    this.chargeHeadId = '',
    required this.serviceName,
    this.description = '',
    this.mode = ChargeMode.amount,
    this.quantity = 1,
    this.rate = 0,
    this.amount = 0,
    this.taxable = true,
  });

  /// Only priced lines add to the total; Included/Excluded/N/A lines are
  /// shown to the customer but carry no amount.
  double get effectiveAmount => mode == ChargeMode.amount ? amount : 0;

  /// What the Amount column prints.
  String get printedAmount =>
      mode == ChargeMode.amount ? amount.toStringAsFixed(2) : mode.printedValue;

  QuotationLineModel copyWith({
    String? id,
    String? quotationId,
    int? sortOrder,
    String? chargeHeadId,
    String? serviceName,
    String? description,
    ChargeMode? mode,
    double? quantity,
    double? rate,
    double? amount,
    bool? taxable,
  }) {
    return QuotationLineModel(
      id: id ?? this.id,
      quotationId: quotationId ?? this.quotationId,
      sortOrder: sortOrder ?? this.sortOrder,
      chargeHeadId: chargeHeadId ?? this.chargeHeadId,
      serviceName: serviceName ?? this.serviceName,
      description: description ?? this.description,
      mode: mode ?? this.mode,
      quantity: quantity ?? this.quantity,
      rate: rate ?? this.rate,
      amount: amount ?? this.amount,
      taxable: taxable ?? this.taxable,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'quotation_id': quotationId,
        'sort_order': sortOrder,
        'charge_head_id': chargeHeadId,
        'service_name': serviceName,
        'description': description,
        'mode': mode.code,
        'quantity': quantity,
        'rate': rate,
        'amount': amount,
        'taxable': taxable ? 1 : 0,
      };

  factory QuotationLineModel.fromMap(Map<String, dynamic> map) {
    String text(String key) => (map[key] as String?) ?? '';
    double number(String key) => (map[key] as num?)?.toDouble() ?? 0;

    return QuotationLineModel(
      id: map['id'] as String,
      quotationId: text('quotation_id'),
      sortOrder: (map['sort_order'] as int?) ?? 0,
      chargeHeadId: text('charge_head_id'),
      serviceName: text('service_name'),
      description: text('description'),
      mode: ChargeMode.fromCode(map['mode'] as String?),
      quantity: number('quantity'),
      rate: number('rate'),
      amount: number('amount'),
      taxable: ((map['taxable'] as int?) ?? 1) == 1,
    );
  }
}

/// What the operator quotes a customer: the services, the storage and
/// the total. Everything the customer already exists as is snapshotted
/// here, so a sent quotation never changes under the customer's feet.
class QuotationModel {
  final String id;
  final String quotationNo;
  final String quotationDate;
  final String validUpto;

  final String customerId;
  final String customerName;
  final String customerPhone;
  final String customerGst;
  final String customerAddress;
  final String customerCity;
  final String customerState;
  final String customerPincode;

  final String fromCity;
  final String toCity;
  final String moveDate;

  final double storageMonths;
  final String storageNote;
  final String goodsDescription;

  final double discountValue;
  final double gstPercent;

  /// Split across CGST/SGST for a customer in the company's own state,
  /// or carried as IGST otherwise - decided when the quotation is saved.
  final double cgstAmount;
  final double sgstAmount;
  final double igstAmount;

  final QuotationStatus status;
  final String notes;
  final String terms;

  final String createdAt;
  final String updatedAt;

  final List<QuotationLineModel> lines;

  const QuotationModel({
    required this.id,
    this.quotationNo = '',
    required this.quotationDate,
    this.validUpto = '',
    this.customerId = '',
    required this.customerName,
    this.customerPhone = '',
    this.customerGst = '',
    this.customerAddress = '',
    this.customerCity = '',
    this.customerState = '',
    this.customerPincode = '',
    this.fromCity = '',
    this.toCity = '',
    this.moveDate = '',
    this.storageMonths = 0,
    this.storageNote = '',
    this.goodsDescription = '',
    this.discountValue = 0,
    this.gstPercent = 0,
    this.cgstAmount = 0,
    this.sgstAmount = 0,
    this.igstAmount = 0,
    this.status = QuotationStatus.draft,
    this.notes = '',
    this.terms = '',
    required this.createdAt,
    this.updatedAt = '',
    this.lines = const [],
  });

  double get subtotal =>
      lines.fold(0.0, (sum, line) => sum + line.effectiveAmount);

  double get taxableBase {
    final taxable = lines
        .where((l) => l.taxable)
        .fold(0.0, (sum, line) => sum + line.effectiveAmount);
    final base = taxable - discountValue;
    return base < 0 ? 0 : base;
  }

  double get gstAmount => cgstAmount + sgstAmount + igstAmount;

  double get grandTotal {
    final total = subtotal - discountValue + gstAmount;
    return total < 0 ? 0 : total;
  }

  /// Recomputes the tax split from the lines and the rate. [interState]
  /// carries the whole tax as IGST.
  QuotationModel recalculated({required bool interState}) {
    final tax = taxableBase * gstPercent / 100;
    return copyWith(
      cgstAmount: interState ? 0 : tax / 2,
      sgstAmount: interState ? 0 : tax / 2,
      igstAmount: interState ? tax : 0,
    );
  }

  String get customerFullAddress {
    final parts = <String>[
      if (customerAddress.trim().isNotEmpty) customerAddress.trim(),
      if (customerCity.trim().isNotEmpty) customerCity.trim(),
      if (customerState.trim().isNotEmpty) customerState.trim(),
    ];
    final line = parts.join(', ');
    return customerPincode.trim().isEmpty ? line : '$line - ${customerPincode.trim()}';
  }

  QuotationModel copyWith({
    String? id,
    String? quotationNo,
    String? quotationDate,
    String? validUpto,
    String? customerId,
    String? customerName,
    String? customerPhone,
    String? customerGst,
    String? customerAddress,
    String? customerCity,
    String? customerState,
    String? customerPincode,
    String? fromCity,
    String? toCity,
    String? moveDate,
    double? storageMonths,
    String? storageNote,
    String? goodsDescription,
    double? discountValue,
    double? gstPercent,
    double? cgstAmount,
    double? sgstAmount,
    double? igstAmount,
    QuotationStatus? status,
    String? notes,
    String? terms,
    String? createdAt,
    String? updatedAt,
    List<QuotationLineModel>? lines,
  }) {
    return QuotationModel(
      id: id ?? this.id,
      quotationNo: quotationNo ?? this.quotationNo,
      quotationDate: quotationDate ?? this.quotationDate,
      validUpto: validUpto ?? this.validUpto,
      customerId: customerId ?? this.customerId,
      customerName: customerName ?? this.customerName,
      customerPhone: customerPhone ?? this.customerPhone,
      customerGst: customerGst ?? this.customerGst,
      customerAddress: customerAddress ?? this.customerAddress,
      customerCity: customerCity ?? this.customerCity,
      customerState: customerState ?? this.customerState,
      customerPincode: customerPincode ?? this.customerPincode,
      fromCity: fromCity ?? this.fromCity,
      toCity: toCity ?? this.toCity,
      moveDate: moveDate ?? this.moveDate,
      storageMonths: storageMonths ?? this.storageMonths,
      storageNote: storageNote ?? this.storageNote,
      goodsDescription: goodsDescription ?? this.goodsDescription,
      discountValue: discountValue ?? this.discountValue,
      gstPercent: gstPercent ?? this.gstPercent,
      cgstAmount: cgstAmount ?? this.cgstAmount,
      sgstAmount: sgstAmount ?? this.sgstAmount,
      igstAmount: igstAmount ?? this.igstAmount,
      status: status ?? this.status,
      notes: notes ?? this.notes,
      terms: terms ?? this.terms,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      lines: lines ?? this.lines,
    );
  }

  /// Row map - totals are stored alongside the inputs so a list screen
  /// never re-adds the lines to show an amount.
  Map<String, dynamic> toMap() => {
        'id': id,
        'quotation_no': quotationNo,
        'quotation_date': quotationDate,
        'valid_upto': validUpto,
        'customer_id': customerId,
        'customer_name': customerName,
        'customer_phone': customerPhone,
        'customer_gst': customerGst,
        'customer_address': customerAddress,
        'customer_city': customerCity,
        'customer_state': customerState,
        'customer_pincode': customerPincode,
        'from_city': fromCity,
        'to_city': toCity,
        'move_date': moveDate,
        'storage_months': storageMonths,
        'storage_note': storageNote,
        'goods_description': goodsDescription,
        'subtotal': subtotal,
        'discount_value': discountValue,
        'gst_percent': gstPercent,
        'gst_amount': gstAmount,
        'cgst_amount': cgstAmount,
        'sgst_amount': sgstAmount,
        'igst_amount': igstAmount,
        'grand_total': grandTotal,
        'status': status.code,
        'notes': notes,
        'terms': terms,
        'created_at': createdAt,
        'updated_at': updatedAt,
      };

  factory QuotationModel.fromMap(
    Map<String, dynamic> map, {
    List<QuotationLineModel> lines = const [],
  }) {
    String text(String key) => (map[key] as String?) ?? '';
    double number(String key) => (map[key] as num?)?.toDouble() ?? 0;

    return QuotationModel(
      id: map['id'] as String,
      quotationNo: text('quotation_no'),
      quotationDate: text('quotation_date'),
      validUpto: text('valid_upto'),
      customerId: text('customer_id'),
      customerName: text('customer_name'),
      customerPhone: text('customer_phone'),
      customerGst: text('customer_gst'),
      customerAddress: text('customer_address'),
      customerCity: text('customer_city'),
      customerState: text('customer_state'),
      customerPincode: text('customer_pincode'),
      fromCity: text('from_city'),
      toCity: text('to_city'),
      moveDate: text('move_date'),
      storageMonths: number('storage_months'),
      storageNote: text('storage_note'),
      goodsDescription: text('goods_description'),
      discountValue: number('discount_value'),
      gstPercent: number('gst_percent'),
      cgstAmount: number('cgst_amount'),
      sgstAmount: number('sgst_amount'),
      igstAmount: number('igst_amount'),
      status: QuotationStatus.fromCode(map['status'] as String?),
      notes: text('notes'),
      terms: text('terms'),
      createdAt: text('created_at'),
      updatedAt: text('updated_at'),
      lines: lines,
    );
  }
}
