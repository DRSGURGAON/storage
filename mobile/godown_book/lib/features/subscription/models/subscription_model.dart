import '../../../core/subscription/subscription_status.dart';

/// A company's subscription (Section 1) - belongs to the
/// company/organization, never to an individual mobile number, per the
/// task's explicit instruction: "Subscription must belong to the
/// COMPANY / ORGANIZATION account. Do NOT bind subscription only to an
/// individual mobile number." All authorized users under that company
/// inherit its access - this record has no user/mobile-number field at
/// all, by design.
///
/// One row per company at any time (the currently-active/most-recent
/// subscription state) - the full history of past plans/renewals lives
/// in SubscriptionHistoryModel, never overwritten or deleted (Section
/// 23: "Never delete historical subscription records").
class SubscriptionModel {
  final String id;
  final String companyId;

  final String? planId;

  final SubscriptionStatus status;

  final String? startDate;
  final String? expiryDate;

  /// The Firebase Auth uid of whoever owns this company's subscription
  /// - the field a Firestore Security Rule needs to check "is the
  /// signed-in caller genuinely this company's own owner" (companyId
  /// itself is a locally-generated UUID, not a Firebase uid, so it
  /// cannot be compared against request.auth.uid directly - see
  /// firestore.rules's own doc comment on the subscriptions rule).
  /// Empty for subscriptions created before this field existed;
  /// SubscriptionRepository.getOrCreateForCompany() populates it for
  /// every new subscription and backfills it opportunistically when
  /// it notices a signed-in owner on an old record missing one.
  final String ownerUid;

  /// Denormalized copy of the company's own display name at the time
  /// this subscription was last written from the owning device -
  /// exists ONLY so SuperAdminDashboardScreen can show a real,
  /// per-company name for every row in its cross-company list without
  /// a second Firestore read per company (companies/{uid} has no
  /// Super-Admin-readable Security Rule - see firestore.rules' own
  /// doc comment on that collection). NOT the source of truth for the
  /// company's name - CompanyModel.companyName remains that; this is
  /// a read-optimization copy, refreshed opportunistically whenever
  /// the owning device calls getOrCreateForCompany() (see
  /// SubscriptionRepository's own doc comment on the backfill). Empty
  /// for subscriptions created before this field existed, and for any
  /// company whose device has never yet had a filled-in company
  /// profile at the time it synced.
  final String companyName;

  /// 5 more denormalized copies of the company's own profile fields,
  /// same purpose and same caveats as companyName above - exist ONLY
  /// so SuperAdminCompanyDetailScreen can show THIS company's real
  /// profile (not the Super Admin's own device-local company, which
  /// CompanyController.instance.getCompany() would otherwise return
  /// regardless of which company's subscription is being viewed).
  /// NOT the source of truth - CompanyModel remains that; these are
  /// read-optimization copies, refreshed opportunistically whenever
  /// the owning device calls getOrCreateForCompany().
  final String ownerMobile;
  final String gstNumber;
  final String authorizedSignatoryName;
  final String email;
  final String companyCode;

  /// Per-document-type demo-generation counters (Section 5) - stored as
  /// a JSON-encoded map (documentType -> count used) rather than one
  /// column per document type, since the set of document types is not
  /// fixed (Warehouse Receipt/Delivery Order/Bill/Money Receipt and
  /// whatever is added later) and a
  /// fixed-column schema would need a migration every time a new
  /// document type is added. See SubscriptionAccessService for the
  /// encode/decode logic - this model only carries the raw string.
  final String demoGenerationsUsedJson;

  final String createdAt;
  final String updatedAt;

  const SubscriptionModel({
    required this.id,
    required this.companyId,
    this.planId,
    this.status = SubscriptionStatus.limited,
    this.startDate,
    this.expiryDate,
    this.ownerUid = '',
    this.companyName = '',
    this.ownerMobile = '',
    this.gstNumber = '',
    this.authorizedSignatoryName = '',
    this.email = '',
    this.companyCode = '',
    this.demoGenerationsUsedJson = '{}',
    required this.createdAt,
    required this.updatedAt,
  });

  /// The last day the subscription covers, or null when it has no
  /// expiry recorded.
  DateTime? get expiresOn {
    final parsed = expiryDate == null ? null : DateTime.tryParse(expiryDate!);
    return parsed == null
        ? null
        : DateTime(parsed.year, parsed.month, parsed.day);
  }

