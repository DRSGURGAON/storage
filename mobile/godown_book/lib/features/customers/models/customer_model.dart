/// A depositor - the party whose goods are kept in the godown.
///
/// Documents snapshot the customer's details at the time they are made
/// (a Warehouse Receipt carries its own customer_name/phone/GST/
/// address columns), so editing a customer here never rewrites an
/// already-issued receipt or bill. The id is a live reference only.
class CustomerModel {
  final String id;

  final String customerName;
  final String mobileNumber;
  final String altMobile;
  final String email;

  final String gstNumber;
  final String panNumber;

  final String address;
  final String city;
  final String state;
  final String pincode;

  /// e.g. "Aadhaar", "PAN", "Driving Licence" - free text.
  final String idProofType;
  final String idProofNumber;

  final String notes;
  final bool isActive;

  final String createdAt;
  final String? updatedAt;

  const CustomerModel({
    required this.id,
    required this.customerName,
    this.mobileNumber = '',
    this.altMobile = '',
    this.email = '',
    this.gstNumber = '',
    this.panNumber = '',
    this.address = '',
    this.city = '',
    this.state = '',
    this.pincode = '',
    this.idProofType = '',
    this.idProofNumber = '',
    this.notes = '',
    this.isActive = true,
    required this.createdAt,
    this.updatedAt,
  });

  /// One line for list rows and PDFs: address, city, state - pincode.
  String get fullAddress {
    final parts = <String>[
      if (address.trim().isNotEmpty) address.trim(),
      if (city.trim().isNotEmpty) city.trim(),
      if (state.trim().isNotEmpty) state.trim(),
    ];
    final line = parts.join(', ');
    return pincode.trim().isEmpty ? line : '$line - ${pincode.trim()}';
  }

  CustomerModel copyWith({
    String? customerName,
    String? mobileNumber,
    String? altMobile,
    String? email,
    String? gstNumber,
    String? panNumber,
    String? address,
    String? city,
    String? state,
    String? pincode,
    String? idProofType,
    String? idProofNumber,
    String? notes,
    bool? isActive,
    String? updatedAt,
  }) {
    return CustomerModel(
      id: id,
      customerName: customerName ?? this.customerName,
      mobileNumber: mobileNumber ?? this.mobileNumber,
      altMobile: altMobile ?? this.altMobile,
      email: email ?? this.email,
      gstNumber: gstNumber ?? this.gstNumber,
      panNumber: panNumber ?? this.panNumber,
      address: address ?? this.address,
      city: city ?? this.city,
      state: state ?? this.state,
      pincode: pincode ?? this.pincode,
      idProofType: idProofType ?? this.idProofType,
      idProofNumber: idProofNumber ?? this.idProofNumber,
      notes: notes ?? this.notes,
      isActive: isActive ?? this.isActive,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'customer_name': customerName,
      'mobile_number': mobileNumber,
      'alt_mobile': altMobile,
      'email': email,
      'gst_number': gstNumber,
      'pan_number': panNumber,
      'address': address,
      'city': city,
      'state': state,
      'pincode': pincode,
      'id_proof_type': idProofType,
      'id_proof_number': idProofNumber,
      'notes': notes,
      'is_active': isActive ? 1 : 0,
      'created_at': createdAt,
      'updated_at': updatedAt,
    };
  }

  factory CustomerModel.fromMap(Map<String, dynamic> map) {
    String text(String key) => (map[key] as String?) ?? '';

    return CustomerModel(
      id: map['id'] as String,
      customerName: text('customer_name'),
      mobileNumber: text('mobile_number'),
      altMobile: text('alt_mobile'),
      email: text('email'),
      gstNumber: text('gst_number'),
      panNumber: text('pan_number'),
      address: text('address'),
      city: text('city'),
      state: text('state'),
      pincode: text('pincode'),
      idProofType: text('id_proof_type'),
      idProofNumber: text('id_proof_number'),
      notes: text('notes'),
      isActive: (map['is_active'] as int? ?? 1) == 1,
      createdAt: text('created_at'),
      updatedAt: map['updated_at'] as String?,
    );
  }
}
