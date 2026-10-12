import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

/// One mobile number, one signed-in phone.
///
/// `deviceSessions/{uid}` in Firestore holds the id of the phone that
/// signed in most recently. Every signed-in phone listens to that
/// document; the moment it names a different phone, this one signs
/// itself out. So handing the login to a friend just logs the owner out
/// (and logging back in logs the friend out) - sharing stops being
/// worthwhile.
///
/// Best-effort by design: if Firestore cannot be reached (offline, rules
/// not deployed yet) nothing is enforced and the app works as before.
/// A phone that stays offline keeps its subscription only until
/// SubscriptionPolicy.maxOfflineDays runs out.
class DeviceSessionService {
  DeviceSessionService._();

  static final DeviceSessionService instance = DeviceSessionService._();

  /// Lets a sign-out that happens outside any screen still show a message.
  static final GlobalKey<ScaffoldMessengerState> messengerKey =
      GlobalKey<ScaffoldMessengerState>();

  static const _idKey = 'device_session_id';

  static const kickedMessage =
      'Aapka account kisi aur phone par login ho gaya, isliye is phone se '
      'logout kar diya gaya.';

  /// Signs this phone out. Ending the Firebase session is enough: the
  /// AuthStateWatcher clears the local session and the router returns
  /// to Login. Replaceable in tests.
  Future<void> Function()? onKickedOut = () => FirebaseAuth.instance.signOut();

  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _subscription;
  String? _watchedUid;

  DocumentReference<Map<String, dynamic>> _doc(String uid) =>
      FirebaseFirestore.instance.collection('deviceSessions').doc(uid);

  /// Call right after a genuine OTP sign-in: this phone becomes the one
  /// active phone for the number, and any other phone is signed out.
  Future<void> claim() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    await stop();

    try {
      final id = const Uuid().v4();
      // Saved locally first so the listener below can never mistake our
      // own fresh claim for somebody else's.
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_idKey, id);

      await _doc(uid)
          .set({'deviceId': id, 'claimedAt': FieldValue.serverTimestamp()})
          .timeout(const Duration(seconds: 10));
    } catch (error) {
      debugPrint('Device session not claimed: $error');
    }

    await start();
  }

  /// Starts watching for another phone taking over. Safe to call
  /// repeatedly; does nothing when nobody is signed in.
  Future<void> start() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) {
      await stop();
      return;
    }
    if (_subscription != null && _watchedUid == uid) return;

    await stop();
    _watchedUid = uid;
    _subscription = _doc(uid).snapshots().listen(
      (snapshot) => unawaited(_onSnapshot(uid, snapshot)),
      // Rules not deployed / transient error: never sign anyone out for it.
      onError: (Object error) => debugPrint('Device session watch: $error'),
    );
  }

  Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
    _watchedUid = null;
  }

  Future<void> _onSnapshot(
    String uid,
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) async {
    // A cached copy says nothing about what the server holds now.
    if (snapshot.metadata.isFromCache) return;
    if (FirebaseAuth.instance.currentUser?.uid != uid) return;

    String? localId;
    try {
      localId = (await SharedPreferences.getInstance()).getString(_idKey);
    } catch (_) {
      return;
    }

    final remoteId = snapshot.data()?['deviceId'];

    // An install from before this feature (no id yet), or a missing
    // document: adopt this phone instead of locking the owner out.
    if (localId == null || remoteId == null) {
      await claim();
      return;
    }

    if (remoteId != localId) {
      await _kickOut();
    }
  }

  Future<void> _kickOut() async {
    await stop();
    try {
      await onKickedOut?.call();
    } catch (error) {
      debugPrint('Sign-out after takeover failed: $error');
    }
    messengerKey.currentState?.showSnackBar(
      const SnackBar(
        content: Text(kickedMessage),
        duration: Duration(seconds: 8),
      ),
    );
  }
}
