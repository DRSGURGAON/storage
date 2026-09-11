import '../../../core/document_theme/document_theme.dart';

class CompanyModel {
  // ==========================
  // Primary
  // ==========================

  /// Local row id. Never leaves this device.
  final int id;

  /// Stable tenant identifier used on every business row and, later, as the
  /// document key in the cloud. Empty until onboarding creates the company.
  final String companyId;

  final String companyCode;

  // ==========================
  // Company
  // ==========================

  final String companyName;
  final String tagLine;
  final String affiliatedBy;

  // ==========================
  // Branding
  // ==========================

  final String logoPath;
  final String signaturePath;
  final String stampPath;

  /// The company's chosen quotation PDF presentation theme - purely
  /// visual (colors, section-header styling, borders), never affects
  /// quotation data or calculations. Defaults to Classic, which matches
  /// the PDF's appearance from before this setting existed, so an
  /// existing company that never touches this sees no visual change.
  final DocumentTheme documentTheme;

  /// Printed under the signature image on the quotation PDF (e.g.
  /// "Rajesh Kumar, Director") - the signature image alone does not say
  /// whose signature it is.
  final String authorizedSignatoryName;

  // ==========================
  // Contact
  // ==========================

  final String mobile1;
  final String mobile2;
  final String mobile3;
  final String mobile4;

  final String whatsappNumber;
  final String landline;
  final String tollFree;

  final String email;
  final String website;

  // ==========================
  // Legal
  // ==========================

  final String gstNumber;
  final String panNumber;
  final String msmeNumber;
  final String isoCertificate;

  // ==========================
  // Address
  // ==========================

  final String address;
  final String city;
  final String state;
  final String pincode;
  final String jurisdiction;

  // ==========================
  // Bank
  // ==========================

  final String beneficiaryName;
  final String bankName;
  final String branchName;
  final String accountNumber;
  final String ifscCode;

  // ==========================
  // UPI
  // ==========================

  final String upiId1;
  final String upiId2;
  final String phonePeNumber;
  final String googlePayNumber;
  final String paytmNumber;

  // ==========================
  // Document Preferences
  // ==========================

  final String quotationPrefix;
  final String bookingPrefix;
  final String invoicePrefix;
  final String receiptPrefix;
  final String releasePrefix;
  final String consignmentPrefix;

  final String defaultTerms;
  final String footerText;

  /// Optional second footer line printed under [footerText] on every
  /// document - per-company, editable from Reports -> Customise
  /// Documents. Empty means only the first line prints, exactly as
  /// before this field existed.
  final String footerText2;

  // ==========================
  // Audit
  // ==========================

  final String createdAt;
  final String updatedAt;

  /// The minimum details a printed quotation cannot go out without.
  /// Used to block PDF generation instead of producing a blank letterhead.
  bool get isConfigured =>
      companyId.isNotEmpty &&
      companyName.trim().isNotEmpty &&
      address.trim().isNotEmpty &&
      mobile1.trim().isNotEmpty;

  /// Fields still to be filled, shown to the user so they know what to fix.
  List<String> get missingFields => [
    if (companyName.trim().isEmpty) 'Company name',
    if (address.trim().isEmpty) 'Address',
    if (mobile1.trim().isEmpty) 'Mobile number',
    if (gstNumber.trim().isEmpty) 'GST number',
    if (logoPath.trim().isEmpty) 'Logo',
    if (beneficiaryName.trim().isEmpty) 'Bank details',
    if (signaturePath.trim().isEmpty) 'Signature',
  ];

