import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../cloud_sync/document_cloud_sync_service.dart';
import '../permissions/permission_service.dart';
import '../subscription/super_admin_scope.dart';
import 'auth_scope.dart';

/// Whether the app has a completed mobile+OTP sign-in on this device,
/// which mobile number it was for, and the genuine Firebase Auth UID
/// that sign-in produced.
///
/// [uid] is only ever set from FirebaseAuth.instance.currentUser?.uid
/// after a real, server-verified sign-in (see
/// FirebasePhoneAuthService.verifyOtp()) - never fabricated locally.
/// This local flag/cache exists so GoRouter's redirect and the rest of
/// the app can synchronously check "is someone signed in" without an
/// async gap on every navigation (see AuthScope's own doc comment for
/// why that matters) - FirebaseAuth.instance.currentUser remains the
/// actual source of truth and is re-synced with this cache at startup
/// (see main.dart's _syncFirebaseAuthState).
class AuthSessionState {
  final bool isAuthenticated;
  final String? mobileNumber;
  final String? uid;

  const AuthSessionState({
    this.isAuthenticated = false,
    this.mobileNumber,
    this.uid,
  });
}

class AuthSessionNotifier extends StateNotifier<AuthSessionState> {
  AuthSessionNotifier() : super(const AuthSessionState()) {
    _load();
  }

  /// Public so main.dart's own _syncFirebaseAuthState() can read/write
  /// the exact same key this class uses, the same reasoning mobileKey
  /// below is already public for.
  static const authenticatedKey = 'auth_is_authenticated';

  /// Public so other startup code (see main.dart's
  /// _loadPermissionSession) can read the exact same key rather than
  /// duplicating this string literal.
  static const mobileKey = 'auth_mobile_number';

  /// Public so main.dart's own _syncFirebaseAuthState() can check it.
  /// Set whenever the user deliberately taps Logout - even though
  /// signOut() below always clears the local session, FirebaseAuth's
  /// own signOut() call can fail (e.g. genuinely offline) and leave
  /// FirebaseAuth.instance.currentUser non-null. Without this
  /// sentinel, _syncFirebaseAuthState()'s own forward-correction
  /// (recovering a genuinely-still-signed-in user after a startup
  /// killed mid-persist - see that method's own doc comment) would
  /// have no way to tell that case apart from a deliberate logout
  /// whose remote sign-out simply hasn't reached the server yet, and
  /// would silently sign the user back in on a device they explicitly
  /// signed out of.
  static const explicitSignOutKey = 'auth_explicit_sign_out';

  static const _uidKey = 'auth_uid';

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();

      final isAuthenticated = prefs.getBool(authenticatedKey) ?? false;
      final mobileNumber = prefs.getString(mobileKey);
      final uid = prefs.getString(_uidKey);

