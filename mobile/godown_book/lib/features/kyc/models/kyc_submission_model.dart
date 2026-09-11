/// KYC verification states for a subscriber company. Stored as plain
/// strings (same convention as subscription/payment statuses).
class KycStatus {
  KycStatus._();

  static const String notSubmitted = 'NOT_SUBMITTED';
  static const String pending = 'PENDING';
  static const String approved = 'APPROVED';
  static const String rejected = 'REJECTED';

  static String label(String status) => switch (status) {
        pending => 'Pending Approval',
        approved => 'Approved',
        rejected => 'Rejected',
        _ => 'Not Submitted',
      };
}

/// The accepted "second ID" types alongside the mandatory PAN card.
class KycSecondDocType {
  KycSecondDocType._();

  static const List<String> options = [
    'Aadhaar Card',
    'Driving Licence',
    'Passport',
    'Voter ID',
    'Other Govt. ID',
  ];
}

/// One company's KYC submission - exactly two identity documents:
/// the PAN card (mandatory) plus one more govt. ID of the
/// subscriber's choice.
///
/// Locally (SQLite) only the device file paths are stored; the
/// Firestore document (kycSubmissions/{companyId}) instead carries the
/// images base64-encoded, following PlatformSettingsService's own
/// established no-Firebase-Storage pattern, so the Super Admin - on a
/// different device - can genuinely view them.
class KycSubmissionModel {
  final String companyId;

  final String panFilePath;
  final String panFileName;

  final String secondDocType;
  final String secondFilePath;
  final String secondFileName;

  /// One of KycStatus's constants.
  final String status;

  final String submittedAt;
  final String reviewedAt;
  final String rejectionReason;

  const KycSubmissionModel({
    required this.companyId,
    this.panFilePath = '',
    this.panFileName = '',
    this.secondDocType = '',
    this.secondFilePath = '',
    this.secondFileName = '',
    this.status = KycStatus.notSubmitted,
    this.submittedAt = '',
    this.reviewedAt = '',
    this.rejectionReason = '',
  });

  KycSubmissionModel copyWith({
    String? panFilePath,
    String? panFileName,
    String? secondDocType,
    String? secondFilePath,
    String? secondFileName,
    String? status,
    String? submittedAt,
    String? reviewedAt,
    String? rejectionReason,
  }) {
    return KycSubmissionModel(
      companyId: companyId,
      panFilePath: panFilePath ?? this.panFilePath,
      panFileName: panFileName ?? this.panFileName,
      secondDocType: secondDocType ?? this.secondDocType,
      secondFilePath: secondFilePath ?? this.secondFilePath,
      secondFileName: secondFileName ?? this.secondFileName,
      status: status ?? this.status,
      submittedAt: submittedAt ?? this.submittedAt,
      reviewedAt: reviewedAt ?? this.reviewedAt,
      rejectionReason: rejectionReason ?? this.rejectionReason,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'company_id': companyId,
      'pan_file_path': panFilePath,
      'pan_file_name': panFileName,
      'second_doc_type': secondDocType,
      'second_file_path': secondFilePath,
      'second_file_name': secondFileName,
      'status': status,
      'submitted_at': submittedAt,
      'reviewed_at': reviewedAt,
      'rejection_reason': rejectionReason,
    };
  }

  factory KycSubmissionModel.fromMap(Map<String, dynamic> map) {
    return KycSubmissionModel(
      companyId: map['company_id'] as String? ?? '',
      panFilePath: map['pan_file_path'] as String? ?? '',
      panFileName: map['pan_file_name'] as String? ?? '',
      secondDocType: map['second_doc_type'] as String? ?? '',
      secondFilePath: map['second_file_path'] as String? ?? '',
      secondFileName: map['second_file_name'] as String? ?? '',
      status: map['status'] as String? ?? KycStatus.notSubmitted,
      submittedAt: map['submitted_at'] as String? ?? '',
      reviewedAt: map['reviewed_at'] as String? ?? '',
      rejectionReason: map['rejection_reason'] as String? ?? '',
    );
  }
}
