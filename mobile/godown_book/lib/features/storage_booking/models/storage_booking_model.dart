import 'booking_item_model.dart';
import 'storage_status.dart';

/// One lot of goods received into storage from one customer - the
/// Warehouse Receipt. Every later paper hangs off it: Inventory List,
/// Storage Agreement, Delivery Orders / Gate Passes and rent bills.
///
/// Customer details are a snapshot taken when the receipt was issued;
/// [customerId] is a live reference for navigation only, so editing
/// the Customer master never rewrites an issued receipt.
class StorageBookingModel {
  final String id;
  final String bookingNo;
  final String bookingDate;

  final String customerId;
  final String customerName;
  final String customerPhone;
  final String customerGst;
  final String customerAddress;
  final String customerCity;
  final String customerState;
  final String customerPincode;
  final String customerIdProof;

  final String locationId;
  final String locationName;

  final String storageStartDate;
  final String expectedEndDate;
  final String actualEndDate;

  final RentBasis rentBasis;
  final double rentRate;
  final String rentUnitLabel;
  final double areaSqft;
  final double securityDeposit;

  final int totalPackages;
  final String goodsDescription;
  final double declaredValue;
  final String insuranceNote;

  final String vehicleNumber;
  final String driverName;
  final String receivedBy;

  final StorageStatus status;

  /// Last date rent has been invoiced up to (ISO date), or '' before
  /// the first rent bill.
  final String rentBilledUpto;

  final String notes;
  final String terms;

  final String createdAt;
  final String updatedAt;

  /// Loaded alongside the row by the repository; not a column.
  final List<BookingItemModel> items;

  const StorageBookingModel({
    required this.id,
    this.bookingNo = '',
    required this.bookingDate,
    this.customerId = '',
    required this.customerName,
    this.customerPhone = '',
    this.customerGst = '',
    this.customerAddress = '',
    this.customerCity = '',
    this.customerState = '',
    this.customerPincode = '',
    this.customerIdProof = '',
    this.locationId = '',
    this.locationName = '',
    required this.storageStartDate,
    this.expectedEndDate = '',
    this.actualEndDate = '',
    this.rentBasis = RentBasis.monthly,
    this.rentRate = 0,
    this.rentUnitLabel = '',
    this.areaSqft = 0,
    this.securityDeposit = 0,
    this.totalPackages = 0,
    this.goodsDescription = '',
    this.declaredValue = 0,
    this.insuranceNote = '',
    this.vehicleNumber = '',
    this.driverName = '',
    this.receivedBy = '',
    this.status = StorageStatus.inStorage,
    this.rentBilledUpto = '',
    this.notes = '',
    this.terms = '',
    required this.createdAt,
    this.updatedAt = '',
    this.items = const [],
  });

  /// Packages still in the godown, summed over the items.
  double get remainingQuantity =>
      items.fold(0.0, (sum, item) => sum + item.remainingQty);

  double get totalQuantity =>
      items.fold(0.0, (sum, item) => sum + item.quantity);

  /// The status the items imply - used by the repository to keep the
  /// stored status in step after every release.
  StorageStatus get derivedStatus {
    if (status == StorageStatus.cancelled) return StorageStatus.cancelled;
    if (items.isEmpty) return status;
    final total = totalQuantity;
    final released = items.fold(0.0, (sum, item) => sum + item.releasedQty);
    if (released <= 0) return StorageStatus.inStorage;
    if (released >= total) return StorageStatus.released;
    return StorageStatus.partiallyReleased;
  }

  String get customerFullAddress {
    final parts = <String>[
      if (customerAddress.trim().isNotEmpty) customerAddress.trim(),
      if (customerCity.trim().isNotEmpty) customerCity.trim(),
      if (customerState.trim().isNotEmpty) customerState.trim(),
    ];
    final line = parts.join(', ');
    return customerPincode.trim().isEmpty
        ? line
        : '$line - ${customerPincode.trim()}';
  }

