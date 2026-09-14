import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../../../core/subscription/super_admin_scope.dart';
import '../models/super_admin_model.dart';

/// The platform admin registry, platformAdmins/{uid} - one document
/// per person holding the superadmin claim (uid, role, active,
/// createdAt, updatedAt, grantedBy), written only by the Admin SDK
/// (tool/admin/set-superadmin.js).
///
/// WHAT DECIDES ACCESS is the custom claim on the ID token, checked by
/// SuperAdminScope client-side and by the Firestore Security Rules
/// server-side. This collection is the human-readable record of it
/// for the admin panel; no client can write it, so nothing in this app
/// - Super Admin included - can grant or revoke platform access.
class SuperAdminFirestoreService {
  SuperAdminFirestoreService._();

  static final SuperAdminFirestoreService instance =
      SuperAdminFirestoreService._();

  static const Duration _timeout = Duration(seconds: 8);

  /// Tests: a fake Firestore.
  static FirebaseFirestore? firestoreOverride;

  CollectionReference<Map<String, dynamic>> get _collection =>
      (firestoreOverride ?? FirebaseFirestore.instance)
          .collection('platformAdmins');

  /// True when the currently signed-in Firebase user's token carries
  /// the superadmin claim. False (never throws) when signed out or the
  /// claim cannot be read - a failed check must deny access, not
  /// silently grant it.
  Future<bool> isCurrentUserSuperAdmin() async {
    await SuperAdminScope.refresh();
    return SuperAdminScope.isSuperAdmin;
  }

  /// Super Admins are granted by the platform operator with the Admin
  /// SDK, never from inside the app - so there is nothing to bootstrap
  /// from a phone.
  Future<bool> canBootstrap() async => false;

  /// The admin registry - readable by Super Admins only (rules).
  Future<List<SuperAdminModel>> getAll() async {
    final snapshot = await _collection.get().timeout(_timeout);

    return snapshot.docs
        .map((doc) => SuperAdminModel.fromPlatformAdmin(doc.data(), doc.id))
        .toList();
  }

  /// The signed-in user's own registry entry, if any - what the admin
  /// panel shows under "your access".
  Future<SuperAdminModel?> getCurrent() async {
    final String? uid;
    try {
      uid = FirebaseAuth.instance.currentUser?.uid;
    } catch (_) {
      return null;
    }
    if (uid == null || uid.isEmpty) return null;

    try {
      final snapshot = await _collection.doc(uid).get().timeout(_timeout);
      final data = snapshot.data();
      if (!snapshot.exists || data == null) return null;
      return SuperAdminModel.fromPlatformAdmin(data, uid);
    } catch (_) {
      return null;
    }
  }

  /// Not possible from the app, by design: see the class comment.
  Future<void> add({
    required String uid,
    required String mobileNumber,
    String name = '',
  }) async {
    throw UnsupportedError(
      'Super Admin access is granted by the platform operator with the '
      'Admin SDK (tool/admin/set-superadmin.js), never from the app.',
    );
  }

  /// Not possible from the app, by design: see the class comment.
  Future<SuperAdminModel> bootstrapFirstSuperAdmin({
    required String mobileNumber,
    String name = '',
  }) async {
    throw UnsupportedError(
      'The first Super Admin is created with tool/admin/set-superadmin.js '
      'using the Firebase service account, never from the app.',
    );
  }
}