  const CompanyModel({
    this.id = 1,
    this.companyId = '',
    this.companyCode = 'DRS001',

    required this.companyName,

    this.tagLine = '',
    this.affiliatedBy = '',

    this.logoPath = '',
    this.signaturePath = '',
    this.stampPath = '',
    this.authorizedSignatoryName = '',
    this.documentTheme = DocumentTheme.classic,

    this.mobile1 = '',
    this.mobile2 = '',
    this.mobile3 = '',
    this.mobile4 = '',

    this.whatsappNumber = '',
    this.landline = '',
    this.tollFree = '',

    this.email = '',
    this.website = '',

    this.gstNumber = '',
    this.panNumber = '',
    this.msmeNumber = '',
    this.isoCertificate = '',

    this.address = '',
    this.city = '',
    this.state = '',
    this.pincode = '',
    this.jurisdiction = '',

    this.beneficiaryName = '',
    this.bankName = '',
    this.branchName = '',
    this.accountNumber = '',
    this.ifscCode = '',

    this.upiId1 = '',
    this.upiId2 = '',
    this.phonePeNumber = '',
    this.googlePayNumber = '',
    this.paytmNumber = '',

    this.quotationPrefix = 'QT',
    this.bookingPrefix = 'SR',
    this.invoicePrefix = 'INV',
    this.receiptPrefix = 'MR',
    this.releasePrefix = 'RL',
    this.consignmentPrefix = 'LR',

    this.defaultTerms = '',
    this.footerText = '',
    this.footerText2 = '',

    this.createdAt = '',
    this.updatedAt = '',
  });
  CompanyModel copyWith({
    int? id,
    String? companyId,
    String? companyCode,

    String? companyName,
    String? tagLine,
    String? affiliatedBy,

    String? logoPath,
    String? signaturePath,
    String? stampPath,
    String? authorizedSignatoryName,
    DocumentTheme? documentTheme,

    String? mobile1,
    String? mobile2,
    String? mobile3,
    String? mobile4,

    String? whatsappNumber,
    String? landline,
    String? tollFree,

    String? email,
    String? website,

    String? gstNumber,
    String? panNumber,
    String? msmeNumber,
    String? isoCertificate,

    String? address,
    String? city,
    String? state,
    String? pincode,
    String? jurisdiction,

    String? beneficiaryName,
    String? bankName,
    String? branchName,
    String? accountNumber,
    String? ifscCode,

    String? upiId1,
    String? upiId2,
    String? phonePeNumber,
    String? googlePayNumber,
    String? paytmNumber,

    String? quotationPrefix,
    String? bookingPrefix,
    String? invoicePrefix,
    String? receiptPrefix,
    String? releasePrefix,
    String? consignmentPrefix,

    String? defaultTerms,
    String? footerText,
    String? footerText2,

    String? createdAt,
    String? updatedAt,
  }) {
    return CompanyModel(
      id: id ?? this.id,
      companyId: companyId ?? this.companyId,
      companyCode: companyCode ?? this.companyCode,

      companyName: companyName ?? this.companyName,
      tagLine: tagLine ?? this.tagLine,
      affiliatedBy: affiliatedBy ?? this.affiliatedBy,

      logoPath: logoPath ?? this.logoPath,
      signaturePath: signaturePath ?? this.signaturePath,
      stampPath: stampPath ?? this.stampPath,
      authorizedSignatoryName:
          authorizedSignatoryName ?? this.authorizedSignatoryName,
      documentTheme: documentTheme ?? this.documentTheme,

      mobile1: mobile1 ?? this.mobile1,
      mobile2: mobile2 ?? this.mobile2,
      mobile3: mobile3 ?? this.mobile3,
      mobile4: mobile4 ?? this.mobile4,

      whatsappNumber: whatsappNumber ?? this.whatsappNumber,
      landline: landline ?? this.landline,
      tollFree: tollFree ?? this.tollFree,

      email: email ?? this.email,
      website: website ?? this.website,

      gstNumber: gstNumber ?? this.gstNumber,
      panNumber: panNumber ?? this.panNumber,
      msmeNumber: msmeNumber ?? this.msmeNumber,
      isoCertificate: isoCertificate ?? this.isoCertificate,

      address: address ?? this.address,
      city: city ?? this.city,
      state: state ?? this.state,
      pincode: pincode ?? this.pincode,
      jurisdiction: jurisdiction ?? this.jurisdiction,

      beneficiaryName: beneficiaryName ?? this.beneficiaryName,
      bankName: bankName ?? this.bankName,
      branchName: branchName ?? this.branchName,
      accountNumber: accountNumber ?? this.accountNumber,
      ifscCode: ifscCode ?? this.ifscCode,

      upiId1: upiId1 ?? this.upiId1,
      upiId2: upiId2 ?? this.upiId2,
      phonePeNumber: phonePeNumber ?? this.phonePeNumber,
      googlePayNumber: googlePayNumber ?? this.googlePayNumber,
      paytmNumber: paytmNumber ?? this.paytmNumber,

      quotationPrefix: quotationPrefix ?? this.quotationPrefix,
      bookingPrefix: bookingPrefix ?? this.bookingPrefix,
      invoicePrefix: invoicePrefix ?? this.invoicePrefix,
      receiptPrefix: receiptPrefix ?? this.receiptPrefix,
      releasePrefix: releasePrefix ?? this.releasePrefix,
      consignmentPrefix: consignmentPrefix ?? this.consignmentPrefix,

      defaultTerms: defaultTerms ?? this.defaultTerms,
      footerText: footerText ?? this.footerText,
      footerText2: footerText2 ?? this.footerText2,

      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'company_id': companyId,
      'company_code': companyCode,

      'company_name': companyName,
      'tag_line': tagLine,
      'affiliated_by': affiliatedBy,

      'logo_path': logoPath,
      'signature_path': signaturePath,
      'stamp_path': stampPath,
      'authorized_signatory_name': authorizedSignatoryName,
      'quotation_theme': documentTheme.code,

      'mobile1': mobile1,
      'mobile2': mobile2,
      'mobile3': mobile3,
      'mobile4': mobile4,

      'whatsapp': whatsappNumber,
      'landline': landline,
      'tollfree': tollFree,

      'email': email,
      'website': website,

      'gst_number': gstNumber,
      'pan_number': panNumber,
      'msme_number': msmeNumber,
      'iso_certificate': isoCertificate,

      'address': address,
      'city': city,
      'state': state,
      'pincode': pincode,
      'jurisdiction': jurisdiction,

      'beneficiary_name': beneficiaryName,
      'bank_name': bankName,
      'branch_name': branchName,
      'account_number': accountNumber,
      'ifsc_code': ifscCode,

      'upi1': upiId1,
      'upi2': upiId2,
      'phonepe': phonePeNumber,
      'gpay': googlePayNumber,
      'paytm': paytmNumber,

      'quotation_prefix': quotationPrefix,
      'booking_prefix': bookingPrefix,
      'invoice_prefix': invoicePrefix,
      'receipt_prefix': receiptPrefix,
      'release_prefix': releasePrefix,
      'consignment_prefix': consignmentPrefix,

      'default_terms': defaultTerms,
      'footer': footerText,
      'footer2': footerText2,

      'created_at': createdAt,
      'updated_at': updatedAt,
    };
  }

