import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/super_admin_model.dart';

/// Firestore-backed Super Admin authorization - one document per
/// admin, at superAdmins/{uid}, where {uid} is the Firebase Auth uid
/// of the person granted access.
///
/// WHY THIS EXISTS (Priority 4 of the production-readiness audit):
/// the previous SQLite-only super_admins table could never be checked
/// by a Firestore Security Rule - rules execute entirely on Google's
/// servers with no access to a phone's local database, so the
/// subscriptions collection's write rule had to be `allow write: if
/// false` for every authenticated user, genuine Super Admin included,
/// as a fail-safe rather than fail-open choice. Firestore-native
/// Super Admin status is what closes that gap: a rule can now call
/// get() against this exact collection and check the signed-in user's
/// own uid.
///
/// Every genuine authorization decision here is still checked
/// CLIENT-SIDE too (isSuperAdmin() gates the Dashboard UI and every
/// repository-layer write already does via SuperAdminScope) - but the
/// client-side check was never the actual security boundary to begin
/// with (a modified client can skip it); the Firestore Security Rule
/// this service now makes possible is the boundary that cannot be
/// bypassed by editing the app.
class SuperAdminFirestoreService {
  SuperAdminFirestoreService._();

  static final SuperAdminFirestoreService instance =
      SuperAdminFirestoreService._();

  static const Duration _timeout = Duration(seconds: 8);

  CollectionReference<Map<String, dynamic>> get _collection =>
      FirebaseFirestore.instance.collection('superAdmins');

  /// True when the currently signed-in Firebase user has an active
  /// Super Admin document. False (never throws) when signed out, the
  /// document doesn't exist, or the read genuinely fails (offline) -
  /// a failed check must deny access, not silently grant it.
  Future<bool> isCurrentUserSuperAdmin() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null || uid.isEmpty) return false;

    try {
      final snapshot = await _collection.doc(uid).get().timeout(_timeout);
      if (!snapshot.exists || snapshot.data() == null) return false;

      final admin = SuperAdminModel.fromFirestore(snapshot.data()!, uid);
      return admin.isActive;
    } catch (_) {
      return false;
    }
  }

  /// True when genuinely no Super Admin document exists anywhere yet -
  /// the one-time bootstrap flow's own signal for whether to offer
  /// itself at all. A failed read is treated as "cannot bootstrap"
  /// (never as "go ahead"), since granting platform-wide access on an
  /// inconclusive check would be the unsafe direction to guess wrong.
  Future<bool> canBootstrap() async {
    try {
      final snapshot = await _collection.limit(1).get().timeout(_timeout);
      return snapshot.docs.isEmpty;
    } catch (_) {
      return false;
    }
  }

  Future<List<SuperAdminModel>> getAll() async {
    final snapshot = await _collection.get().timeout(_timeout);

    return snapshot.docs
        .map((doc) => SuperAdminModel.fromFirestore(doc.data(), doc.id))
        .toList();
  }

  /// Grants Super Admin to [uid] - called only after the caller has
  /// already verified (via isCurrentUserSuperAdmin()) that THEY are
  /// genuinely a Super Admin themselves. This client-side gate is a
  /// UX convenience, not the real boundary: the actual enforcement is
  /// the Firestore Security Rule on this exact collection, which must
  /// independently require request.auth.uid to already be an active
  /// Super Admin before permitting a write here - see firestore.rules.
  Future<void> add({
    required String uid,
    required String mobileNumber,
    String name = '',
  }) async {
    final admin = SuperAdminModel(
      id: uid,
      mobileNumber: mobileNumber,
      name: name,
      createdAt: DateTime.now().toIso8601String(),
    );

    await _collection.doc(uid).set(admin.toFirestore(uid)).timeout(_timeout);
  }

  /// Bootstraps the very first Super Admin - the one write this
  /// collection's Security Rule must allow WITHOUT an existing Super
  /// Admin already being signed in (a chicken-and-egg problem
  /// add() cannot solve on its own). The rule authorizes this
  /// narrowly: create-only, and only when the collection is currently
  /// empty (see firestore.rules) - it can never be used to add a
  /// second admin or to overwrite an existing one.
  Future<SuperAdminModel> bootstrapFirstSuperAdmin({
    required String mobileNumber,
    String name = '',
  }) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null || uid.isEmpty) {
      throw StateError('You must be signed in to continue.');
    }

    final admin = SuperAdminModel(
      id: uid,
      mobileNumber: mobileNumber,
      name: name,
      createdAt: DateTime.now().toIso8601String(),
    );

    await _collection.doc(uid).set(admin.toFirestore(uid)).timeout(_timeout);

    return admin;
  }
}
