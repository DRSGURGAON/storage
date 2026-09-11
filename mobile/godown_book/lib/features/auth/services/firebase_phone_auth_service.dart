import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';

import 'otp_auth_service.dart';

/// Real Firebase Phone Authentication - implements the same
/// [OtpAuthService] interface the rest of this app already depends on
/// (LoginScreen, OtpVerificationScreen), so no screen needed to change
/// to plug this in; only [activeOtpAuthService]'s own selection logic
/// (see otp_auth_service.dart) needed to change.
///
/// [sendOtp] bridges FirebaseAuth.verifyPhoneNumber's callback-based API
/// (codeSent/verificationFailed/verificationCompleted) into the
/// `Future<String>`-returning shape [OtpAuthService] already expects,
/// using a Completer - the callbacks fire asynchronously and
/// exactly-once for a given call, which is exactly what a Completer is
/// for. [verifyOtp] builds a real PhoneAuthCredential from Firebase's
/// own verificationId + the user-entered code and calls
/// signInWithCredential - the ONLY path through this class that
/// results in a signed-in FirebaseAuth.instance.currentUser (a genuine
/// Firebase UID), never a locally-fabricated one.
class FirebasePhoneAuthService implements OtpAuthService {
  const FirebasePhoneAuthService();

  @override
  Future<String> sendOtp(String mobileNumber) async {
    final completer = Completer<String>();

    await FirebaseAuth.instance.verifyPhoneNumber(
      phoneNumber: '+91$mobileNumber',

      // Some Android devices can auto-detect and verify the SMS
      // without the user typing anything (Google Play services
      // SMS Retriever / instant validation). When that happens,
      // Firebase already has a fully-formed, already-verified
      // credential - sign in immediately rather than making the user
      // wait for a code that was already confirmed.
      verificationCompleted: (PhoneAuthCredential credential) async {
        if (!completer.isCompleted) {
          try {
            await FirebaseAuth.instance.signInWithCredential(credential);
            // Signal the caller with a sentinel verificationId - the
            // OTP screen's own verifyOtp() call becomes a no-op
            // because FirebaseAuth.instance.currentUser is already
            // set at this point (see FirebasePhoneAuthService.verifyOtp's
            // own doc comment for how it handles this case).
            completer.complete('auto-verified');
          } catch (error) {
            completer.completeError(error);
          }
        }
      },

      verificationFailed: (FirebaseAuthException error) {
        if (!completer.isCompleted) {
          completer.completeError(
            _FirebaseOtpException(_readableAuthError(error)),
          );
        }
      },

      codeSent: (String verificationId, int? resendToken) {
        if (!completer.isCompleted) {
          completer.complete(verificationId);
        }
      },

      codeAutoRetrievalTimeout: (String verificationId) {
        // Firebase's own auto-retrieval window closed without a
        // result - the codeSent callback above should already have
        // fired by this point in the normal case, so this is a no-op
        // unless something upstream never called codeSent at all, in
        // which case the completer is still safely guarded by
        // isCompleted.
      },

      timeout: const Duration(seconds: 60),
    );

    return completer.future;
  }

  @override
  Future<bool> verifyOtp({
    required String verificationHandle,
    required String otp,
  }) async {
    // The verificationCompleted callback in sendOtp() already signed
    // the user in via Google Play services' instant SMS
    // auto-verification - FirebaseAuth.instance.currentUser is
    // already genuinely set, so there's no code left to check.
    if (verificationHandle == 'auto-verified') {
      return FirebaseAuth.instance.currentUser != null;
    }

    try {
      final credential = PhoneAuthProvider.credential(
        verificationId: verificationHandle,
        smsCode: otp,
      );

      final userCredential =
          await FirebaseAuth.instance.signInWithCredential(credential);

      // A genuine, server-verified sign-in always has a non-null user
      // at this point - returning true only when that's the case
      // keeps this consistent with OtpAuthService's own contract
      // ("Returns true only if a real backend confirms the code").
      return userCredential.user != null;
    } on FirebaseAuthException catch (error) {
      if (error.code == 'invalid-verification-code' ||
          error.code == 'invalid-verification-id') {
        return false;
      }

      throw _FirebaseOtpException(_readableAuthError(error));
    }
  }

  /// Completes a re-authentication started by [sendOtp] - used when a
  /// sensitive operation (account deletion) has thrown Firebase's own
  /// 'requires-recent-login' FirebaseAuthException. The SMS dispatch
  /// itself is identical to a normal sign-in (same [sendOtp] call),
  /// only this final step differs: reauthenticateWithCredential()
  /// refreshes the current session's credentials rather than starting
  /// a new one, matching Firebase's own documented pattern
  /// (firebase.google.com/docs/auth/flutter/manage-users).
  Future<bool> reauthenticateWithOtp({
    required String verificationHandle,
    required String otp,
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return false;

    try {
      final credential = PhoneAuthProvider.credential(
        verificationId: verificationHandle,
        smsCode: otp,
      );

      await user.reauthenticateWithCredential(credential);
      return true;
    } on FirebaseAuthException catch (error) {
      if (error.code == 'invalid-verification-code' ||
          error.code == 'invalid-verification-id') {
        return false;
      }

      throw _FirebaseOtpException(_readableAuthError(error));
    }
  }

  String _readableAuthError(FirebaseAuthException error) {
    switch (error.code) {
      case 'invalid-phone-number':
        return 'That phone number is not valid.';
      case 'too-many-requests':
        return 'Too many attempts. Please try again later.';
      case 'quota-exceeded':
        return 'SMS quota exceeded for this project. Try again later.';
      case 'network-request-failed':
        return 'Network error. Check your connection and try again.';
      default:
        return error.message ?? 'Could not verify phone number.';
    }
  }
}

/// Wraps a FirebaseAuthException's readable message so callers of
/// [OtpAuthService] (which only know about generic exceptions, not
/// Firebase-specific ones) still get a sensible message via toString(),
/// without this file leaking FirebaseAuthException into the interface
/// itself.
class _FirebaseOtpException implements Exception {
  final String message;
  const _FirebaseOtpException(this.message);

  @override
  String toString() => message;
}