      state = AuthSessionState(
        isAuthenticated: isAuthenticated,
        mobileNumber: mobileNumber,
        uid: uid,
      );
    } catch (error) {
      // First run, or preferences unavailable - default to signed-out
      // rather than blocking startup on a non-essential read.
      debugPrint('Auth session not loaded at startup: $error');
    }
  }

  /// Called once OtpAuthService.verifyOtp() returns true for a real
  /// backend. Never call this to "log someone in" without a genuine
  /// verified OTP result - that would recreate the fake-login problem
  /// this task exists to remove. [uid] must come from
  /// FirebaseAuth.instance.currentUser?.uid at the call site (see
  /// OtpVerificationScreen) - never fabricated here.
  Future<void> markAuthenticated(String mobileNumber, {String? uid}) async {
    state = AuthSessionState(
      isAuthenticated: true,
      mobileNumber: mobileNumber,
      uid: uid,
    );
    AuthScope.set(true);
    PermissionService.currentMobileNumberOverride = mobileNumber;
    PermissionService.invalidateCache();
    await SuperAdminScope.refresh();

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(authenticatedKey, true);
      await prefs.setString(mobileKey, mobileNumber);
      if (uid != null) {
        await prefs.setString(_uidKey, uid);
      }
      // A fresh, genuine sign-in always supersedes any earlier logout.
      await prefs.remove(explicitSignOutKey);
    } catch (error) {
      // The in-memory state above already updated the UI; failing to
      // persist just means the session won't survive a restart.
      debugPrint('Failed to persist auth session: $error');
    }
  }

  /// Deletes the current Firebase Auth account and its cloud-synced
  /// company profile - Google Play's own Account Deletion Requirement
  /// (support.google.com/googleplay/android-developer/answer/13327111:
  /// "If your app allows users to create an account from within your
  /// app... it must also allow users to request for their account to
  /// be deleted").
  ///
  /// GENUINELY SAFE SCOPE, DELIBERATELY NARROWER THAN "delete
  /// everything":
  ///   - companies/{uid} Firestore doc: DELETED (this is only ever a
  ///     cloud-sync copy of the local company profile - see
  ///     CompanyFirestoreSyncService's own doc comment - never the
  ///     source of truth).
  ///   - Local SQLite business records (Warehouse Receipt/Bill/
  ///     etc.): NEVER touched here. These stay on the device - the
  ///     same reasoning signOut() itself documents ("Your company,
  ///     customer, storage and billing data stays on this device").
  ///     Deleting a user's Firebase sign-in must not also destroy
  ///     GST-relevant business records that may carry independent
  ///     legal retention requirements.
  ///   - subscriptions/{companyId}: DELIBERATELY NOT WRITTEN HERE.
  ///     SubscriptionRepository.cancel() requires Super Admin
  ///     (_requireSuperAdmin()), and the Firestore Security Rule on
  ///     that collection enforces the identical restriction
  ///     server-side - a normal user's own account cannot write to it
  ///     by design (see firestore.rules's own doc comment on that
  ///     collection). Once the owning Firebase Auth account is
  ///     deleted, nothing can ever sign in as that uid again to
  ///     modify or misuse that document - it becomes permanently
  ///     unreachable, which is a safe outcome on its own, not a gap
  ///     this method needs to additionally close.
  ///
  /// [companyId] is optional - when null (e.g. company profile setup
  /// was never completed), only the Firebase Auth account itself is
  /// deleted.
  ///
  /// Throws [FirebaseAuthException] with code 'requires-recent-login'
  /// if Firebase's own security requirement for a fresh sign-in isn't
  /// met - the caller (DeleteAccountScreen) is expected to catch this
  /// specific code and prompt the user to sign in again (re-verify
  /// OTP) before retrying, per Firebase's own documented pattern for
  /// sensitive operations.
  Future<void> deleteAccount({String? companyId}) async {
    final user = FirebaseAuth.instance.currentUser;

    if (user == null) {
      // Nothing genuinely signed in to delete - clear local state and
      // return, matching signOut()'s own tolerance for this case
      // rather than throwing on an already-signed-out session.
      await signOut();
      return;
    }

    if (companyId != null && companyId.isNotEmpty) {
      try {
        // The document cloud backup lives under this same
        // companies/{uid} doc - wipe those subcollections FIRST,
        // while the user is still signed in (the Security Rule only
        // lets the owner write under their own uid). Best-effort by
        // design, same as the profile-doc delete below.
        await DocumentCloudSyncService.instance.wipeCloudBackup();

        await FirebaseFirestore.instance
            .collection('companies')
            .doc(user.uid)
            .delete()
            .timeout(const Duration(seconds: 8));
      } catch (error) {
        // A failed cloud-doc delete must not block the user from
        // genuinely deleting their own Auth account - the Firestore
        // Security Rule (request.auth.uid == uid) already means no
        // one else could ever read/write this orphaned doc anyway,
        // and re-running deleteAccount() after fixing connectivity
        // will simply retry this step.
        debugPrint('Failed to delete company cloud doc: $error');
      }
    }

    // Deletes the actual Firebase Auth account - this is the
    // genuinely destructive, unrecoverable step Google's policy
    // requires. Lets 'requires-recent-login' propagate to the caller
    // (see this method's own doc comment) rather than swallowing it.
    await user.delete();

    await signOut();
  }

  /// Clears the session. Never touches company/customer/storage/billing
  /// data - this only affects whether the login screen is shown again.
  Future<void> signOut() async {
    // Firebase's own session is the actual source of truth for
    // authentication (see this class's own doc comment) - sign out of
    // it first. Wrapped separately so a failure here (e.g. genuinely
    // offline) never blocks the local session below from clearing;
    // the user must always be able to sign out of this device.
    try {
      await FirebaseAuth.instance.signOut();
    } catch (error) {
      debugPrint('Firebase sign-out failed: $error');
    }

    state = const AuthSessionState();
    AuthScope.clear();
    PermissionService.currentMobileNumberOverride = null;
    PermissionService.invalidateCache();
    SuperAdminScope.clear();

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(authenticatedKey);
      await prefs.remove(mobileKey);
      await prefs.remove(_uidKey);
      // Recorded even though FirebaseAuth.instance.signOut() was just
      // attempted above - if that call failed (e.g. offline) and left
      // currentUser non-null, this is what stops main.dart's startup
      // sync from treating that as "still signed in" and reversing
      // this logout on next launch.
      await prefs.setBool(explicitSignOutKey, true);
    } catch (error) {
      debugPrint('Failed to clear auth session: $error');
    }
  }
}

final authSessionProvider =
    StateNotifierProvider<AuthSessionNotifier, AuthSessionState>(
  (ref) => AuthSessionNotifier(),
);
