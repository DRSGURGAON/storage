/// Where the consignment has reached.
enum ConsignmentStatus {
  booked,
  inTransit,
  delivered,
  cancelled;

  String get code => switch (this) {
        ConsignmentStatus.booked => 'BOOKED',
        ConsignmentStatus.inTransit => 'IN_TRANSIT',
        ConsignmentStatus.delivered => 'DELIVERED',
        ConsignmentStatus.cancelled => 'CANCELLED',
      };

  String get label => switch (this) {
        ConsignmentStatus.booked => 'Booked',
        ConsignmentStatus.inTransit => 'On the way',
        ConsignmentStatus.delivered => 'Delivered',
        ConsignmentStatus.cancelled => 'Cancelled',
      };

  static ConsignmentStatus fromCode(String? code) => switch (code) {
        'IN_TRANSIT' => ConsignmentStatus.inTransit,
        'DELIVERED' => ConsignmentStatus.delivered,
        'CANCELLED' => ConsignmentStatus.cancelled,
        _ => ConsignmentStatus.booked,
      };
}

/// Who pays the freight, and when.
enum FreightBasis {
  paid,
  toPay,
  toBeBilled;

  String get code => switch (this) {
        FreightBasis.paid => 'PAID',
        FreightBasis.toPay => 'TO_PAY',
        FreightBasis.toBeBilled => 'TO_BE_BILLED',
      };

  String get label => switch (this) {
        FreightBasis.paid => 'Paid',
        FreightBasis.toPay => 'To Pay',
        FreightBasis.toBeBilled => 'To be billed',
      };

  String get hint => switch (this) {
        FreightBasis.paid => 'Freight already taken from the sender',
        FreightBasis.toPay => 'Freight to be taken at delivery',
        FreightBasis.toBeBilled => 'Freight will go on the bill',
      };

  static FreightBasis fromCode(String? code) => switch (code) {
        'PAID' => FreightBasis.paid,
        'TO_BE_BILLED' => FreightBasis.toBeBilled,
        _ => FreightBasis.toPay,
      };
}

/// At whose risk the goods travel. Owner's risk is the ordinary trade
/// practice; carrier's risk is charged for, and means what it says.
enum RiskBasis {
  owner,
  carrier;

  String get code =>
      this == RiskBasis.carrier ? 'CARRIER' : 'OWNER';

  String get label =>
      this == RiskBasis.carrier ? "Carrier's Risk" : "Owner's Risk";

  static RiskBasis fromCode(String? code) =>
      code == 'CARRIER' ? RiskBasis.carrier : RiskBasis.owner;
}

/// One line of goods on the bilty.
class ConsignmentItemModel {
  final String id;
  final String consignmentId;
  final int sortOrder;

  final String itemName;
  final double quantity;
  final String unit;
  final String marks;
  final String conditionNote;

  const ConsignmentItemModel({
    required this.id,
    this.consignmentId = '',
    this.sortOrder = 0,
    required this.itemName,
    this.quantity = 1,
    this.unit = 'Nos',
    this.marks = '',
    this.conditionNote = '',
  });

  ConsignmentItemModel copyWith({
    String? id,
    String? consignmentId,
    int? sortOrder,
    String? itemName,
    double? quantity,
    String? unit,
    String? marks,
    String? conditionNote,
  }) {
    return ConsignmentItemModel(
      id: id ?? this.id,
      consignmentId: consignmentId ?? this.consignmentId,
      sortOrder: sortOrder ?? this.sortOrder,
      itemName: itemName ?? this.itemName,
      quantity: quantity ?? this.quantity,
      unit: unit ?? this.unit,
      marks: marks ?? this.marks,
      conditionNote: conditionNote ?? this.conditionNote,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'consignment_id': consignmentId,
        'sort_order': sortOrder,
        'item_name': itemName,
        'quantity': quantity,
        'unit': unit,
        'marks': marks,
        'condition_note': conditionNote,
      };

  factory ConsignmentItemModel.fromMap(Map<String, dynamic> map) {
    String text(String key) => (map[key] as String?) ?? '';

    return ConsignmentItemModel(
      id: map['id'] as String,
      consignmentId: text('consignment_id'),
      sortOrder: (map['sort_order'] as int?) ?? 0,
      itemName: text('item_name'),
      quantity: (map['quantity'] as num?)?.toDouble() ?? 0,
      unit: text('unit').isEmpty ? 'Nos' : text('unit'),
      marks: text('marks'),
      conditionNote: text('condition_note'),
    );
  }
}

/// A consignment moved by road, and the three papers that come off it:
/// the Lorry Receipt (bilty), the Goods Forwarding Note and the
/// Delivery Challan.
class ConsignmentModel {
  final String id;
  final String lrNo;
  final String lrDate;

  /// Allocated only when a delivery challan is actually printed, so
  /// that series stays unbroken.
  final String challanNo;
  final String challanDate;

  final ConsignmentStatus status;

  final String bookingId;
  final String bookingNo;
  final String customerId;

  final String consignorName;
  final String consignorPhone;
  final String consignorAddress;
  final String consignorGst;

