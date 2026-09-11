import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app/theme/theme_provider.dart';
import '../../../core/auth/auth_session.dart';
import '../../../core/subscription/super_admin_scope.dart';

/// App-wide Settings, reachable independently of whether the Company
/// Profile is complete - the dashboard's incomplete-profile banner is a
/// prompt for new installs, not the only way to reach these screens
/// afterwards.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

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

  Future<void> _confirmLogout(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Logout'),
        content: const Text(
          'You will need to verify your mobile number again to sign back '
          'in. Your company, customer, storage and billing data stays on '
          'this device and is not affected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Logout'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    // Clears only the sign-in flag/mobile number - never touches
    // TenantScope or any company/business data, so the same company's
    // data is exactly where it was when the user (or a different user on
    // the same device) signs back in.
    await ref.read(authSessionProvider.notifier).signOut();

    if (!context.mounted) return;

    context.go('/login');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    final session = ref.watch(authSessionProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings'), centerTitle: true),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          _SectionHeader('Company'),
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: const Icon(Icons.business_outlined),
              title: const Text('Company Profile'),
              subtitle: const Text(
                'Name, address, contact numbers, GST/PAN, bank details, logo',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/company-settings'),
            ),
          ),

          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: const Icon(Icons.edit_note_outlined),
              title: const Text('Customise Documents'),
              subtitle: const Text(
                'Terms & Conditions per document (point-wise), footer lines',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/reports/customise-documents'),
            ),
          ),

          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: const Icon(Icons.verified_user_outlined),
              title: const Text('KYC Documents'),
              subtitle: const Text(
                'Upload PAN + one more ID, view approval status',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/kyc'),
            ),
          ),

          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: const Icon(Icons.badge_outlined),
              title: const Text('Company Card'),
              subtitle: const Text('Shareable business-card PDF'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/company-card'),
            ),
          ),

          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: const Icon(Icons.description_outlined),
              title: const Text('Letter Head'),
              subtitle: const Text('Blank letterhead to write a letter on'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/letterhead-pdf'),
            ),
          ),

          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: const Icon(Icons.admin_panel_settings_outlined),
              title: const Text('Users & Roles'),
              subtitle: const Text(
                'Manage who can access the app and what they can do',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/users-roles'),
            ),
          ),

          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: const Icon(Icons.workspace_premium_outlined),
              title: const Text('Subscription Status'),
              subtitle: const Text('View current status and expiry'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/subscription'),
            ),
          ),

          if (SuperAdminScope.isSuperAdmin)
            Card(
              margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: ListTile(
                leading: const Icon(Icons.shield_outlined),
                title: const Text('Super Admin Dashboard'),
                subtitle: const Text('Verify payments, manage plans'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/super-admin'),
              ),
            ),

          const SizedBox(height: 16),

          _SectionHeader('Documents'),
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: const Icon(Icons.folder_open_outlined),
              title: const Text('All Documents'),
              subtitle: const Text(
                'Quotations, storage receipts, bills, payment receipts, releases',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/documents'),
            ),
          ),

          const SizedBox(height: 16),

          _SectionHeader('Masters'),
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: const Icon(Icons.people_outline),
              title: const Text('Customers'),
              subtitle: const Text(
                'View, search, add and edit customers',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/customers'),
            ),
          ),
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: const Icon(Icons.price_change_outlined),
              title: const Text('Charge Heads'),
              subtitle: const Text(
                'Storage, loading, handling and other bill lines',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/charge-heads'),
            ),
          ),
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: const Icon(Icons.warehouse_outlined),
              title: const Text('Storage Locations'),
              subtitle: const Text(
                'Halls, rooms, racks and bays inside your godown',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/storage-locations'),
            ),
          ),

          const SizedBox(height: 16),

          _SectionHeader('Appearance'),
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: RadioGroup<ThemeMode>(
              groupValue: themeMode,
              onChanged: (mode) {
                if (mode == null) return;
                ref.read(themeModeProvider.notifier).setThemeMode(mode);
              },
              child: const Column(
                children: [
                  RadioListTile<ThemeMode>(
                    title: Text('Light'),
                    value: ThemeMode.light,
                  ),
                  RadioListTile<ThemeMode>(
                    title: Text('Dark'),
                    value: ThemeMode.dark,
                  ),
                  RadioListTile<ThemeMode>(
                    title: Text('Follow System'),
                    value: ThemeMode.system,
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),

          _SectionHeader('Account'),
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Column(
              children: [
                if (session.mobileNumber != null)
                  ListTile(
                    leading: const Icon(Icons.phone_iphone_outlined),
                    title: const Text('Signed in as'),
                    subtitle: Text('+91 ${session.mobileNumber}'),
                  ),
                ListTile(
                  leading: const Icon(Icons.logout, color: Colors.red),
                  title: const Text(
                    'Logout',
                    style: TextStyle(color: Colors.red),
                  ),
                  onTap: () => _confirmLogout(context, ref),
                ),
                ListTile(
                  leading: const Icon(Icons.delete_forever_outlined, color: Colors.red),
                  title: const Text(
                    'Delete Account',
                    style: TextStyle(color: Colors.red),
                  ),
                  onTap: () => context.push('/delete-account'),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          _SectionHeader('Data & Backup'),
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: const Icon(Icons.cloud_done_outlined),
              title: const Text('Cloud Backup'),
              subtitle: const Text(
                'Documents back up automatically to your account - '
                'view status, backup now, or restore on a new phone',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/cloud-backup'),
            ),
          ),

          const SizedBox(height: 16),

          _SectionHeader('About'),
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Column(
              children: [
                const ListTile(
                  leading: Icon(Icons.info_outline),
                  title: Text('App Version'),
                  subtitle: Text('1.0.0'),
                ),
                ListTile(
                  leading: const Icon(Icons.privacy_tip_outlined),
                  title: const Text('Privacy Policy'),
                  trailing: const Icon(Icons.open_in_new, size: 18),
                  onTap: () => _openPrivacyPolicy(context),
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;

  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Text(
        title.toUpperCase(),
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.bold,
              letterSpacing: 0.5,
            ),
      ),
    );
  }
}
