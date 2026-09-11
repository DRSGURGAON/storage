/// Whether everything went out, or only part of it.
enum ReleaseType {
  partial,
  full;

  String get code => this == ReleaseType.full ? 'FULL' : 'PARTIAL';

  String get label => this == ReleaseType.full ? 'Everything' : 'Part of the goods';

  static ReleaseType fromCode(String? code) =>
      code == 'FULL' ? ReleaseType.full : ReleaseType.partial;
}

/// One line of a release - how much of one stored item went out.
class ReleaseItemModel {
  final String id;
  final String releaseId;
  final String bookingItemId;
  final int sortOrder;

  final String itemName;
  final double quantity;
  final String unit;

  const ReleaseItemModel({
    required this.id,
    this.releaseId = '',
    required this.bookingItemId,
    this.sortOrder = 0,
    required this.itemName,
    this.quantity = 0,
    this.unit = 'Nos',
  });

  ReleaseItemModel copyWith({
    String? id,
    String? releaseId,
    String? bookingItemId,
    int? sortOrder,
    String? itemName,
    double? quantity,
    String? unit,
  }) {
    return ReleaseItemModel(
      id: id ?? this.id,
      releaseId: releaseId ?? this.releaseId,
      bookingItemId: bookingItemId ?? this.bookingItemId,
      sortOrder: sortOrder ?? this.sortOrder,
      itemName: itemName ?? this.itemName,
      quantity: quantity ?? this.quantity,
      unit: unit ?? this.unit,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'release_id': releaseId,
        'booking_item_id': bookingItemId,
        'sort_order': sortOrder,
        'item_name': itemName,
        'quantity': quantity,
        'unit': unit,
      };

  factory ReleaseItemModel.fromMap(Map<String, dynamic> map) {
    String text(String key) => (map[key] as String?) ?? '';

    return ReleaseItemModel(
      id: map['id'] as String,
      releaseId: text('release_id'),
      bookingItemId: text('booking_item_id'),
      sortOrder: (map['sort_order'] as int?) ?? 0,
      itemName: text('item_name'),
      quantity: (map['quantity'] as num?)?.toDouble() ?? 0,
      unit: text('unit').isEmpty ? 'Nos' : text('unit'),
    );
  }
}

/// Goods going back out to the customer - who collected them, what went,
/// and in which vehicle. Prints as the release record the gate keeps.
class GoodsReleaseModel {
  final String id;
  final String releaseNo;
  final String releaseDate;

  final String bookingId;
  final String bookingNo;
  final String customerName;
  final String customerPhone;

  final ReleaseType releaseType;

  final String collectedByName;
  final String collectedByPhone;
  final String collectedByIdProof;
  final String vehicleNumber;
  final String driverName;
  final String gateOutTime;

  /// What the customer still owed when the goods went out.
  final double outstandingAtRelease;

  final String remarks;
  final String createdAt;

  final List<ReleaseItemModel> items;

  const GoodsReleaseModel({
    required this.id,
    this.releaseNo = '',
    required this.releaseDate,
    required this.bookingId,
    this.bookingNo = '',
    required this.customerName,
    this.customerPhone = '',
    this.releaseType = ReleaseType.partial,
    this.collectedByName = '',
    this.collectedByPhone = '',
    this.collectedByIdProof = '',
    this.vehicleNumber = '',
    this.driverName = '',
    this.gateOutTime = '',
    this.outstandingAtRelease = 0,
    this.remarks = '',
    required this.createdAt,
    this.items = const [],
  });

  double get totalQuantity => items.fold(0.0, (sum, item) => sum + item.quantity);

  GoodsReleaseModel copyWith({
    String? id,
    String? releaseNo,
    String? releaseDate,
    String? bookingId,
    String? bookingNo,
    String? customerName,
    String? customerPhone,
    ReleaseType? releaseType,
    String? collectedByName,
    String? collectedByPhone,
    String? collectedByIdProof,
    String? vehicleNumber,
    String? driverName,
    String? gateOutTime,
    double? outstandingAtRelease,
    String? remarks,
    String? createdAt,
    List<ReleaseItemModel>? items,
  }) {
    return GoodsReleaseModel(
      id: id ?? this.id,
      releaseNo: releaseNo ?? this.releaseNo,
      releaseDate: releaseDate ?? this.releaseDate,
      bookingId: bookingId ?? this.bookingId,
      bookingNo: bookingNo ?? this.bookingNo,
      customerName: customerName ?? this.customerName,
      customerPhone: customerPhone ?? this.customerPhone,
      releaseType: releaseType ?? this.releaseType,
      collectedByName: collectedByName ?? this.collectedByName,
      collectedByPhone: collectedByPhone ?? this.collectedByPhone,
      collectedByIdProof: collectedByIdProof ?? this.collectedByIdProof,
      vehicleNumber: vehicleNumber ?? this.vehicleNumber,
      driverName: driverName ?? this.driverName,
      gateOutTime: gateOutTime ?? this.gateOutTime,
      outstandingAtRelease: outstandingAtRelease ?? this.outstandingAtRelease,
      remarks: remarks ?? this.remarks,
      createdAt: createdAt ?? this.createdAt,
      items: items ?? this.items,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'release_no': releaseNo,
        'release_date': releaseDate,
        'booking_id': bookingId,
        'booking_no': bookingNo,
        'customer_name': customerName,
        'customer_phone': customerPhone,
        'release_type': releaseType.code,
        'collected_by_name': collectedByName,
        'collected_by_phone': collectedByPhone,
        'collected_by_id_proof': collectedByIdProof,
        'vehicle_number': vehicleNumber,
        'driver_name': driverName,
        'gate_out_time': gateOutTime,
        'outstanding_at_release': outstandingAtRelease,
        'remarks': remarks,
        'created_at': createdAt,
      };

  factory GoodsReleaseModel.fromMap(
    Map<String, dynamic> map, {
    List<ReleaseItemModel> items = const [],
  }) {
    String text(String key) => (map[key] as String?) ?? '';

    return GoodsReleaseModel(
      id: map['id'] as String,
      releaseNo: text('release_no'),
      releaseDate: text('release_date'),
      bookingId: text('booking_id'),
      bookingNo: text('booking_no'),
      customerName: text('customer_name'),
      customerPhone: text('customer_phone'),
      releaseType: ReleaseType.fromCode(map['release_type'] as String?),
      collectedByName: text('collected_by_name'),
      collectedByPhone: text('collected_by_phone'),
      collectedByIdProof: text('collected_by_id_proof'),
      vehicleNumber: text('vehicle_number'),
      driverName: text('driver_name'),
      gateOutTime: text('gate_out_time'),
      outstandingAtRelease: (map['outstanding_at_release'] as num?)?.toDouble() ?? 0,
      remarks: text('remarks'),
      createdAt: text('created_at'),
      items: items,
    );
  }
}
