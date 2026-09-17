import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import 'otp_auth_service.dart';

/// Real Firebase Phone Authentication behind the [OtpAuthService]
/// interface the screens use.
///
/// [sendOtp] bridges FirebaseAuth.verifyPhoneNumber's callbacks into a
/// Future: it completes on codeSent with the verification id and the
/// resend token, or straight away when Firebase verifies the number
/// without a code. An auto verification that arrives after codeSent
/// (the usual Android order) signs the user in and is reported on the
/// request, so the OTP screen can leave. A request that gets no answer
/// at all fails after [overallTimeout] as a network problem rather
/// than hanging. [verifyOtp] is the only path to a signed-in Firebase
/// user: a real credential from Firebase's verification id and the
/// typed code, checked by signInWithCredential.
class FirebasePhoneAuthService implements OtpAuthService {
  const FirebasePhoneAuthService();

  /// Firebase's own SMS auto-retrieval window.
  static const Duration autoRetrievalWindow = Duration(seconds: 60);

  /// The longest a sendOtp call is allowed to wait for codeSent.
  static const Duration overallTimeout = Duration(seconds: 90);

  @override
  Future<OtpRequest> sendOtp(String mobileNumber, {int? resendToken}) async {
    final completer = Completer<OtpRequest>();
    final autoVerification = Completer<bool>();

    try {
      await FirebaseAuth.instance.verifyPhoneNumber(
        phoneNumber: '+91$mobileNumber',
        forceResendingToken: resendToken,
        timeout: autoRetrievalWindow,

        // Instant verification, or SMS auto-retrieval. Firebase already
        // holds a verified credential: sign in with it. If the code was
        // not sent yet the caller learns the user is in; if it was, the
        // OTP screen is told through the request it is holding.
        verificationCompleted: (PhoneAuthCredential credential) async {
          try {
            await FirebaseAuth.instance.signInWithCredential(credential);
            final signedIn = FirebaseAuth.instance.currentUser != null;
            if (!completer.isCompleted) {
              completer.complete(OtpRequest(
                verificationId: '',
                signedInImmediately: signedIn,
                autoVerification: autoVerification,
              ));
            } else {
              autoVerification.complete(signedIn);
            }
          } on FirebaseAuthException catch (error) {
            if (!completer.isCompleted) {
              completer.completeError(_failure(error));
            } else if (!autoVerification.isCompleted) {
              // The typed code can still work; the screen stays.
              autoVerification.complete(false);
            }
          } catch (error) {
            debugPrint('Auto verification sign-in failed: $error');
            if (!completer.isCompleted) {
              completer.completeError(const AuthFailure(AuthFailureKind.unknown));
            } else if (!autoVerification.isCompleted) {
              autoVerification.complete(false);
            }
          }
        },

        verificationFailed: (FirebaseAuthException error) {
          if (!completer.isCompleted) {
            completer.completeError(_failure(error));
          }
        },

        codeSent: (String verificationId, int? token) {
          if (!completer.isCompleted) {
            completer.complete(OtpRequest(
              verificationId: verificationId,
              resendToken: token,
              autoVerification: autoVerification,
            ));
          }
        },

        codeAutoRetrievalTimeout: (String verificationId) {
          // The window closed without a verified credential: the user
          // types the code. Nothing to do if it already completed.
          if (!autoVerification.isCompleted) autoVerification.complete(false);
        },
      );
    } on FirebaseAuthException catch (error) {
      throw _failure(error);
    } catch (error) {
      debugPrint('verifyPhoneNumber failed to start: $error');
      throw const AuthFailure(AuthFailureKind.unknown);
    }

    return completer.future.timeout(
      overallTimeout,
      onTimeout: () => throw const AuthFailure(AuthFailureKind.network),
    );
  }

  @override
  Future<bool> verifyOtp({
    required OtpRequest request,
    required String otp,
  }) async {
    // Firebase verified the number itself; there is no code to check.
    if (request.signedInImmediately) {
      return FirebaseAuth.instance.currentUser != null;
    }

    try {
      final credential = PhoneAuthProvider.credential(
        verificationId: request.verificationId,
        smsCode: otp,
      );
      final userCredential =
          await FirebaseAuth.instance.signInWithCredential(credential);
      return userCredential.user != null;
    } on FirebaseAuthException catch (error) {
      final failure = _failure(error);
      if (failure.kind == AuthFailureKind.invalidCode) return false;
      throw failure;
    } catch (error) {
      debugPrint('signInWithCredential failed: $error');
      throw const AuthFailure(AuthFailureKind.unknown);
    }
  }

  /// Completes a re-authentication started by [sendOtp] - used when a
  /// sensitive operation (account deletion) has thrown Firebase's own
  /// 'requires-recent-login'. Same SMS, but reauthenticateWithCredential
  /// refreshes the current session instead of starting a new one.
  Future<bool> reauthenticateWithOtp({
    required OtpRequest request,
    required String otp,
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return false;

    try {
      final credential = PhoneAuthProvider.credential(
        verificationId: request.verificationId,
        smsCode: otp,
      );
      await user.reauthenticateWithCredential(credential);
      return true;
    } on FirebaseAuthException catch (error) {
      final failure = _failure(error);
      if (failure.kind == AuthFailureKind.invalidCode) return false;
      throw failure;
    }
  }

  /// One place where a Firebase failure becomes ours. It keeps the
  /// provider's code so a screen can print it, and logs the whole
  /// exception, because a sign-in that fails for a reason nobody can
  /// see is the hardest kind of bug to answer a customer about.
  static AuthFailure _failure(FirebaseAuthException error) {
    debugPrint(
      'Phone auth failed: code=${error.code} message=${error.message}',
    );
    return AuthFailure(mapFirebaseCode(error.code), code: error.code);
  }

  /// Firebase's error codes, grouped by what the user can do about
  /// them. Anything not listed is "unknown" - a fixed sentence, never
  /// the provider's text.
  @visibleForTesting
  static AuthFailureKind mapFirebaseCode(String code) => switch (code) {
        'invalid-phone-number' ||
        'missing-phone-number' =>
          AuthFailureKind.invalidNumber,
        'invalid-verification-code' => AuthFailureKind.invalidCode,
        'session-expired' ||
        'invalid-verification-id' ||
        'code-expired' =>
          AuthFailureKind.expiredCode,
        'too-many-requests' || 'quota-exceeded' => AuthFailureKind.tooManyRequests,
        'network-request-failed' || 'timeout' => AuthFailureKind.network,
        'app-not-authorized' ||
        'missing-client-identifier' ||
        'invalid-app-credential' ||
        'captcha-check-failed' ||
        'app-check-token-invalid' =>
          AuthFailureKind.appNotAuthorised,
        'web-context-cancelled' ||
        'web-context-already-presented' ||
        'cancelled' ||
        'user-cancelled' =>
          AuthFailureKind.cancelled,
        _ => AuthFailureKind.unknown,
      };
}
