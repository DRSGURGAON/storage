import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/permissions/permission_service.dart';
import '../../../core/subscription/super_admin_scope.dart';
import '../repositories/super_admin_repository.dart';

/// The one place this app offers to become the platform's Super Admin,
/// or (if one already exists on this install) confirms access is
/// denied. Deliberately not linked from anywhere prominent in the main
/// navigation - reachable only by explicitly navigating to
/// /super-admin-setup (e.g. typed directly, or a support-provided
/// link), matching the task's own caution that
/// bootstrapFirstSuperAdmin() "must be carefully secured... a one-time
/// setup flow, not reachable from normal navigation".
///
/// Genuinely a one-time action: once ANY Super Admin exists on this
/// install (bootstrapped here or added via SuperAdminRepository.add()
/// by an existing admin), this screen permanently switches to a plain
/// "access denied" state - see canBootstrap()'s own doc comment.
class SuperAdminEntryScreen extends StatefulWidget {
  const SuperAdminEntryScreen({super.key});

  @override
  State<SuperAdminEntryScreen> createState() => _SuperAdminEntryScreenState();
}

class _SuperAdminEntryScreenState extends State<SuperAdminEntryScreen> {
  bool _loading = true;
  bool _canBootstrap = false;
  bool _isSuperAdmin = false;
  bool _submitting = false;

  final _nameController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    await SuperAdminScope.refresh();
    final canBootstrap = await SuperAdminRepository.instance.canBootstrap();

    if (!mounted) return;

    setState(() {
      _isSuperAdmin = SuperAdminScope.isSuperAdmin;
      _canBootstrap = canBootstrap;
      _loading = false;
    });
  }

  Future<void> _bootstrap() async {
    if (_submitting) return;

    final mobileNumber = PermissionService.currentMobileNumberOverride;

    if (mobileNumber == null || mobileNumber.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('You must be signed in to continue.')),
      );
      return;
    }

    setState(() => _submitting = true);

    try {
      await SuperAdminRepository.instance.bootstrapFirstSuperAdmin(
        mobileNumber: mobileNumber,
        name: _nameController.text.trim(),
      );

      await SuperAdminScope.refresh();

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Super Admin access granted.')),
      );

      context.go('/super-admin');
    } catch (e) {
      if (!mounted) return;

      setState(() => _submitting = false);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Super Admin Setup')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Center(
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: _buildContent(context),
              ),
            ),
    );
  }

  Widget _buildContent(BuildContext context) {
    if (_isSuperAdmin) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.verified_user, size: 56, color: Colors.green),
          const SizedBox(height: 16),
          Text(
            'You already have Super Admin access.',
            style: Theme.of(context).textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton(
              onPressed: () => context.go('/super-admin'),
              child: const Text('Open Super Admin Dashboard'),
            ),
          ),
        ],
      );
    }

    if (!_canBootstrap) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.lock_outline, size: 56),
          const SizedBox(height: 16),
          Text(
            'A Super Admin already exists for this install. If you '
            'need access, ask an existing Super Admin to add your '
            'mobile number from Settings.',
            style: Theme.of(context).textTheme.bodyMedium,
            textAlign: TextAlign.center,
          ),
        ],
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.admin_panel_settings_outlined, size: 56),
        const SizedBox(height: 16),
        Text(
          'No Super Admin exists on this install yet.',
          style: Theme.of(context).textTheme.titleMedium,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        const Text(
          'Continuing will make your currently signed-in mobile number '
          'the Super Admin - the only account able to verify payments, '
          'configure plans, and manage subscriptions across this '
          'install. This can only be done once.',
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.amber.shade50,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: Colors.amber.shade200),
          ),
          child: const Text(
            'One-time setup note: the very first Super Admin document '
            'must exist in Firestore before this button will work - '
            'the app\'s own Security Rules deliberately require it '
            '(Firestore has no safe way to verify "nobody has done '
            'this yet" on its own). If this fails, create it once, '
            'manually, in the Firebase Console: Firestore Database -> '
            'Data -> Start collection "superAdmins" -> document ID = '
            'your own signed-in account\'s Firebase Auth uid -> fields '
            'mobileNumber, name, isActive (true), createdAt.',
            style: TextStyle(fontSize: 12),
          ),
        ),
        const SizedBox(height: 20),
        TextField(
          controller: _nameController,
          decoration: const InputDecoration(labelText: 'Your Name (optional)'),
        ),
        const SizedBox(height: 20),
        SizedBox(
          width: double.infinity,
          height: 48,
          child: FilledButton(
            onPressed: _submitting ? null : _bootstrap,
            child: _submitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Become Super Admin'),
          ),
        ),
      ],
    );
  }
}