  final String consigneeName;
  final String consigneePhone;
  final String consigneeAddress;
  final String consigneeGst;

  final String fromPlace;
  final String toPlace;

  final String vehicleNumber;
  final String driverName;
  final String driverPhone;
  final String driverLicence;

  final String goodsDescription;
  final int packages;
  final String weight;

  /// What the consignor declares the goods are worth. Under the
  /// Carriage by Road Rules this figure is the ceiling on what can be
  /// recovered, so the paper asks for it plainly.
  final double declaredValue;

  final FreightBasis freightBasis;
  final double freightAmount;
  final double advancePaid;
  final double otherCharges;

  final RiskBasis riskBasis;
  final bool insured;
  final String insurer;
  final String policyNo;

  final String deliveredOn;
  final String receivedBy;
  final String deliveryRemarks;

  final String notes;
  final String terms;

  final String createdAt;
  final String updatedAt;

  final List<ConsignmentItemModel> items;

  const ConsignmentModel({
    required this.id,
    this.lrNo = '',
    required this.lrDate,
    this.challanNo = '',
    this.challanDate = '',
    this.status = ConsignmentStatus.booked,
    this.bookingId = '',
    this.bookingNo = '',
    this.customerId = '',
    required this.consignorName,
    this.consignorPhone = '',
    this.consignorAddress = '',
    this.consignorGst = '',
    this.consigneeName = '',
    this.consigneePhone = '',
    this.consigneeAddress = '',
    this.consigneeGst = '',
    this.fromPlace = '',
    this.toPlace = '',
    this.vehicleNumber = '',
    this.driverName = '',
    this.driverPhone = '',
    this.driverLicence = '',
    this.goodsDescription = '',
    this.packages = 0,
    this.weight = '',
    this.declaredValue = 0,
    this.freightBasis = FreightBasis.toPay,
    this.freightAmount = 0,
    this.advancePaid = 0,
    this.otherCharges = 0,
    this.riskBasis = RiskBasis.owner,
    this.insured = false,
    this.insurer = '',
    this.policyNo = '',
    this.deliveredOn = '',
    this.receivedBy = '',
    this.deliveryRemarks = '',
    this.notes = '',
    this.terms = '',
    required this.createdAt,
    this.updatedAt = '',
    this.items = const [],
  });

  /// Freight still to be collected at the other end.
  double get freightBalance {
    final balance = freightAmount + otherCharges - advancePaid;
    return balance < 0 ? 0 : balance;
  }

  double get freightTotal => freightAmount + otherCharges;

  /// Packages as declared, or counted from the item lines when the
  /// operator did not type a number.
  int get totalPackages {
    if (packages > 0) return packages;
    final counted = items.fold(0.0, (sum, item) => sum + item.quantity);
    return counted.round();
  }

  bool get isDelivered => status == ConsignmentStatus.delivered;

  /// One line describing the load, for a list or a WhatsApp message.
  String get goodsLine {
    if (items.isNotEmpty) {
      return items
          .map((i) => '${i.itemName} - ${_qty(i.quantity)} ${i.unit}')
          .join(', ');
    }
    return goodsDescription.trim();
  }

  static String _qty(double value) => value == value.roundToDouble()
      ? value.toStringAsFixed(0)
      : value.toStringAsFixed(2);