  /// True once the expiry day has passed. The expiry date is the LAST
  /// day of the period (see SubscriptionRepository.activate), so access
  /// runs through the whole of that day.
  bool get hasLapsed {
    final last = expiresOn;
    if (last == null) return false;
    return DateTime.now().isAfter(last.add(const Duration(days: 1)));
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'company_id': companyId,
      'plan_id': planId,
      'status': status.code,
      'start_date': startDate,
      'expiry_date': expiryDate,
      'owner_uid': ownerUid,
      'company_name': companyName,
      'owner_mobile': ownerMobile,
      'gst_number': gstNumber,
      'authorized_signatory_name': authorizedSignatoryName,
      'email': email,
      'company_code': companyCode,
      'demo_generations_used_json': demoGenerationsUsedJson,
      'created_at': createdAt,
      'updated_at': updatedAt,
    };
  }

  factory SubscriptionModel.fromMap(Map<String, dynamic> map) {
    return SubscriptionModel(
      id: map['id'] as String,
      companyId: map['company_id'] as String? ?? '',
      planId: map['plan_id'] as String?,
      status: SubscriptionStatus.fromCode(map['status'] as String?),
      startDate: map['start_date'] as String?,
      expiryDate: map['expiry_date'] as String?,
      ownerUid: map['owner_uid'] as String? ?? '',
      companyName: map['company_name'] as String? ?? '',
      ownerMobile: map['owner_mobile'] as String? ?? '',
      gstNumber: map['gst_number'] as String? ?? '',
      authorizedSignatoryName:
          map['authorized_signatory_name'] as String? ?? '',
      email: map['email'] as String? ?? '',
      companyCode: map['company_code'] as String? ?? '',
      demoGenerationsUsedJson:
          map['demo_generations_used_json'] as String? ?? '{}',
      createdAt: map['created_at'] as String? ?? '',
      updatedAt: map['updated_at'] as String? ?? '',
    );
  }

  SubscriptionModel copyWith({
    String? planId,
    SubscriptionStatus? status,
    String? startDate,
    String? expiryDate,
    String? ownerUid,
    String? companyName,
    String? ownerMobile,
    String? gstNumber,
    String? authorizedSignatoryName,
    String? email,
    String? companyCode,
    String? demoGenerationsUsedJson,
    String? updatedAt,
  }) {
    return SubscriptionModel(
      id: id,
      companyId: companyId,
      planId: planId ?? this.planId,
      status: status ?? this.status,
      startDate: startDate ?? this.startDate,
      expiryDate: expiryDate ?? this.expiryDate,
      ownerUid: ownerUid ?? this.ownerUid,
      companyName: companyName ?? this.companyName,
      ownerMobile: ownerMobile ?? this.ownerMobile,
      gstNumber: gstNumber ?? this.gstNumber,
      authorizedSignatoryName:
          authorizedSignatoryName ?? this.authorizedSignatoryName,
      email: email ?? this.email,
      companyCode: companyCode ?? this.companyCode,
      demoGenerationsUsedJson:
          demoGenerationsUsedJson ?? this.demoGenerationsUsedJson,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  /// Firestore's own document shape - camelCase field names (matching
  /// the Firestore community's own convention, distinct from SQLite's
  /// snake_case toMap() above) and native bool, not SQLite's 0/1
  /// integer encoding. The document id IS companyId (one subscription
  /// document per company, at subscriptions/{companyId}) - id/companyId
  /// are still written into the body too so a reader that got this
  /// document via a collection query (not a direct doc lookup) still
  /// has both.
  Map<String, dynamic> toFirestore() {
    return {
      'id': id,
      'companyId': companyId,
      'planId': planId,
      'status': status.code,
      'startDate': startDate,
      'expiryDate': expiryDate,
      'ownerUid': ownerUid,
      'companyName': companyName,
      'ownerMobile': ownerMobile,
      'gstNumber': gstNumber,
      'authorizedSignatoryName': authorizedSignatoryName,
      'email': email,
      'companyCode': companyCode,
      'demoGenerationsUsedJson': demoGenerationsUsedJson,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }

  /// [documentId] is the Firestore document's own id (== companyId,
  /// see toFirestore()'s own doc comment) - used as a fallback for
  /// companyId only if the field itself is somehow genuinely absent
  /// from the document body (defensive; every document this app
  /// writes always includes it).
  factory SubscriptionModel.fromFirestore(
    Map<String, dynamic> data,
    String documentId,
  ) {
    return SubscriptionModel(
      id: data['id'] as String? ?? documentId,
      companyId: data['companyId'] as String? ?? documentId,
      planId: data['planId'] as String?,
      status: SubscriptionStatus.fromCode(data['status'] as String?),
      startDate: data['startDate'] as String?,
      expiryDate: data['expiryDate'] as String?,
      ownerUid: data['ownerUid'] as String? ?? '',
      companyName: data['companyName'] as String? ?? '',
      ownerMobile: data['ownerMobile'] as String? ?? '',
      gstNumber: data['gstNumber'] as String? ?? '',
      authorizedSignatoryName:
          data['authorizedSignatoryName'] as String? ?? '',
      email: data['email'] as String? ?? '',
      companyCode: data['companyCode'] as String? ?? '',
      demoGenerationsUsedJson:
          data['demoGenerationsUsedJson'] as String? ?? '{}',
      createdAt: data['createdAt'] as String? ?? '',
      updatedAt: data['updatedAt'] as String? ?? '',
    );
  }
}
