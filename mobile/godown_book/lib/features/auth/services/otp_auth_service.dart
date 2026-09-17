import 'dart:async';

import 'firebase_phone_auth_service.dart';

/// The service the login/OTP screens actually use.
///
/// PRODUCTION-ONLY: Firebase Phone Authentication is the sole
/// authentication path for this project - no dev-mode/demo bypass, no
/// fixed/hardcoded OTP, no auto-login exists anywhere in this file (or
/// anywhere else in this app). Every OTP genuinely goes through
/// FirebasePhoneAuthService, which dispatches a real SMS via
/// FirebaseAuth.verifyPhoneNumber() and verifies the code via
/// FirebaseAuth.signInWithCredential() - never a locally-generated or
/// locally-compared code. A Firebase "phone number for testing" set up
/// in the console goes through exactly the same calls; nothing here
/// knows or cares which kind of number it is.
final OtpAuthService activeOtpAuthService = const FirebasePhoneAuthService();

/// Why a sign-in step failed, in terms a screen can act on. Every
/// FirebaseAuthException is mapped onto one of these before it leaves
/// the auth service, so no screen ever shows Firebase's own wording.
enum AuthFailureKind {
  invalidNumber,
  invalidCode,
  expiredCode,
  tooManyRequests,
  network,
  appNotAuthorised,
  cancelled,
  unknown,
}

class AuthFailure implements Exception {
  final AuthFailureKind kind;

  /// The provider's own code, kept only so a failure the user cannot
  /// act on can name itself. Never shown for the everyday failures
  /// (wrong OTP, no network) - those need no reference number, and a
  /// code beside them would only frighten people.
  final String? code;

  const AuthFailure(this.kind, {this.code});

  /// Plain words, fixed per kind - never a raw provider message.
  String get message => switch (kind) {
        AuthFailureKind.invalidNumber =>
          'That mobile number does not look right. Enter your 10-digit number.',
        AuthFailureKind.invalidCode => 'Incorrect OTP. Please check and try again.',
        AuthFailureKind.expiredCode =>
          'This OTP has expired. Tap Resend OTP to get a new one.',
        AuthFailureKind.tooManyRequests =>
          'Too many attempts. Please wait a while and try again.',
        AuthFailureKind.network =>
          'No internet connection. Check your network and try again.',
        AuthFailureKind.appNotAuthorised =>
          'This app is not set up for phone sign-in on this device. '
              'Please update the app or contact support.$_reference',
        AuthFailureKind.cancelled => 'Sign-in was cancelled. Please try again.',
        AuthFailureKind.unknown =>
          'Something went wrong while signing in. Please try again.$_reference',
      };

  /// The two failures nobody on the phone can do anything about are the
  /// two worth reporting, so they carry the provider's code for whoever
  /// picks up the support call.
  String get _reference => code == null || code!.isEmpty ? '' : '\n($code)';

  @override
  String toString() => message;
}

/// One OTP request in flight. Firebase's own verification id and the
/// token that lets a resend go through the same session.
class OtpRequest {
  final String verificationId;
  final int? resendToken;

  /// True when Firebase verified the number by itself before any code
  /// was needed (instant verification): the user is already signed in
  /// and there is no OTP screen to show.
  final bool signedInImmediately;

  final Completer<bool> _autoVerification;

  OtpRequest({
    required this.verificationId,
    this.resendToken,
    this.signedInImmediately = false,
    Completer<bool>? autoVerification,
  }) : _autoVerification = autoVerification ?? Completer<bool>() {
    if (signedInImmediately && !_autoVerification.isCompleted) {
      _autoVerification.complete(true);
    }
  }

  /// Completes true if Firebase auto-verifies the SMS after the code
  /// was sent (the common Android order) - the OTP screen then leaves
  /// on its own. Completes false when the auto-retrieval window closes
  /// without that; the user types the code as usual.
  Future<bool> get autoVerification => _autoVerification.future;

  /// For the service (and test fakes) to report a late auto verification.
  void reportAutoVerification(bool signedIn) {
    if (!_autoVerification.isCompleted) _autoVerification.complete(signedIn);
  }
}

/// Abstraction over whatever sends and verifies the OTP.
///
/// LOCKED ARCHITECTURE DECISION: this project's authentication
/// backend is permanently Firebase Phone Authentication
/// (FirebasePhoneAuthService) - no other provider is to be integrated,
/// and no development/demo bypass of any kind is permitted, in debug or
/// release builds alike. The interface exists so the screens can be
/// tested with a scripted fake, and so they never import firebase_auth
/// themselves.
abstract class OtpAuthService {
  /// Requests an OTP for [mobileNumber] (10 digits, no country code -
  /// the +91 prefix is applied inside). Pass the previous request's
  /// [resendToken] when the user asks for the code again, so Firebase
  /// treats it as a resend rather than a brand-new attempt.
  ///
  /// Throws [AuthFailure]; never a raw provider exception.
  Future<OtpRequest> sendOtp(String mobileNumber, {int? resendToken});

  /// Verifies [otp] against [request]. Returns true only when Firebase's
  /// own servers confirm the code. Returns false for a wrong code, and
  /// throws [AuthFailure] for an expired one or any other failure.
  Future<bool> verifyOtp({required OtpRequest request, required String otp});
}
