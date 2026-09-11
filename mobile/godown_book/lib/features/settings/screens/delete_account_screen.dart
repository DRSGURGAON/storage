import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_session.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../../auth/services/firebase_phone_auth_service.dart';
import '../../auth/services/otp_auth_service.dart';

/// Google Play's own Account Deletion Requirement
/// (support.google.com/googleplay/android-developer/answer/13327111):
/// an app that allows account creation must provide an in-app path to
/// delete that account.
///
/// GENUINE SCOPE - see AuthSessionNotifier.deleteAccount()'s own doc
/// comment for the full reasoning: deletes the Firebase Auth account
/// and its cloud-synced company profile; deliberately leaves local
/// SQLite business records (Warehouse Receipts/Bills/etc.) untouched on
/// the device, and deliberately does not attempt to write to
/// subscriptions/{companyId} (that write is Super-Admin-only by
/// design, both in code and in the Firestore Security Rule).
class DeleteAccountScreen extends ConsumerStatefulWidget {
  const DeleteAccountScreen({super.key});

  @override
  ConsumerState<DeleteAccountScreen> createState() =>
      _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends ConsumerState<DeleteAccountScreen> {
  bool _understood = false;
  bool _working = false;

  // Re-authentication state - only populated if Firebase genuinely
  // throws 'requires-recent-login' when delete is first attempted.
  bool _needsReauth = false;
  String? _reauthVerificationHandle;
  final _otpController = TextEditingController();
  String? _reauthError;

  @override
  void dispose() {
    _otpController.dispose();
    super.dispose();
  }

  Future<void> _confirmDelete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete your account?'),
        content: const Text(
          'This will permanently delete your sign-in account and cannot '
          'be undone. Your business documents (Warehouse Receipts, '
          'Bills, Receipts, etc.) will remain on this device, but you '
          'will no longer be able to sign in to access them.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Delete Account'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    await _performDelete();
  }

  Future<void> _performDelete() async {
    setState(() {
      _working = true;
      _reauthError = null;
    });

    try {
      await ref.read(authSessionProvider.notifier).deleteAccount(
            companyId: TenantScope.companyIdOrNull,
          );

      if (!mounted) return;

      context.go('/login');
    } on FirebaseAuthException catch (error) {
      if (!mounted) return;

      if (error.code == 'requires-recent-login') {
        // Firebase's own documented sensitive-operation requirement -
        // start the re-authentication flow rather than failing
        // outright. See AuthSessionNotifier.deleteAccount()'s own doc
        // comment for why this is expected here.
        await _startReauth();
        return;
      }

      setState(() {
        _working = false;
        _reauthError = 'Could not delete account: ${error.message}';
      });
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _working = false;
        _reauthError = 'Could not delete account: $error';
      });
    }
  }

  Future<void> _startReauth() async {
    final mobileNumber =
        ref.read(authSessionProvider).mobileNumber ?? '';

    if (mobileNumber.isEmpty) {
      setState(() {
        _working = false;
        _reauthError =
            'Could not determine your mobile number to re-verify.';
      });
      return;
    }

    try {
      final handle = await activeOtpAuthService.sendOtp(mobileNumber);

      if (!mounted) return;

      setState(() {
        _needsReauth = true;
        _reauthVerificationHandle = handle;
        _working = false;
      });
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _working = false;
        _reauthError = 'Could not send verification code: $error';
      });
    }
  }

  Future<void> _submitReauthAndDelete() async {
    final otp = _otpController.text.trim();
    final handle = _reauthVerificationHandle;

    if (otp.length != 6 || handle == null) {
      setState(() => _reauthError = 'Enter the 6-digit code');
      return;
    }

    setState(() {
      _working = true;
      _reauthError = null;
    });

    try {
      // reauthenticateWithOtp is specific to the delete-account flow
      // (see FirebasePhoneAuthService's own doc comment on it) and
      // deliberately not part of the general OtpAuthService interface
      // every other screen uses - explicit cast, since
      // FirebasePhoneAuthService is genuinely this app's only,
      // permanent OtpAuthService implementation (see
      // otp_auth_service.dart's own "LOCKED ARCHITECTURE DECISION"
      // doc comment).
      final service = activeOtpAuthService as FirebasePhoneAuthService;

      final verified = await service.reauthenticateWithOtp(
        verificationHandle: handle,
        otp: otp,
      );

      if (!mounted) return;

      if (!verified) {
        setState(() {
          _working = false;
          _reauthError = 'Incorrect code. Please try again.';
        });
        return;
      }

      // Re-authenticated - retry the actual delete, which should now
      // succeed since Firebase's own session is fresh again.
      await _performDelete();
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _working = false;
        _reauthError = 'Could not verify code: $error';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Delete Account')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: _needsReauth ? _reauthView() : _confirmationView(),
        ),
      ),
    );
  }

  Widget _confirmationView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.warning_amber_rounded, color: Colors.red, size: 48),
        const SizedBox(height: 16),
        const Text(
          'This action is permanent',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        const Text(
          'Deleting your account will:',
          style: TextStyle(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        const _Bullet('Permanently delete your sign-in (mobile number + OTP) account'),
        const _Bullet(
          'Remove your cloud-synced company profile and cloud document '
          'backup',
        ),
        const SizedBox(height: 12),
        const Text(
          'What stays on this device:',
          style: TextStyle(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        const _Bullet(
          'Your Warehouse Receipts, Bills, Receipts and other business '
          'documents remain on this device, but you will no longer be '
          'able to sign in to access or edit them from this app.',
        ),
        const SizedBox(height: 24),
        CheckboxListTile(
          value: _understood,
          onChanged: (v) => setState(() => _understood = v ?? false),
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: EdgeInsets.zero,
          title: const Text('I understand this cannot be undone.'),
        ),
        if (_reauthError != null) ...[
          const SizedBox(height: 8),
          Text(_reauthError!, style: const TextStyle(color: Colors.red)),
        ],
        const SizedBox(height: 16),
        SizedBox(
          height: 50,
          child: FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: (_understood && !_working) ? _confirmDelete : null,
            child: _working
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('Delete My Account'),
          ),
        ),
      ],
    );
  }

  Widget _reauthView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.security, size: 48),
        const SizedBox(height: 16),
        const Text(
          'Please verify it\'s you',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        const Text(
          'For your security, deleting your account requires a fresh '
          'verification. Enter the 6-digit code we just sent you.',
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 24),
        TextField(
          controller: _otpController,
          keyboardType: TextInputType.number,
          textAlign: TextAlign.center,
          maxLength: 6,
          enabled: !_working,
          style: const TextStyle(fontSize: 24, letterSpacing: 8),
          decoration: InputDecoration(
            counterText: '',
            border: const OutlineInputBorder(),
            errorText: _reauthError,
          ),
        ),
        const SizedBox(height: 16),
        SizedBox(
          height: 50,
          child: FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: _working ? null : _submitReauthAndDelete,
            child: _working
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('Verify & Delete Account'),
          ),
        ),
      ],
    );
  }
}

class _Bullet extends StatelessWidget {
  final String text;
  const _Bullet(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('•  '),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}
