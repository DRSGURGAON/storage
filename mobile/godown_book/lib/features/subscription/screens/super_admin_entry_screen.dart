import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/subscription/super_admin_scope.dart';

/// Where a signed-in user lands when they look for Super Admin access.
/// Reachable only by explicitly navigating to /super-admin-setup.
///
/// There is nothing to set up from a phone: Super Admin access is the
/// custom claim `role: superadmin` on the Firebase account, granted by
/// the platform operator with the Admin SDK (tool/admin/
/// set-superadmin.js) and checked by the Firestore rules. This screen
/// either opens the dashboard for someone who holds it, or explains
/// how it is obtained. A freshly granted claim is picked up at the
/// next sign-in.
class SuperAdminEntryScreen extends StatefulWidget {
  const SuperAdminEntryScreen({super.key});

  @override
  State<SuperAdminEntryScreen> createState() => _SuperAdminEntryScreenState();
}

class _SuperAdminEntryScreenState extends State<SuperAdminEntryScreen> {
  bool _loading = true;
  bool _isSuperAdmin = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    await SuperAdminScope.refresh();
    if (!mounted) return;
    setState(() {
      _isSuperAdmin = SuperAdminScope.isSuperAdmin;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Super Admin Access')),
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
            'You have Super Admin access.',
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

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.lock_outline, size: 56),
        const SizedBox(height: 16),
        Text(
          'This account is not a Super Admin.',
          style: Theme.of(context).textTheme.titleMedium,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        const Text(
          'Super Admin access is granted by the platform operator, not '
          'from the app. If access has just been granted to this number, '
          'sign out and sign in again.',
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}
