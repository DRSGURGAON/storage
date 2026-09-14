import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_session.dart';
import '../../core/tenant/tenant_bootstrap.dart';
import 'services/otp_auth_service.dart';

/// 6-digit OTP entry after the number was given on LoginScreen.
///
/// The code is checked the moment the sixth digit is typed. Resend
/// waits out a short cooldown and goes through Firebase's resend
/// token, so it counts as the same attempt. An expired code says so
/// and points at Resend. If Firebase verifies the SMS by itself while
/// this screen is open, it leaves on its own. Every OTP genuinely goes
/// through Firebase (see otp_auth_service.dart); nothing here can
/// sign anyone in on its own.
class OtpVerificationScreen extends ConsumerStatefulWidget {
  final String mobileNumber;
  final OtpRequest request;

  /// Injectable for tests; the app always uses Firebase.
  final OtpAuthService? authService;

  /// Shorter in tests; 30 seconds in the app.
  final Duration resendCooldown;

  const OtpVerificationScreen({
    super.key,
    required this.mobileNumber,
    required this.request,
    this.authService,
    this.resendCooldown = const Duration(seconds: 30),
  });

  @override
  ConsumerState<OtpVerificationScreen> createState() =>
      _OtpVerificationScreenState();
}

class _OtpVerificationScreenState extends ConsumerState<OtpVerificationScreen> {
  final _otpController = TextEditingController();

  late final OtpAuthService _authService =
      widget.authService ?? activeOtpAuthService;

  late OtpRequest _request;

  bool _verifying = false;

  /// True while the account's company is being fetched after the code
  /// was accepted.
  bool _restoring = false;
  bool _resending = false;
  bool _expired = false;
  bool _done = false;
  String? _errorText;

  Timer? _resendTimer;
  int _secondsUntilResend = 0;

  @override
  void initState() {
    super.initState();
    _request = widget.request;
    _startResendCountdown();
    _watchAutoVerification(_request);
  }

  @override
  void dispose() {
    _otpController.dispose();
    _resendTimer?.cancel();
    super.dispose();
  }

