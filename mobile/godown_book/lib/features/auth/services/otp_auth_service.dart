import 'firebase_phone_auth_service.dart';

/// The service the login/OTP screens actually use.
///
/// PRODUCTION-ONLY: Firebase Phone Authentication is the sole
/// authentication path for this project - no dev-mode/demo bypass, no
/// fixed/hardcoded OTP, no auto-login exists anywhere in this file (or
/// anywhere else in this app - see the project-wide search performed
/// before this file was written). Every OTP genuinely goes through
/// FirebasePhoneAuthService, which dispatches a real SMS via
/// FirebaseAuth.verifyPhoneNumber() and verifies the code via
/// FirebaseAuth.signInWithCredential() - never a locally-generated or
/// locally-compared code.
final OtpAuthService activeOtpAuthService = const FirebasePhoneAuthService();

/// Abstraction over whatever sends and verifies the OTP.
///
/// LOCKED ARCHITECTURE DECISION: this project's authentication
/// backend is permanently Firebase Phone Authentication
/// (FirebasePhoneAuthService, see that file) - no other provider (SMS
/// gateway, custom backend, etc.) is to be integrated, and no
/// development/demo bypass of any kind is permitted, in debug or
/// release builds alike. A "real" OTP requires actually dispatching
/// an SMS and verifying the code server-side; anything done entirely
/// on-device (generate a code, compare it to what the user typed) is
/// not real authentication.
///
/// [OtpAuthService] exists so the UI (mobile entry, OTP entry, resend,
/// countdown, loading/error states) can be built completely and
/// correctly, with exactly one integration point - [sendOtp] and
/// [verifyOtp] - implemented by [FirebasePhoneAuthService]. The
/// interface itself stays generic (not hardcoding FirebaseAuth types
/// directly into the screens) purely so LoginScreen/
/// OtpVerificationScreen don't need to import firebase_auth
/// themselves - not because another provider is genuinely expected to
/// replace Firebase Phone Auth.
abstract class OtpAuthService {
  /// Requests an OTP be sent to [mobileNumber] (10 digits, no country
  /// code - the +91 prefix is applied by the caller).
  ///
  /// Returns an opaque verification handle the concrete implementation
  /// needs to complete [verifyOtp] (Firebase's own verificationId).
  Future<String> sendOtp(String mobileNumber);

  /// Verifies [otp] against the session started by [sendOtp]'s returned
  /// handle. Returns true only if Firebase's own servers confirm the
  /// code is correct for that phone number.
  Future<bool> verifyOtp({
    required String verificationHandle,
    required String otp,
  });
}
