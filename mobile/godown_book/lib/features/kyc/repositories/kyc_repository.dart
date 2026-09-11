import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../../../core/database/database_constants.dart';
import '../../../core/database/database_helper.dart';
import '../../../core/subscription/super_admin_scope.dart';
import '../models/kyc_submission_model.dart';

/// A KYC submission as the Super Admin sees it - the metadata plus the
/// two document images decoded from the Firestore document's base64
/// fields (the submitting device's local file paths are useless on the
/// Super Admin's device - see KycSubmissionModel's own doc comment).
class KycReview {
  final String companyId;
  final String companyName;
  final String companyCode;
  final String secondDocType;
  final String status;
  final String submittedAt;
  final String reviewedAt;
  final String rejectionReason;
  final Uint8List? panImage;
  final Uint8List? secondImage;

  const KycReview({
    required this.companyId,
    this.companyName = '',
    this.companyCode = '',
    this.secondDocType = '',
    this.status = KycStatus.notSubmitted,
    this.submittedAt = '',
    this.reviewedAt = '',
    this.rejectionReason = '',
    this.panImage,
    this.secondImage,
  });
}

/// Why a KYC upload did or didn't reach the server - so the screen
/// can tell the user the actual fix ("check internet" vs "the server
/// rejected it") instead of one vague message for every failure.
enum KycPushResult { uploaded, permissionDenied, failed }

/// Subscriber-side KYC storage + the Super Admin's review actions.
///
/// Local SQLite (company_kyc) is the subscriber's own record;
/// Firestore (kycSubmissions/{companyId}) is what actually reaches the
/// Super Admin - same authoritative-cloud/cached-local split the
/// subscription system itself uses. Firestore writes are guarded by
/// the kycSubmissions rules block in firestore.rules: the owner can
/// only ever create/update their own submission with status PENDING
/// (so nobody can self-approve), review verdicts are Super-Admin-only.
class KycRepository {
  KycRepository._();

  static final KycRepository instance = KycRepository._();

  final DatabaseHelper _db = DatabaseHelper.instance;

  CollectionReference<Map<String, dynamic>> get _collection =>
      FirebaseFirestore.instance.collection('kycSubmissions');

  /// Same reasoning as SubscriptionRepository's timeout: Firestore
  /// retries forever when unreachable instead of throwing, so an
  /// un-timed await would hang the calling screen.
  static const Duration _timeout = Duration(seconds: 8);

  // ==========================
  // Subscriber side
  // ==========================

  Future<KycSubmissionModel?> getLocal(String companyId) async {
    final rows = await _db.queryWhere(
      DatabaseConstants.companyKycTable,
      where: 'company_id = ?',
      whereArgs: [companyId],
      limit: 1,
    );

    if (rows.isEmpty) return null;
    return KycSubmissionModel.fromMap(rows.first);
  }

  Future<void> saveLocal(KycSubmissionModel submission) async {
    // insert() uses ConflictAlgorithm.replace and company_id is UNIQUE,
    // so this is a straight upsert.
    await _db.insert(DatabaseConstants.companyKycTable, {
      'id': submission.companyId,
      ...submission.toMap(),
    });
  }

  /// Uploads the submission to Firestore so the Super Admin can review
  /// it. The local record stays PENDING regardless of the outcome and
  /// the screen offers re-submission - same best-effort shape as the
  /// company profile's own cloud mirror, but with the failure REASON
  /// surfaced: a permission-denied means the kycSubmissions rules
  /// block hasn't been published to Firebase yet (a one-time setup
  /// step), which no amount of "check your internet" would ever fix.
  Future<KycPushResult> pushToCloud(
    KycSubmissionModel submission, {
    required String companyName,
    required String companyCode,
  }) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return KycPushResult.failed;

