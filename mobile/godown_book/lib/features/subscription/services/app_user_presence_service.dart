import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import '../../../core/constants/app_build.dart';

/// One signed-in account, as the Super Admin sees it.
class AppUserRecord {
  final String uid;
  final String firstSignInAt;
  final String lastSeenAt;
  final String appBuild;

  const AppUserRecord({
    required this.uid,
    this.firstSignInAt = '',
    this.lastSeenAt = '',
    this.appBuild = '',
  });

  factory AppUserRecord.fromFirestore(Map<String, dynamic> data, String id) {
    String text(Object? value) => value is String ? value : '';
    return AppUserRecord(
      uid: id,
      firstSignInAt: text(data['firstSignInAt']),
      lastSeenAt: text(data['lastSeenAt']),
      appBuild: text(data['appBuild']),
    );
  }
}

/// Records that an account signed in, and when it last opened the app,
/// at appUsers/{uid}.
///
/// WHY NOT THE SUBSCRIPTION RECORD: that is created per company, once
/// the company is set up, so it misses everyone who signed in and then
/// stopped - exactly the people a "how many are signing up" figure has
/// to include. This is written at the OTP sign-in itself, before any
/// company exists, and again at every launch. It holds no phone number:
/// a uid, two dates and the build.
class AppUserPresenceService {
  AppUserPresenceService._();

  static final AppUserPresenceService instance = AppUserPresenceService._();

  /// Tests point this at a FakeFirebaseFirestore.
  static FirebaseFirestore? firestoreOverride;

  static const Duration _timeout = Duration(seconds: 8);

  CollectionReference<Map<String, dynamic>> get _collection =>
      (firestoreOverride ?? FirebaseFirestore.instance).collection('appUsers');

  /// Best-effort: a failure here must never get in the way of signing in
  /// or opening the app, so it is logged and swallowed.
  Future<void> record(
    String uid, {
    DateTime? now,
    String appBuild = AppBuild.number,
  }) async {
    if (uid.trim().isEmpty) return;
    final at = (now ?? DateTime.now()).toIso8601String();

    try {
      final ref = _collection.doc(uid);
      final snapshot = await ref.get().timeout(_timeout);
      if (snapshot.exists) {
        await ref
            .update({'lastSeenAt': at, 'appBuild': appBuild})
            .timeout(_timeout);
      } else {
        await ref.set({
          'uid': uid,
          'firstSignInAt': at,
          'lastSeenAt': at,
          'appBuild': appBuild,
        }).timeout(_timeout);
      }
    } catch (error) {
      debugPrint('Sign-in not recorded: $error');
    }
  }

  /// Every account that has signed in - Super Admin only (rules).
  /// Throws when the list cannot be read, so the dashboard can say so
  /// instead of showing a confident zero.
  Future<List<AppUserRecord>> getAll() async {
    final snapshot = await _collection.get().timeout(_timeout);
    return snapshot.docs
        .map((doc) => AppUserRecord.fromFirestore(doc.data(), doc.id))
        .toList();
  }

  /// Account deletion takes the record with it. Best-effort.
  Future<void> deleteOwn(String uid) async {
    try {
      await _collection.doc(uid).delete().timeout(_timeout);
    } catch (error) {
      debugPrint('Sign-in record not deleted: $error');
    }
  }
}