  StorageBookingModel copyWith({
    String? id,
    String? bookingNo,
    String? bookingDate,
    String? customerId,
    String? customerName,
    String? customerPhone,
    String? customerGst,
    String? customerAddress,
    String? customerCity,
    String? customerState,
    String? customerPincode,
    String? customerIdProof,
    String? locationId,
    String? locationName,
    String? storageStartDate,
    String? expectedEndDate,
    String? actualEndDate,
    RentBasis? rentBasis,
    double? rentRate,
    String? rentUnitLabel,
    double? areaSqft,
    double? securityDeposit,
    int? totalPackages,
    String? goodsDescription,
    double? declaredValue,
    String? insuranceNote,
    String? vehicleNumber,
    String? driverName,
    String? receivedBy,
    StorageStatus? status,
    String? rentBilledUpto,
    String? notes,
    String? terms,
    String? createdAt,
    String? updatedAt,
    List<BookingItemModel>? items,
  }) {
    return StorageBookingModel(
      id: id ?? this.id,
      bookingNo: bookingNo ?? this.bookingNo,
      bookingDate: bookingDate ?? this.bookingDate,
      customerId: customerId ?? this.customerId,
      customerName: customerName ?? this.customerName,
      customerPhone: customerPhone ?? this.customerPhone,
      customerGst: customerGst ?? this.customerGst,
      customerAddress: customerAddress ?? this.customerAddress,
      customerCity: customerCity ?? this.customerCity,
      customerState: customerState ?? this.customerState,
      customerPincode: customerPincode ?? this.customerPincode,
      customerIdProof: customerIdProof ?? this.customerIdProof,
      locationId: locationId ?? this.locationId,
      locationName: locationName ?? this.locationName,
      storageStartDate: storageStartDate ?? this.storageStartDate,
      expectedEndDate: expectedEndDate ?? this.expectedEndDate,
      actualEndDate: actualEndDate ?? this.actualEndDate,
      rentBasis: rentBasis ?? this.rentBasis,
      rentRate: rentRate ?? this.rentRate,
      rentUnitLabel: rentUnitLabel ?? this.rentUnitLabel,
      areaSqft: areaSqft ?? this.areaSqft,
      securityDeposit: securityDeposit ?? this.securityDeposit,
      totalPackages: totalPackages ?? this.totalPackages,
      goodsDescription: goodsDescription ?? this.goodsDescription,
      declaredValue: declaredValue ?? this.declaredValue,
      insuranceNote: insuranceNote ?? this.insuranceNote,
      vehicleNumber: vehicleNumber ?? this.vehicleNumber,
      driverName: driverName ?? this.driverName,
      receivedBy: receivedBy ?? this.receivedBy,
      status: status ?? this.status,
      rentBilledUpto: rentBilledUpto ?? this.rentBilledUpto,
      notes: notes ?? this.notes,
      terms: terms ?? this.terms,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      items: items ?? this.items,
    );
  }

  /// Row map - items are stored separately (see StorageBookingDao).
  Map<String, dynamic> toMap() => {
        'id': id,
        'booking_no': bookingNo,
        'booking_date': bookingDate,
        'customer_id': customerId,
        'customer_name': customerName,
        'customer_phone': customerPhone,
        'customer_gst': customerGst,
        'customer_address': customerAddress,
        'customer_city': customerCity,
        'customer_state': customerState,
        'customer_pincode': customerPincode,
        'customer_id_proof': customerIdProof,
        'location_id': locationId,
        'location_name': locationName,
        'storage_start_date': storageStartDate,
        'expected_end_date': expectedEndDate,
        'actual_end_date': actualEndDate,
        'rent_basis': rentBasis.code,
        'rent_rate': rentRate,
        'rent_unit_label': rentUnitLabel,
        'area_sqft': areaSqft,
        'security_deposit': securityDeposit,
        'total_packages': totalPackages,
        'goods_description': goodsDescription,
        'declared_value': declaredValue,
        'insurance_note': insuranceNote,
        'vehicle_number': vehicleNumber,
        'driver_name': driverName,
        'received_by': receivedBy,
        'status': status.code,
        'rent_billed_upto': rentBilledUpto.isEmpty ? null : rentBilledUpto,
        'notes': notes,
        'terms': terms,
        'created_at': createdAt,
        'updated_at': updatedAt,
      };

  factory StorageBookingModel.fromMap(
    Map<String, dynamic> map, {
    List<BookingItemModel> items = const [],
  }) {
    String text(String key) => (map[key] as String?) ?? '';
    double number(String key) => (map[key] as num?)?.toDouble() ?? 0;

    return StorageBookingModel(
      id: map['id'] as String,
      bookingNo: text('booking_no'),
      bookingDate: text('booking_date'),
      customerId: text('customer_id'),
      customerName: text('customer_name'),
      customerPhone: text('customer_phone'),
      customerGst: text('customer_gst'),
      customerAddress: text('customer_address'),
      customerCity: text('customer_city'),
      customerState: text('customer_state'),
      customerPincode: text('customer_pincode'),
      customerIdProof: text('customer_id_proof'),
      locationId: text('location_id'),
      locationName: text('location_name'),
      storageStartDate: text('storage_start_date'),
      expectedEndDate: text('expected_end_date'),
      actualEndDate: text('actual_end_date'),
      rentBasis: RentBasis.fromCode(map['rent_basis'] as String?),
      rentRate: number('rent_rate'),
      rentUnitLabel: text('rent_unit_label'),
      areaSqft: number('area_sqft'),
      securityDeposit: number('security_deposit'),
      totalPackages: (map['total_packages'] as int?) ?? 0,
      goodsDescription: text('goods_description'),
      declaredValue: number('declared_value'),
      insuranceNote: text('insurance_note'),
      vehicleNumber: text('vehicle_number'),
      driverName: text('driver_name'),
      receivedBy: text('received_by'),
      status: StorageStatus.fromCode(map['status'] as String?),
      rentBilledUpto: text('rent_billed_upto'),
      notes: text('notes'),
      terms: text('terms'),
      createdAt: text('created_at'),
      updatedAt: text('updated_at'),
      items: items,
    );
  }
}