  void _startResendCountdown() {
    _secondsUntilResend = widget.resendCooldown.inSeconds;
    _resendTimer?.cancel();
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() {
        if (_secondsUntilResend > 0) {
          _secondsUntilResend--;
        } else {
          timer.cancel();
        }
      });
    });
  }

  /// Firebase may verify the SMS itself after the code was sent; when
  /// it does, the user is already signed in and there is nothing to
  /// type. Only the request currently on screen counts.
  void _watchAutoVerification(OtpRequest request) {
    request.autoVerification.then((signedIn) {
      if (!mounted || !signedIn || _done || !identical(request, _request)) {
        return;
      }
      _finishSignIn();
    });
  }

  Future<void> _verifyOtp() async {
    if (_verifying || _done) return;

    final otp = _otpController.text.trim();
    if (otp.length != 6) {
      setState(() => _errorText = 'Enter the 6-digit code');
      return;
    }

    setState(() {
      _verifying = true;
      _errorText = null;
    });

    try {
      final verified =
          await _authService.verifyOtp(request: _request, otp: otp);
      if (!mounted) return;

      if (!verified) {
        setState(() {
          _verifying = false;
          _errorText = const AuthFailure(AuthFailureKind.invalidCode).message;
        });
        return;
      }

      await _finishSignIn();
    } on AuthFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _verifying = false;
        _expired = failure.kind == AuthFailureKind.expiredCode;
        _errorText = failure.message;
        // An expired code cannot be retried; open Resend at once.
        if (_expired) {
          _resendTimer?.cancel();
          _secondsUntilResend = 0;
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _verifying = false;
        _errorText = const AuthFailure(AuthFailureKind.unknown).message;
      });
    }
  }

  /// Only reachable once Firebase's own servers confirmed the code, or
  /// verified the SMS themselves. The uid is Firebase's; never made up.
  Future<void> _finishSignIn() async {
    if (_done) return;
    _done = true;

    String? uid;
    try {
      uid = FirebaseAuth.instance.currentUser?.uid;
    } catch (_) {
      // No Firebase app in a test; the fake service decided the outcome.
    }

    // The account's own company must be active before the app opens:
    // restored from the cloud on a reinstall or a new phone, kept when
    // it is already on this device, created only when the account has
    // none anywhere. Never guessed while the cloud cannot be reached.
    if (uid != null) {
      final ready = await _establishCompany(uid);
      if (!ready) {
        _done = false;
        if (mounted) setState(() => _verifying = false);
        return;
      }
    }

    await ref
        .read(authSessionProvider.notifier)
        .markAuthenticated(widget.mobileNumber, uid: uid);
    if (!mounted) return;
    context.go('/dashboard');
  }

  /// Runs the company bootstrap, offering Retry until it succeeds or
  /// the user gives up (which leaves them on this screen, signed out
  /// of the app but able to try again).
  Future<bool> _establishCompany(String uid) async {
    while (true) {
      if (mounted) setState(() => _restoring = true);
      final result = await TenantBootstrap.bootstrapAfterLogin(uid);
      if (mounted) setState(() => _restoring = false);
      if (result.succeeded) return true;
      if (!mounted) return false;

      final retry = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Could not check your account'),
          content: Text(
            'Your company details could not be fetched. Check the internet '
            'connection and try again.\n\n${result.error ?? ''}',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
      if (retry != true) return false;
    }
  }

  Future<void> _resendOtp() async {
    if (_resending || _verifying || _secondsUntilResend > 0) return;

    setState(() {
      _resending = true;
      _errorText = null;
    });

    try {
      final request = await _authService.sendOtp(
        widget.mobileNumber,
        resendToken: _request.resendToken,
      );
      if (!mounted) return;

      if (request.signedInImmediately) {
        await _finishSignIn();
        return;
      }

      setState(() {
        _request = request;
        _resending = false;
        _expired = false;
        _otpController.clear();
      });
      _startResendCountdown();
      _watchAutoVerification(request);

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('A new OTP has been sent.')),
      );
    } on AuthFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _resending = false;
        _errorText = failure.message;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _resending = false;
        _errorText = const AuthFailure(AuthFailureKind.unknown).message;
      });
    }
  }

  void _changeNumber() {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    final canResend = _secondsUntilResend == 0 && !_resending && !_verifying;

    return Scaffold(
      appBar: AppBar(title: const Text('Verify OTP')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 20),
              if (_restoring) ...[
                const LinearProgressIndicator(),
                const SizedBox(height: 8),
                const Text(
                  'Code accepted. Fetching your company details...',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
              ],
              Text(
                'Enter the 6-digit code sent to\n+91 ${widget.mobileNumber}',
                style: const TextStyle(fontSize: 16),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Center(
                child: TextButton.icon(
                  onPressed: _verifying ? null : _changeNumber,
                  icon: const Icon(Icons.edit_outlined, size: 18),
                  label: const Text('Change number'),
                ),
              ),
              const SizedBox(height: 22),
              TextField(
                controller: _otpController,
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.done,
                autofocus: true,
                autofillHints: const [AutofillHints.oneTimeCode],
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(6),
                ],
                textAlign: TextAlign.center,
                maxLength: 6,
                enabled: !_verifying && !_expired,
                style: const TextStyle(fontSize: 26, letterSpacing: 10),
                decoration: InputDecoration(
                  counterText: '',
                  border: const OutlineInputBorder(),
                  errorText: _errorText,
                  errorMaxLines: 3,
                ),
                onChanged: (value) {
                  if (_errorText != null) setState(() => _errorText = null);
                  // The sixth digit is the tap on Verify.
                  if (value.length == 6) _verifyOtp();
                },
                onSubmitted: (_) => _verifyOtp(),
              ),
              const SizedBox(height: 24),
              SizedBox(
                height: 54,
                child: ElevatedButton(
                  onPressed: _verifying || _expired ? null : _verifyOtp,
                  child: _verifying
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text(
                          'Verify OTP',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                ),
              ),
              const SizedBox(height: 20),
              Center(
                child: canResend
                    ? TextButton(
                        onPressed: _resendOtp,
                        child: const Text('Resend OTP'),
                      )
                    : _resending
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(
                            'Resend OTP in $_secondsUntilResend s',
                            style: const TextStyle(color: Colors.grey),
                          ),
              ),
              const SizedBox(height: 8),
              const Text(
                'The code usually arrives within a minute. If your phone '
                'reads the SMS by itself, you will be signed in without typing.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey, fontSize: 12),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
