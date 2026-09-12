import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/widgets/primary_button.dart';
import '../../app/widgets/primary_textfield.dart';
import 'services/otp_auth_service.dart';

/// Mobile-number entry - the first step of the mobile + OTP sign-in flow.
///
/// No password field: this task's requirement is mobile number + OTP only,
/// with no password-based login at all.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();

  final TextEditingController _mobileController = TextEditingController();

  final OtpAuthService _authService = activeOtpAuthService;

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

      if (!opened && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open Privacy Policy.')),
        );
      }
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open Privacy Policy.')),
        );
      }
    }
  }

  Future<void> _sendOtp() async {
    if (_sending) return;
    if (!_formKey.currentState!.validate()) return;

    setState(() => _sending = true);

    final mobileNumber = _mobileController.text.trim();

    try {
      final verificationHandle = await _authService.sendOtp(mobileNumber);

      if (!mounted) return;

      context.push(
        '/verify-otp',
        extra: {
          'mobileNumber': mobileNumber,
          'verificationHandle': verificationHandle,
        },
      );
    } catch (error) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not send OTP: $error')),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
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

                PrimaryTextField(
                  controller: _mobileController,
                  label: 'Mobile Number',
                  prefixIcon: Icons.phone,
                  keyboardType: TextInputType.phone,
                  textInputAction: TextInputAction.done,
                  enabled: !_sending,
                  validator: (value) {
                    final trimmed = value?.trim() ?? '';

                    if (trimmed.isEmpty) {
                      return 'Enter mobile number';
                    }

                    if (!RegExp(r'^[6-9]\d{9}$').hasMatch(trimmed)) {
                      return 'Enter a valid 10-digit Indian mobile number';
                    }

                    return null;
                  },
                ),

                const SizedBox(height: 8),

                const Text(
                  '+91 will be used as the country code.',
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

                const Center(
                  child: Text(
                    'Version 1.0.0',
                    style: TextStyle(color: Colors.grey),
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
