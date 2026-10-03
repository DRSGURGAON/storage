import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../constants/app_build.dart';
import '../permissions/permission_service.dart';

/// The privileged actions a Super Admin can take, as written to the
/// audit log. Keep the codes stable: the admin panel filters on them.
class PlatformAuditAction {
  PlatformAuditAction._();

  static const String subscriptionActivated = 'SUBSCRIPTION_ACTIVATED';
  static const String subscriptionSuspended = 'SUBSCRIPTION_SUSPENDED';
  static const String subscriptionCancelled = 'SUBSCRIPTION_CANCELLED';
  static const String kycApproved = 'KYC_APPROVED';
  static const String kycRejected = 'KYC_REJECTED';
  static const String platformSettingsPublished = 'PLATFORM_SETTINGS_PUBLISHED';
}

/// Writes one entry per privileged Super Admin action to
/// platformAuditLogs/{id}: who (actor uid and mobile), what (action),
/// on whom (target company / user), when (server time) and the
/// details that matter.
///
/// The Firestore rules only accept an entry from a token carrying the
/// superadmin claim, about that same uid, stamped by the server, and
/// never let anyone change or delete one - so a normal user cannot
/// forge a privileged entry and a Super Admin cannot back-date or erase
/// one. Writing the entry is best-effort: a failed write is logged,
/// never allowed to undo the action it describes.
class PlatformAuditLogService {
  PlatformAuditLogService._();

  static final PlatformAuditLogService instance = PlatformAuditLogService._();

  static const String collectionPath = 'platformAuditLogs';
  static const Duration _timeout = Duration(seconds: 8);

  /// Tests: a fake Firestore and a pretend signed-in account.
  static FirebaseFirestore? firestoreOverride;
  static String? currentUidOverride;

  /// Tests: every entry recorded, in order.
  @visibleForTesting
  static final List<Map<String, dynamic>> recorded = [];

  FirebaseFirestore get _firestore =>
      firestoreOverride ?? FirebaseFirestore.instance;

  String? get _currentUid {
    final override = currentUidOverride;
    if (override != null) return override.isEmpty ? null : override;
    try {
      final uid = FirebaseAuth.instance.currentUser?.uid;
      return (uid == null || uid.isEmpty) ? null : uid;
    } catch (_) {
      return null;
    }
  }

  Future<void> record({
    required String action,
    String targetCompanyId = '',
    String targetUid = '',
    Map<String, Object?> metadata = const {},
  }) async {
    final uid = _currentUid;
    if (uid == null) return;

    final entry = <String, dynamic>{
      'actorUid': uid,
      'actorMobile': PermissionService.currentMobileNumberOverride ?? '',
      'action': action,
      'targetCompanyId': targetCompanyId,
      'targetUid': targetUid,
      'metadata': {
        for (final e in metadata.entries)
          if (e.value != null) e.key: e.value,
      },
      'appBuild': AppBuild.label,
      'createdAt': FieldValue.serverTimestamp(),
    };

    recorded.add(entry);

    try {
      await _firestore
          .collection(collectionPath)
          .add(entry)
          .timeout(_timeout);
    } catch (error) {
      debugPrint('Platform audit entry not written ($action): $error');
    }
  }
}