  ConsignmentModel copyWith({
    String? id,
    String? lrNo,
    String? lrDate,
    String? challanNo,
    String? challanDate,
    ConsignmentStatus? status,
    String? bookingId,
    String? bookingNo,
    String? customerId,
    String? consignorName,
    String? consignorPhone,
    String? consignorAddress,
    String? consignorGst,
    String? consigneeName,
    String? consigneePhone,
    String? consigneeAddress,
    String? consigneeGst,
    String? fromPlace,
    String? toPlace,
    String? vehicleNumber,
    String? driverName,
    String? driverPhone,
    String? driverLicence,
    String? goodsDescription,
    int? packages,
    String? weight,
    double? declaredValue,
    FreightBasis? freightBasis,
    double? freightAmount,
    double? advancePaid,
    double? otherCharges,
    RiskBasis? riskBasis,
    bool? insured,
    String? insurer,
    String? policyNo,
    String? deliveredOn,
    String? receivedBy,
    String? deliveryRemarks,
    String? notes,
    String? terms,
    String? createdAt,
    String? updatedAt,
    List<ConsignmentItemModel>? items,
  }) {
    return ConsignmentModel(
      id: id ?? this.id,
      lrNo: lrNo ?? this.lrNo,
      lrDate: lrDate ?? this.lrDate,
      challanNo: challanNo ?? this.challanNo,
      challanDate: challanDate ?? this.challanDate,
      status: status ?? this.status,
      bookingId: bookingId ?? this.bookingId,
      bookingNo: bookingNo ?? this.bookingNo,
      customerId: customerId ?? this.customerId,
      consignorName: consignorName ?? this.consignorName,
      consignorPhone: consignorPhone ?? this.consignorPhone,
      consignorAddress: consignorAddress ?? this.consignorAddress,
      consignorGst: consignorGst ?? this.consignorGst,
      consigneeName: consigneeName ?? this.consigneeName,
      consigneePhone: consigneePhone ?? this.consigneePhone,
      consigneeAddress: consigneeAddress ?? this.consigneeAddress,
      consigneeGst: consigneeGst ?? this.consigneeGst,
      fromPlace: fromPlace ?? this.fromPlace,
      toPlace: toPlace ?? this.toPlace,
      vehicleNumber: vehicleNumber ?? this.vehicleNumber,
      driverName: driverName ?? this.driverName,
      driverPhone: driverPhone ?? this.driverPhone,
      driverLicence: driverLicence ?? this.driverLicence,
      goodsDescription: goodsDescription ?? this.goodsDescription,
      packages: packages ?? this.packages,
      weight: weight ?? this.weight,
      declaredValue: declaredValue ?? this.declaredValue,
      freightBasis: freightBasis ?? this.freightBasis,
      freightAmount: freightAmount ?? this.freightAmount,
      advancePaid: advancePaid ?? this.advancePaid,
      otherCharges: otherCharges ?? this.otherCharges,
      riskBasis: riskBasis ?? this.riskBasis,
      insured: insured ?? this.insured,
      insurer: insurer ?? this.insurer,
      policyNo: policyNo ?? this.policyNo,
      deliveredOn: deliveredOn ?? this.deliveredOn,
      receivedBy: receivedBy ?? this.receivedBy,
      deliveryRemarks: deliveryRemarks ?? this.deliveryRemarks,
      notes: notes ?? this.notes,
      terms: terms ?? this.terms,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      items: items ?? this.items,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'lr_no': lrNo,
        'lr_date': lrDate,
        'challan_no': challanNo,
        'challan_date': challanDate,
        'status': status.code,
        'booking_id': bookingId,
        'booking_no': bookingNo,
        'customer_id': customerId,
        'consignor_name': consignorName,
        'consignor_phone': consignorPhone,
        'consignor_address': consignorAddress,
        'consignor_gst': consignorGst,
        'consignee_name': consigneeName,
        'consignee_phone': consigneePhone,
        'consignee_address': consigneeAddress,
        'consignee_gst': consigneeGst,
        'from_place': fromPlace,
        'to_place': toPlace,
        'vehicle_number': vehicleNumber,
        'driver_name': driverName,
        'driver_phone': driverPhone,
        'driver_licence': driverLicence,
        'goods_description': goodsDescription,
        'packages': packages,
        'weight': weight,
        'declared_value': declaredValue,
        'freight_basis': freightBasis.code,
        'freight_amount': freightAmount,
        'advance_paid': advancePaid,
        'other_charges': otherCharges,
        'risk_basis': riskBasis.code,
        'insured': insured ? 1 : 0,
        'insurer': insurer,
        'policy_no': policyNo,
        'delivered_on': deliveredOn,
        'received_by': receivedBy,
        'delivery_remarks': deliveryRemarks,
        'notes': notes,
        'terms': terms,
        'created_at': createdAt,
        'updated_at': updatedAt,
      };

  factory ConsignmentModel.fromMap(
    Map<String, dynamic> map, {
    List<ConsignmentItemModel> items = const [],
  }) {
    String text(String key) => (map[key] as String?) ?? '';
    double number(String key) => (map[key] as num?)?.toDouble() ?? 0;

    return ConsignmentModel(
      id: map['id'] as String,
      lrNo: text('lr_no'),
      lrDate: text('lr_date'),
      challanNo: text('challan_no'),
      challanDate: text('challan_date'),
      status: ConsignmentStatus.fromCode(map['status'] as String?),
      bookingId: text('booking_id'),
      bookingNo: text('booking_no'),
      customerId: text('customer_id'),
      consignorName: text('consignor_name'),
      consignorPhone: text('consignor_phone'),
      consignorAddress: text('consignor_address'),
      consignorGst: text('consignor_gst'),
      consigneeName: text('consignee_name'),
      consigneePhone: text('consignee_phone'),
      consigneeAddress: text('consignee_address'),
      consigneeGst: text('consignee_gst'),
      fromPlace: text('from_place'),
      toPlace: text('to_place'),
      vehicleNumber: text('vehicle_number'),
      driverName: text('driver_name'),
      driverPhone: text('driver_phone'),
      driverLicence: text('driver_licence'),
      goodsDescription: text('goods_description'),
      packages: (map['packages'] as int?) ?? 0,
      weight: text('weight'),
      declaredValue: number('declared_value'),
      freightBasis: FreightBasis.fromCode(map['freight_basis'] as String?),
      freightAmount: number('freight_amount'),
      advancePaid: number('advance_paid'),
      otherCharges: number('other_charges'),
      riskBasis: RiskBasis.fromCode(map['risk_basis'] as String?),
      insured: (map['insured'] as int?) == 1,
      insurer: text('insurer'),
      policyNo: text('policy_no'),
      deliveredOn: text('delivered_on'),
      receivedBy: text('received_by'),
      deliveryRemarks: text('delivery_remarks'),
      notes: text('notes'),
      terms: text('terms'),
      createdAt: text('created_at'),
      updatedAt: text('updated_at'),
      items: items,
    );
  }
}