    try {
      final panBytes = await File(submission.panFilePath).readAsBytes();
      final secondBytes = await File(submission.secondFilePath).readAsBytes();

      await _collection.doc(submission.companyId).set({
        'companyId': submission.companyId,
        'ownerUid': uid,
        'companyName': companyName,
        'companyCode': companyCode,
        'panFileName': submission.panFileName,
        'panBase64': base64Encode(panBytes),
        'secondDocType': submission.secondDocType,
        'secondFileName': submission.secondFileName,
        'secondBase64': base64Encode(secondBytes),
        'status': KycStatus.pending,
        'submittedAt': submission.submittedAt,
        'reviewedAt': '',
        'rejectionReason': '',
        'updatedAt': DateTime.now().toIso8601String(),
      }).timeout(_timeout);

      return KycPushResult.uploaded;
    } on FirebaseException catch (e) {
      return e.code == 'permission-denied'
          ? KycPushResult.permissionDenied
          : KycPushResult.failed;
    } catch (_) {
      return KycPushResult.failed;
    }
  }

  /// Retries a submission that never reached the server - called
  /// silently when the KYC screen opens, so a submission made offline
  /// (or before the Firestore rules were published) uploads by itself
  /// the next time the screen is visited, without the user having to
  /// remember to press Submit again.
  Future<KycPushResult?> ensureUploaded(
    KycSubmissionModel submission, {
    required String companyName,
    required String companyCode,
  }) async {
    if (submission.status != KycStatus.pending) return null;
    if (submission.panFilePath.isEmpty || submission.secondFilePath.isEmpty) {
      return null;
    }

    try {
      final doc =
          await _collection.doc(submission.companyId).get().timeout(_timeout);
      // Already on the server with the same submission timestamp -
      // nothing to re-send.
      if (doc.data() != null &&
          (doc.data()!['submittedAt'] as String? ?? '') ==
              submission.submittedAt) {
        return KycPushResult.uploaded;
      }
    } catch (_) {
      // Read failed (offline / rules) - fall through and let the
      // write attempt classify the failure.
    }

    return pushToCloud(
      submission,
      companyName: companyName,
      companyCode: companyCode,
    );
  }

  /// Pulls the current review verdict from Firestore into the local
  /// record - how an approval/rejection made on the Super Admin's
  /// device reaches the subscriber. Returns the refreshed local
  /// record (or the unchanged one when offline).
  Future<KycSubmissionModel?> refreshStatus(String companyId) async {
    final local = await getLocal(companyId);

    try {
      final doc = await _collection.doc(companyId).get().timeout(_timeout);
      final data = doc.data();

      if (data == null || local == null) return local;

      final refreshed = local.copyWith(
        status: data['status'] as String? ?? local.status,
        reviewedAt: data['reviewedAt'] as String? ?? local.reviewedAt,
        rejectionReason:
            data['rejectionReason'] as String? ?? local.rejectionReason,
      );

      await saveLocal(refreshed);
      return refreshed;
    } catch (_) {
      return local;
    }
  }

  // ==========================
  // Super Admin side
  // ==========================

  /// The full submission for review, images decoded. Null when the
  /// company has never submitted KYC (or Firestore is unreachable).
  Future<KycReview?> getForReview(String companyId) async {
    try {
      final doc = await _collection.doc(companyId).get().timeout(_timeout);
      final data = doc.data();

      if (data == null) return null;

      Uint8List? decode(String? base64) {
        if (base64 == null || base64.isEmpty) return null;
        try {
          return base64Decode(base64);
        } catch (_) {
          return null;
        }
      }

      return KycReview(
        companyId: companyId,
        companyName: data['companyName'] as String? ?? '',
        companyCode: data['companyCode'] as String? ?? '',
        secondDocType: data['secondDocType'] as String? ?? '',
        status: data['status'] as String? ?? KycStatus.pending,
        submittedAt: data['submittedAt'] as String? ?? '',
        reviewedAt: data['reviewedAt'] as String? ?? '',
        rejectionReason: data['rejectionReason'] as String? ?? '',
        panImage: decode(data['panBase64'] as String?),
        secondImage: decode(data['secondBase64'] as String?),
      );
    } catch (_) {
      return null;
    }
  }

  /// Approve or reject a company's KYC - Super Admin only (enforced
  /// both here and server-side by the kycSubmissions Firestore rule).
  Future<void> review(
    String companyId, {
    required bool approve,
    String rejectionReason = '',
  }) async {
    if (!SuperAdminScope.isSuperAdmin) {
      throw StateError('Super Admin access required.');
    }

    await _collection.doc(companyId).update({
      'status': approve ? KycStatus.approved : KycStatus.rejected,
      'reviewedAt': DateTime.now().toIso8601String(),
      'rejectionReason': approve ? '' : rejectionReason,
      'updatedAt': DateTime.now().toIso8601String(),
    }).timeout(_timeout);
  }
}
