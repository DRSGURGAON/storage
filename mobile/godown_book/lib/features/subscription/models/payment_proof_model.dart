/// The uploaded payment screenshot (Section 12) - a distinct row from
/// PaymentTransactionModel (referenced via proofId) rather than an
/// inline file path, so proof storage/validation stays isolated from
/// the transaction record itself and privacy rules (Section: "Do not
/// expose payment screenshots publicly") apply to one clear place.
class PaymentProofModel {
  final String id;
  final String companyId;

  /// Path on device storage - same file-storage architecture already
  /// used for company logo/signature (CompanyImagePicker), never a
  /// public URL.
  final String filePath;

  final String fileName;
  final int fileSizeBytes;

  final String uploadedAt;

  const PaymentProofModel({
    required this.id,
    required this.companyId,
    required this.filePath,
    this.fileName = '',
    this.fileSizeBytes = 0,
    required this.uploadedAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'company_id': companyId,
      'file_path': filePath,
      'file_name': fileName,
      'file_size_bytes': fileSizeBytes,
      'uploaded_at': uploadedAt,
    };
  }

  factory PaymentProofModel.fromMap(Map<String, dynamic> map) {
    return PaymentProofModel(
      id: map['id'] as String,
      companyId: map['company_id'] as String? ?? '',
      filePath: map['file_path'] as String? ?? '',
      fileName: map['file_name'] as String? ?? '',
      fileSizeBytes: map['file_size_bytes'] as int? ?? 0,
      uploadedAt: map['uploaded_at'] as String? ?? '',
    );
  }
}