  factory CompanyModel.fromMap(Map<String, dynamic> map) {
    return CompanyModel(
      id: map['id'] ?? 1,
      companyId: map['company_id'] ?? '',
      companyCode: map['company_code'] ?? 'DRS001',

      companyName: map['company_name'] ?? '',
      tagLine: map['tag_line'] ?? '',
      affiliatedBy: map['affiliated_by'] ?? '',

      logoPath: map['logo_path'] ?? '',
      signaturePath: map['signature_path'] ?? '',
      stampPath: map['stamp_path'] ?? '',
      authorizedSignatoryName: map['authorized_signatory_name'] ?? '',
      documentTheme: DocumentTheme.fromCode(map['quotation_theme'] as String?),

      mobile1: map['mobile1'] ?? '',
      mobile2: map['mobile2'] ?? '',
      mobile3: map['mobile3'] ?? '',
      mobile4: map['mobile4'] ?? '',

      whatsappNumber: map['whatsapp'] ?? '',
      landline: map['landline'] ?? '',
      tollFree: map['tollfree'] ?? '',

      email: map['email'] ?? '',
      website: map['website'] ?? '',

      gstNumber: map['gst_number'] ?? '',
      panNumber: map['pan_number'] ?? '',
      msmeNumber: map['msme_number'] ?? '',
      isoCertificate: map['iso_certificate'] ?? '',

      address: map['address'] ?? '',
      city: map['city'] ?? '',
      state: map['state'] ?? '',
      pincode: map['pincode'] ?? '',
      jurisdiction: map['jurisdiction'] ?? '',

      beneficiaryName: map['beneficiary_name'] ?? '',
      bankName: map['bank_name'] ?? '',
      branchName: map['branch_name'] ?? '',
      accountNumber: map['account_number'] ?? '',
      ifscCode: map['ifsc_code'] ?? '',

      upiId1: map['upi1'] ?? '',
      upiId2: map['upi2'] ?? '',
      phonePeNumber: map['phonepe'] ?? '',
      googlePayNumber: map['gpay'] ?? '',
      paytmNumber: map['paytm'] ?? '',

      quotationPrefix: map['quotation_prefix'] ?? 'QT',
      bookingPrefix: map['booking_prefix'] ?? 'SR',
      invoicePrefix: map['invoice_prefix'] ?? 'INV',
      receiptPrefix: map['receipt_prefix'] ?? 'MR',
      releasePrefix: map['release_prefix'] ?? 'RL',
      consignmentPrefix: map['consignment_prefix'] ?? 'LR',

      defaultTerms: map['default_terms'] ?? '',
      footerText: map['footer'] ?? '',
      footerText2: map['footer2'] ?? '',

      createdAt: map['created_at'] ?? '',
      updatedAt: map['updated_at'] ?? '',
    );
  }
}
