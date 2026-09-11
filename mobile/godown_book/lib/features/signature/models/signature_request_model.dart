/// Where a signature request stands.
enum SignatureStatus {
  pending,
  signed,
  cancelled,
  expired;

  String get code => switch (this) {
        SignatureStatus.pending => 'PENDING',
        SignatureStatus.signed => 'SIGNED',
        SignatureStatus.cancelled => 'CANCELLED',
        SignatureStatus.expired => 'EXPIRED',
      };

  String get label => switch (this) {
        SignatureStatus.pending => 'Waiting for signature',
        SignatureStatus.signed => 'Signed',
        SignatureStatus.cancelled => 'Cancelled',
        SignatureStatus.expired => 'Link expired',
      };

  static SignatureStatus fromCode(String? code) => switch (code) {
        'SIGNED' => SignatureStatus.signed,
        'CANCELLED' => SignatureStatus.cancelled,
        'EXPIRED' => SignatureStatus.expired,
        _ => SignatureStatus.pending,
      };
}

/// One line of what the customer is shown before they sign.
class SignatureDetail {
  final String label;
  final String value;

  const SignatureDetail(this.label, this.value);

  Map<String, dynamic> toMap() => {'label': label, 'value': value};

  factory SignatureDetail.fromMap(Map<String, dynamic> map) => SignatureDetail(
        (map['label'] as String?) ?? '',
        (map['value'] as String?) ?? '',
      );
}

/// A request for a customer's signature, sent to them as a link.
///
/// The operator's own record. What the customer actually sees lives in
/// the cloud under the same token and is deleted once the signature has
/// been brought back here, so a link cannot keep showing a customer's
/// details forever.
class SignatureRequestModel {
  /// The token in the link.
  final String id;

  final String documentType;
  final String documentId;
  final String documentNo;

  final String customerName;
  final String customerPhone;

  final SignatureStatus status;
  final String link;

  final String createdAt;
  final String expiresAt;

  final String signedAt;
  final String signerName;

  /// Where the signature image was saved on this device.
  final String signaturePath;

  const SignatureRequestModel({
    required this.id,
    required this.documentType,
    required this.documentId,
    this.documentNo = '',
    this.customerName = '',
    this.customerPhone = '',
    this.status = SignatureStatus.pending,
    this.link = '',
    required this.createdAt,
    this.expiresAt = '',
    this.signedAt = '',
    this.signerName = '',
    this.signaturePath = '',
  });

  bool get isSigned => status == SignatureStatus.signed;

  bool get hasExpired {
    if (status != SignatureStatus.pending) return false;
    final expiry = DateTime.tryParse(expiresAt);
    return expiry != null && DateTime.now().isAfter(expiry);
  }

  SignatureRequestModel copyWith({
    SignatureStatus? status,
    String? link,
    String? expiresAt,
    String? signedAt,
    String? signerName,
    String? signaturePath,
  }) {
    return SignatureRequestModel(
      id: id,
      documentType: documentType,
      documentId: documentId,
      documentNo: documentNo,
      customerName: customerName,
      customerPhone: customerPhone,
      status: status ?? this.status,
      link: link ?? this.link,
      createdAt: createdAt,
      expiresAt: expiresAt ?? this.expiresAt,
      signedAt: signedAt ?? this.signedAt,
      signerName: signerName ?? this.signerName,
      signaturePath: signaturePath ?? this.signaturePath,
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'document_type': documentType,
        'document_id': documentId,
        'document_no': documentNo,
        'customer_name': customerName,
        'customer_phone': customerPhone,
        'status': status.code,
        'link': link,
        'created_at': createdAt,
        'expires_at': expiresAt,
        'signed_at': signedAt,
        'signer_name': signerName,
        'signature_path': signaturePath,
      };

  factory SignatureRequestModel.fromMap(Map<String, dynamic> map) {
    String text(String key) => (map[key] as String?) ?? '';

    return SignatureRequestModel(
      id: map['id'] as String,
      documentType: text('document_type'),
      documentId: text('document_id'),
      documentNo: text('document_no'),
      customerName: text('customer_name'),
      customerPhone: text('customer_phone'),
      status: SignatureStatus.fromCode(map['status'] as String?),
      link: text('link'),
      createdAt: text('created_at'),
      expiresAt: text('expires_at'),
      signedAt: text('signed_at'),
      signerName: text('signer_name'),
      signaturePath: text('signature_path'),
    );
  }
}
