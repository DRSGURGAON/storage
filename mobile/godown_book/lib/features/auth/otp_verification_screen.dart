import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_session.dart';
import 'services/otp_auth_service.dart';

/// 6-digit OTP entry, with resend + countdown, following the mobile
/// number entered on LoginScreen. Every OTP genuinely goes through
/// Firebase Phone Authentication (see otp_auth_service.dart) - there
/// is no development/demo bypass anywhere in this screen.
class OtpVerificationScreen extends ConsumerStatefulWidget {
  final String mobileNumber;
  final String verificationHandle;

  const OtpVerificationScreen({
    super.key,
    required this.mobileNumber,
    required this.verificationHandle,
  });

  @override
  ConsumerState<OtpVerificationScreen> createState() =>
      _OtpVerificationScreenState();
}

class _OtpVerificationScreenState
    extends ConsumerState<OtpVerificationScreen> {
  static const _resendCooldownSeconds = 30;

  final _otpController = TextEditingController();

  final OtpAuthService _authService = activeOtpAuthService;

  late String _verificationHandle;

  bool _verifying = false;
  bool _resending = false;
  String? _errorText;

  Timer? _resendTimer;
  int _secondsUntilResend = _resendCooldownSeconds;

  @override
  void initState() {
    super.initState();
    _verificationHandle = widget.verificationHandle;
    _startResendCountdown();
  }

  @override
  void dispose() {
    _otpController.dispose();
    _resendTimer?.cancel();
    super.dispose();
  }

  void _startResendCountdown() {
    _secondsUntilResend = _resendCooldownSeconds;

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

  Future<void> _verifyOtp() async {
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
      final verified = await _authService.verifyOtp(
        verificationHandle: _verificationHandle,
        otp: otp,
      );

      if (!mounted) return;

      if (!verified) {
        setState(() {
          _verifying = false;
          _errorText = 'Incorrect OTP. Please try again.';
        });
        return;
      }

      // Only reachable once Firebase's own servers have confirmed the
      // code - never call this on an assumed/local match. The uid
      // comes from FirebaseAuth's own current session (set by
      // FirebasePhoneAuthService.verifyOtp()'s signInWithCredential()
      // call above) - this is the ONLY place in the app that marks a
      // session authenticated, and it only runs after a genuine
      // Firebase-verified sign-in.
      await ref
          .read(authSessionProvider.notifier)
          .markAuthenticated(
            widget.mobileNumber,
            uid: FirebaseAuth.instance.currentUser?.uid,
          );

      if (!mounted) return;

      context.go('/dashboard');
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _verifying = false;
        _errorText = 'Could not verify OTP: $error';
      });
    }
  }

  Future<void> _resendOtp() async {
    if (_resending || _secondsUntilResend > 0) return;

    setState(() {
      _resending = true;
      _errorText = null;
    });

    try {
      final handle = await _authService.sendOtp(widget.mobileNumber);

      if (!mounted) return;

      setState(() {
        _verificationHandle = handle;
        _resending = false;
      });

      _startResendCountdown();

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('OTP resent.')),
      );
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _resending = false;
        _errorText = 'Could not resend OTP: $error';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final canResend = _secondsUntilResend == 0 && !_resending;

    return Scaffold(
      appBar: AppBar(title: const Text('Verify OTP')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 20),

              Text(
                'Enter the 6-digit code sent to +91 ${widget.mobileNumber}',
                style: const TextStyle(fontSize: 16),
                textAlign: TextAlign.center,
              ),

              const SizedBox(height: 30),

              TextField(
                controller: _otpController,
                keyboardType: TextInputType.number,
                textAlign: TextAlign.center,
                maxLength: 6,
                enabled: !_verifying,
                style: const TextStyle(fontSize: 24, letterSpacing: 8),
                decoration: InputDecoration(
                  counterText: '',
                  border: const OutlineInputBorder(),
                  errorText: _errorText,
                ),
                onChanged: (_) {
                  if (_errorText != null) setState(() => _errorText = null);
                },
              ),

              const SizedBox(height: 24),

              SizedBox(
                height: 54,
                child: ElevatedButton(
                  onPressed: _verifying ? null : _verifyOtp,
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
                        child: _resending
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Text('Resend OTP'),
                      )
                    : Text(
                        'Resend OTP in $_secondsUntilResend s',
                        style: const TextStyle(color: Colors.grey),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
