import 'package:flutter/material.dart';

import '../../../core/constants/app_build.dart';
import '../../../core/constants/platform_defaults.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app/theme/brand.dart';
import '../../../core/auth/auth_session.dart';
import '../../../core/subscription/super_admin_scope.dart';
import '../../../core/tenant/tenant_scope.dart';
import '../../subscription/repositories/subscription_repository.dart';

/// App-wide Settings, reachable independently of whether the Company
/// Profile is complete - the dashboard's incomplete-profile banner is a
/// prompt for new installs, not the only way to reach these screens
/// afterwards.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  Future<void> _openPrivacyPolicy(BuildContext context) async {
    final uri = Uri.parse(PlatformDefaults.privacyPolicyUrl);

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
            style: FilledButton.styleFrom(backgroundColor: Brand.coral),
            child: const Text('Logout'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    // Backs up the latest work, then ends the session and the active
    // tenant. The company's rows stay on this device and are active
    // again when the same account signs back in; a different account
    // gets its own company (see TenantBootstrap).
    await ref.read(authSessionProvider.notifier).signOut();

    if (!context.mounted) return;

    context.go('/login');
  }

  /// Re-asks the cloud for this company's subscription record - the
  /// same call [SubscriptionRepository] already makes on its own; this
  /// just gives the owner a button to try again right now, and the
  /// result updates [SubscriptionRepository.lastCloudError] either way.
  Future<void> _retrySync(BuildContext context) async {
    final companyId = TenantScope.companyIdOrNull;
    if (companyId == null || companyId.isEmpty) return;
    try {
      await SubscriptionRepository.instance.getOrCreateForCompany(companyId);
    } catch (_) {
      // lastCloudError already carries the reason; nothing more to do.
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(authSessionProvider);

    return Scaffold(
      backgroundColor: Brand.paper,
      appBar: AppBar(title: const Text('Settings'), centerTitle: true),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          const _SectionHeader('Company', icon: Icons.business_outlined),
          _SettingsGroup(
            color: Brand.skyInk,
            background: Brand.skySoft,
            tiles: [
              _SettingsTile(
                icon: Icons.business_outlined,
                title: 'Company Profile',
                subtitle: 'Name, address, contact numbers, GST/PAN, bank '
                    'details, logo',
                onTap: () => context.push('/company-settings'),
              ),
              _SettingsTile(
                icon: Icons.edit_note_outlined,
                title: 'Customise Documents',
                subtitle: 'Terms & Conditions per document (point-wise), '
                    'footer lines',
                onTap: () => context.push('/reports/customise-documents'),
              ),
              _SettingsTile(
                icon: Icons.verified_user_outlined,
                title: 'KYC Documents',
                subtitle: 'Upload PAN + one more ID, view approval status',
                onTap: () => context.push('/kyc'),
              ),
              _SettingsTile(
                icon: Icons.badge_outlined,
                title: 'Company Card',
                subtitle: 'Shareable business-card PDF',
                onTap: () => context.push('/company-card'),
              ),
              _SettingsTile(
                icon: Icons.description_outlined,
                title: 'Letter Head',
                subtitle: 'Blank letterhead to write a letter on',
                onTap: () => context.push('/letterhead-pdf'),
              ),
              _SettingsTile(
                icon: Icons.admin_panel_settings_outlined,
                title: 'Users & Roles',
                subtitle: 'Roles for the people who use this phone',
                onTap: () => context.push('/users-roles'),
              ),
              _SettingsTile(
                icon: Icons.workspace_premium_outlined,
                title: 'Subscription Status',
                subtitle: 'View current status and expiry',
                color: Brand.amberInk,
                background: Brand.amberSoft,
                onTap: () => context.push('/subscription'),
              ),
            ],
          ),

          // Checked again each time Settings opens, and shown the moment
          // the answer lands - a check that failed at launch no longer
          // hides the menu until the next sign-in.
          ValueListenableBuilder<bool>(
            valueListenable: SuperAdminScope.listenable,
            builder: (context, isSuperAdmin, _) {
              SuperAdminScope.refresh().ignore();
              if (!isSuperAdmin) return const SizedBox.shrink();
              return Padding(
                padding: const EdgeInsets.only(top: 8),
                child: _SettingsGroup(
                  color: Brand.coralInk,
                  background: Brand.coralSoft,
                  tiles: [
                    _SettingsTile(
                      icon: Icons.shield_outlined,
                      title: 'Super Admin Dashboard',
                      subtitle: 'Companies, plans, referrals',
                      onTap: () => context.push('/super-admin'),
                    ),
                  ],
                ),
              );
            },
          ),

          const SizedBox(height: 20),

          const _SectionHeader('Documents', icon: Icons.folder_open_outlined),
          _SettingsGroup(
            color: Brand.mintInk,
            background: Brand.mintSoft,
            tiles: [
              _SettingsTile(
                icon: Icons.folder_open_outlined,
                title: 'All Documents',
                subtitle: 'Quotations, storage receipts, bills, receipts, '
                    'releases, credit notes, notices, damage reports and '
                    'bilties',
                onTap: () => context.go('/documents'),
              ),
              _SettingsTile(
                icon: Icons.bar_chart_outlined,
                title: 'Reports',
                subtitle: 'Ledger, outstanding, payments, GST, rent roll - '
                    'with Excel',
                onTap: () => context.push('/reports'),
              ),
              _SettingsTile(
                icon: Icons.chat_outlined,
                title: 'WhatsApp Messages',
                subtitle: 'Your own words for documents, payment reminders, '
                    'follow-ups and storage renewals',
                color: const Color(0xff128C4A),
                background: const Color(0xffE7F8EE),
                onTap: () => context.push('/settings/whatsapp-messages'),
              ),
            ],
          ),

          const SizedBox(height: 20),

          const _SectionHeader('Masters', icon: Icons.inventory_2_outlined),
          _SettingsGroup(
            color: Brand.amberInk,
            background: Brand.amberSoft,
            tiles: [
              _SettingsTile(
                icon: Icons.people_outline,
                title: 'Customers',
                subtitle: 'View, search, add and edit customers',
                onTap: () => context.go('/customers'),
              ),
              _SettingsTile(
                icon: Icons.price_change_outlined,
                title: 'Charge Heads',
                subtitle: 'Storage, loading, handling and other bill lines',
                onTap: () => context.push('/charge-heads'),
              ),
              _SettingsTile(
                icon: Icons.warehouse_outlined,
                title: 'Storage Locations',
                subtitle: 'Halls, rooms, racks and bays inside your godown',
                onTap: () => context.push('/storage-locations'),
              ),
            ],
          ),

          const SizedBox(height: 20),

          const _SectionHeader('Account', icon: Icons.person_outline),
          _SettingsGroup(
            color: Brand.navy,
            background: Brand.skySoft,
            tiles: [
              if (session.mobileNumber != null)
                _SettingsTile(
                  icon: Icons.phone_iphone_outlined,
                  title: 'Signed in as',
                  subtitle: '+91 ${session.mobileNumber}',
                  showArrow: false,
                ),
              _SettingsTile(
                icon: Icons.info_outline,
                title: 'App version',
                subtitle: AppBuild.label,
                showArrow: false,
              ),
            ],
          ),
          const SizedBox(height: 8),
          _CloudSyncStatusCard(onRetry: () => _retrySync(context)),
          const SizedBox(height: 8),
          _SettingsGroup(
            color: Brand.coralInk,
            background: Brand.coralSoft,
            tiles: [
              _SettingsTile(
                icon: Icons.logout,
                title: 'Logout',
                titleColor: Brand.coralDeep,
                showArrow: false,
                onTap: () => _confirmLogout(context, ref),
              ),
              _SettingsTile(
                icon: Icons.delete_forever_outlined,
                title: 'Delete Account',
                titleColor: Brand.coralDeep,
                showArrow: false,
                onTap: () => context.push('/delete-account'),
              ),
            ],
          ),

          // Cloud backup has no tile of its own: it runs on its own
          // every few minutes while the app is open
          // (DocumentCloudSyncService) and restores itself on a new
          // phone at login. The card above only reports whether the
          // last attempt reached the server.

          const SizedBox(height: 20),

          const _SectionHeader('About', icon: Icons.info_outline),
          _SettingsGroup(
            color: Brand.skyInk,
            background: Brand.skySoft,
            tiles: [
              _SettingsTile(
                icon: Icons.privacy_tip_outlined,
                title: 'Privacy Policy',
                showArrow: false,
                trailing: const Icon(Icons.open_in_new,
                    size: 18, color: Brand.inkMuted),
                onTap: () => _openPrivacyPolicy(context),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A rounded, elevation-free card holding one section's rows, each with
/// a soft-tinted icon badge in the section's own colour - the same
/// grouped-list look used by Account and About already, now shared by
/// every section instead of one Card per row.
class _SettingsGroup extends StatelessWidget {
  const _SettingsGroup({
    required this.color,
    required this.background,
    required this.tiles,
  });

  final Color color;
  final Color background;
  final List<_SettingsTile> tiles;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Brand.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Brand.line),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Column(
          children: [
            for (var i = 0; i < tiles.length; i++) ...[
              if (i > 0) const Divider(height: 1, indent: 68, color: Brand.line),
              tiles[i]._withGroupColors(color, background),
            ],
          ],
        ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.icon,
    required this.title,
    this.subtitle,
    this.onTap,
    this.color,
    this.background,
    this.titleColor,
    this.trailing,
    this.showArrow = true,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  final Color? color;
  final Color? background;
  final Color? titleColor;
  final Widget? trailing;
  final bool showArrow;

  /// Falls back to the group's colours when this tile did not pick its
  /// own (e.g. WhatsApp Messages keeps its brand green regardless of
  /// which section it sits in).
  Widget _withGroupColors(Color groupColor, Color groupBackground) {
    return _SettingsTile(
      icon: icon,
      title: title,
      subtitle: subtitle,
      onTap: onTap,
      color: color ?? groupColor,
      background: background ?? groupBackground,
      titleColor: titleColor,
      trailing: trailing,
      showArrow: showArrow,
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: background ?? Brand.skySoft,
          borderRadius: BorderRadius.circular(11),
        ),
        child: Icon(icon, color: color ?? Brand.skyInk, size: 20),
      ),
      title: Text(
        title,
        style: TextStyle(
          fontWeight: FontWeight.w600,
          fontSize: 14.5,
          color: titleColor ?? Brand.ink,
        ),
      ),
      subtitle: subtitle == null
          ? null
          : Text(
              subtitle!,
              style: const TextStyle(fontSize: 12.5, color: Brand.inkMuted),
            ),
      trailing: trailing ??
          (showArrow && onTap != null
              ? const Icon(Icons.chevron_right, color: Brand.inkMuted)
              : null),
      onTap: onTap,
    );
  }
}

/// Translates a cloud-sync result into something an owner can act on,
/// instead of a raw Firebase error code sitting under "App version" in
/// red. Local data is never at risk either way - this only ever
/// reports whether the last attempt to reach the server succeeded.
class _CloudSyncStatusCard extends StatelessWidget {
  const _CloudSyncStatusCard({required this.onRetry});

  final VoidCallback onRetry;

  static String _message(String code) {
    switch (code) {
      case 'permission-denied':
      case 'unauthenticated':
        return 'Could not confirm your sign-in with the server yet. This '
            'usually clears up within a few minutes - tap Retry, or it '
            'will try again on its own.';
      case 'unavailable':
      case 'deadline-exceeded':
      case 'timeout':
        return 'No internet connection right now. It will sync '
            'automatically once you are back online.';
      default:
        return 'Could not reach the server just now. It will keep trying '
            'on its own.';
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<String?>(
      valueListenable: SubscriptionRepository.lastCloudError,
      builder: (context, error, _) {
        final synced = error == null;
        final color = synced ? Brand.mintInk : Brand.amberInk;
        final background = synced ? Brand.mintSoft : Brand.amberSoft;

        return DecoratedBox(
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  synced ? Icons.cloud_done_outlined : Icons.cloud_off_outlined,
                  color: color,
                  size: 22,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        synced ? 'Synced with the cloud' : 'Sync pending',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 13.5,
                          color: color,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        synced
                            ? 'Your data is backed up and available on '
                                'other devices.'
                            : _message(error),
                        style: TextStyle(
                          fontSize: 12.5,
                          color: color.withValues(alpha: 0.85),
                          height: 1.3,
                        ),
                      ),
                      if (!synced) ...[
                        const SizedBox(height: 8),
                        SizedBox(
                          height: 32,
                          child: OutlinedButton(
                            onPressed: onRetry,
                            style: OutlinedButton.styleFrom(
                              foregroundColor: color,
                              side: BorderSide(color: color.withValues(alpha: 0.4)),
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 14),
                              visualDensity: VisualDensity.compact,
                            ),
                            child: const Text('Retry now'),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.title, {required this.icon});

  final String title;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 4, 4, 10),
      child: Row(
        children: [
          Icon(icon, size: 16, color: Brand.navy),
          const SizedBox(width: 6),
          Text(
            title.toUpperCase(),
            style: const TextStyle(
              color: Brand.navy,
              fontWeight: FontWeight.w800,
              fontSize: 12.5,
              letterSpacing: 0.6,
            ),
          ),
        ],
      ),
    );
  }
}
