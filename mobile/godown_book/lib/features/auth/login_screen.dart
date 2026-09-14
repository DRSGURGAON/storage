import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/widgets/primary_button.dart';
import '../../core/auth/auth_session.dart';
import '../../core/constants/app_build.dart';
import 'phone_number_input.dart';
import 'services/otp_auth_service.dart';

/// Mobile-number entry - the first step of the mobile + OTP sign-in.
///
/// No password field: sign-in is the mobile number and the code Firebase
/// sends to it, nothing else. The number can be typed or pasted in any
/// of the ways people write it (+91, 91, a leading 0, spaces); the
/// screen keeps the ten digits and shows +91 fixed in front.
class LoginScreen extends ConsumerStatefulWidget {
  /// Injectable for tests; the app always uses Firebase.
  final OtpAuthService? authService;

  const LoginScreen({super.key, this.authService});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final TextEditingController _mobileController = TextEditingController();

  late final OtpAuthService _authService =
      widget.authService ?? activeOtpAuthService;

  bool _sending = false;

  @override
  void dispose() {
    _mobileController.dispose();
    super.dispose();
  }

  static const _privacyPolicyUrl = 'https://godownbook.netlify.app/#legal';

  Future<void> _openPrivacyPolicy(BuildContext context) async {
    final uri = Uri.parse(_privacyPolicyUrl);
    try {
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && context.mounted) _say('Could not open Privacy Policy.');
    } catch (_) {
      if (context.mounted) _say('Could not open Privacy Policy.');
    }
  }

  void _say(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  /// A pasted "+91 98765 43210" becomes "9876543210" in the box, so
  /// what the user sees is exactly what is sent.
  void _onChanged(String value) {
    final normalised = PhoneNumberInput.normalise(value);
    if (normalised != null && normalised != value) {
      _mobileController.value = TextEditingValue(
        text: normalised,
        selection: TextSelection.collapsed(offset: normalised.length),
      );
    }
  }

  Future<void> _sendOtp() async {
    if (_sending) return;
    if (!_formKey.currentState!.validate()) return;

    final mobileNumber = PhoneNumberInput.normalise(_mobileController.text)!;
    setState(() => _sending = true);

    try {
      final request = await _authService.sendOtp(mobileNumber);
      if (!mounted) return;

      // Firebase verified the number without a code: already signed in.
      if (request.signedInImmediately) {
        await _finishSignIn(mobileNumber);
        return;
      }

      context.push(
        '/verify-otp',
        extra: {'mobileNumber': mobileNumber, 'request': request},
      );
    } on AuthFailure catch (failure) {
      if (!mounted) return;
      _say(failure.message);
    } catch (error) {
      if (!mounted) return;
      _say(const AuthFailure(AuthFailureKind.unknown).message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _finishSignIn(String mobileNumber) async {
    String? uid;
    try {
      uid = FirebaseAuth.instance.currentUser?.uid;
    } catch (_) {
      // No Firebase app in a test; the fake service decided the outcome.
    }
    await ref
        .read(authSessionProvider.notifier)
        .markAuthenticated(mobileNumber, uid: uid);
    if (!mounted) return;
    context.go('/dashboard');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 40),
                Center(
                  child: Image.asset('assets/images/app_logo.png', width: 220),
                ),
                const SizedBox(height: 30),
                const Center(
                  child: Text(
                    'Welcome',
                    style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                  ),
                ),
                const SizedBox(height: 8),
                const Center(
                  child: Text(
                    'Enter your mobile number to continue',
                    style: TextStyle(color: Colors.grey, fontSize: 16),
                  ),
                ),
                const SizedBox(height: 40),
                TextFormField(
                  controller: _mobileController,
                  keyboardType: TextInputType.phone,
                  textInputAction: TextInputAction.done,
                  autofillHints: const [AutofillHints.telephoneNumberNational],
                  enabled: !_sending,
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9+\s\-()]')),
                    LengthLimitingTextInputFormatter(18),
                  ],
                  onChanged: _onChanged,
                  onFieldSubmitted: (_) => _sendOtp(),
                  style: const TextStyle(fontSize: 20, letterSpacing: 1.5),
                  decoration: const InputDecoration(
                    labelText: 'Mobile Number',
                    prefixIcon: Icon(Icons.phone),
                    prefixText: '+91 ',
                    hintText: '98765 43210',
                  ),
                  validator: (value) {
                    final raw = value?.trim() ?? '';
                    if (raw.isEmpty) return 'Enter your mobile number';
                    if (PhoneNumberInput.normalise(raw) == null) {
                      return 'Enter a valid 10-digit Indian mobile number';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 8),
                const Text(
                  'We will send a one-time code by SMS to this number.',
                  style: TextStyle(color: Colors.grey, fontSize: 13),
                ),
                const SizedBox(height: 24),
                PrimaryButton(
                  text: 'Send OTP',
                  icon: Icons.sms_outlined,
                  isLoading: _sending,
                  onPressed: _sendOtp,
                ),
                const SizedBox(height: 20),
                Center(
                  child: RichText(
                    textAlign: TextAlign.center,
                    text: TextSpan(
                      style: const TextStyle(fontSize: 12, color: Colors.grey),
                      children: [
                        const TextSpan(text: 'By continuing, you agree to our '),
                        TextSpan(
                          text: 'Privacy Policy',
                          style: const TextStyle(
                            color: Colors.blue,
                            decoration: TextDecoration.underline,
                          ),
                          recognizer: TapGestureRecognizer()
                            ..onTap = () => _openPrivacyPolicy(context),
                        ),
                        const TextSpan(text: '.'),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Center(
                  child: Text(
                    AppBuild.label,
                    style: const TextStyle(color: Colors.grey),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
