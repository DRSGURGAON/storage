import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/contact/contact_launcher.dart';
import '../../core/subscription/subscription_access_service.dart';
import '../../core/subscription/subscription_status.dart';
import '../../core/tenant/tenant_provider.dart';
import '../../core/tenant/tenant_scope.dart';
import '../company/controllers/company_controller.dart';
import '../company/repositories/company_repository.dart';
import '../company/services/company_firestore_sync_service.dart';
import '../company/services/drs_id_counter_service.dart';
import '../subscription/models/subscription_model.dart';
import '../subscription/models/subscription_settings_model.dart';
import '../subscription/repositories/subscription_repository.dart';
import '../subscription/repositories/subscription_settings_repository.dart';
import 'services/dashboard_stats_service.dart';

/// The primary landing screen after login - every figure here is read
/// from DashboardStatsService, which itself only reads from the
/// existing, already-tenant-scoped repositories - no fake numbers, no
/// second data store.
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  // The Dashboard's own 4-shade brand palette, now genuinely reading
  // from the current Material theme's ColorScheme instead of fixed
  // hex values - which itself follows the company's own selected
  // DocumentTheme (see AppTheme.light/dark), the same 7-theme setting
  // that already styles every generated PDF. This is what makes the
  // in-app UI genuinely match a company's chosen theme, not just
  // their documents. Mapped to the closest original shade: navy
  // (darkest, was 0xff0A2540) -> primary, blue (was 0xff0D47A1) ->
  // primaryContainer, teal-dark (was 0xff0095A8) -> secondary,
  // teal-light (was 0xff00B5A6) -> tertiary.
  Color get _brandNavy => Theme.of(context).colorScheme.primary;
  Color get _brandBlue => Theme.of(context).colorScheme.primaryContainer;
  Color get _brandTealDark => Theme.of(context).colorScheme.secondary;
  Color get _brandTealLight => Theme.of(context).colorScheme.tertiary;

  DashboardStats? _stats;
  bool _loading = true;

  // Subscription summary (new addition) - reads the same
  // SubscriptionAccessService/SubscriptionRepository already used
  // elsewhere (SubscriptionScreen, the 4 document PDF screens' demo
  // gates) - no new calculation, no second subscription-status source.
  SubscriptionModel? _subscription;
  bool? _isSubscriptionActive;
  bool _isExpiringSoon = false;
  int? _daysUntilExpiry;

  // Super Admin's own single support contact (WhatsApp/Call) - the
  // same number for every installed company, not a per-company value.
  // See SubscriptionSettingsModel's own doc comment: this is genuinely
  // "where the customer sends their [payment screenshot]" - reused
  // here for the Dashboard's own Helpline card rather than sourcing
  // from CompanyModel, which would incorrectly show each company its
  // own number instead of the app owner's support contact.
  SubscriptionSettingsModel? _supportSettings;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    await _backfillDrsId();

    final stats = await DashboardStatsService.load();

    SubscriptionModel? subscription;
    bool? isActive;
    var isExpiringSoon = false;
    int? daysUntilExpiry;

    if (TenantScope.isReady) {
      subscription = await SubscriptionRepository.instance
          .getOrCreateForCompany(TenantScope.companyId);
      isActive = await SubscriptionAccessService.instance.isSubscriptionActive();
      isExpiringSoon = await SubscriptionAccessService.instance.isExpiringSoon();
      daysUntilExpiry = await SubscriptionAccessService.instance.daysUntilExpiry();
    }

    final supportSettings = await SubscriptionSettingsRepository.instance.get();

    if (!mounted) return;

    setState(() {
      _stats = stats;
      _subscription = subscription;
      _isSubscriptionActive = isActive;
      _isExpiringSoon = isExpiringSoon;
      _daysUntilExpiry = daysUntilExpiry;
      _supportSettings = supportSettings;
      _loading = false;
    });
  }

  /// A company saved before DRS-ID onboarding existed still carries
  /// the legacy 'DRS001' placeholder, so the unique-ID line under the
  /// company name (and the Super Admin's Customer ID) shows nothing
  /// for them. Mint their real sequential App ID once, best-effort - offline
  /// simply tries again on the next dashboard load. Saved via the
  /// repository directly (not CompanyController.saveCompany, whose
  /// keep-existing-code guard would discard the new value in favour
  /// of the old 'DRS001').
  Future<void> _backfillDrsId() async {
    try {
      final company = await CompanyController.instance.getCompany();
      if (company == null) return;

      final code = company.companyCode.trim();

      final String newCode;
      if (code.isEmpty || code == 'DRS001') {
        // Never assigned - mint a fresh sequential App ID.
        newCode = await DrsIdCounterService.instance.assignNextDrsId();
      } else if (code.toUpperCase().startsWith('DRS-')) {
        // Assigned under the old "DRS-4839" format - keep the same
        // number, just drop the prefix (App IDs are plain numbers
        // now). No counter interaction, so nothing is re-assigned.
        newCode = code.substring(4);
      } else {
        return;
      }

      final updated = company.copyWith(
        companyCode: newCode,
        updatedAt: DateTime.now().toIso8601String(),
      );

      await CompanyRepository.instance.saveCompany(updated);
      await CompanyFirestoreSyncService.instance.pushToCloud(updated);

      ref.invalidate(currentCompanyProvider);
    } catch (_) {
      // Offline / counter unreachable - the ID stays unassigned for
      // now and this retries on the next dashboard load.
    }
  }

  @override
  Widget build(BuildContext context) {
    final company = ref.watch(currentCompanyProvider).value;
    final needsSetup = company != null && !company.isConfigured;
    final hasDrsId = (company?.companyCode ?? '').isNotEmpty &&
        company?.companyCode != 'DRS001';
    final stats = _stats;

    return Scaffold(
      backgroundColor: const Color(0xffF2F4F7),
      appBar: AppBar(
        flexibleSpace: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [_brandNavy, _brandBlue],
            ),
          ),
        ),
        elevation: 2,
        centerTitle: false,
        title: const Text(
          "Godown Book",
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined, color: Colors.white),
            tooltip: 'Settings',
            onPressed: () => context.push('/settings'),
          ),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _load,
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Documents print from Company Settings, so an incomplete
                // profile silently produces blank letterheads.
                if (needsSetup)
                  Card(
                    color: const Color(0xffFFF4E5),
                    margin: const EdgeInsets.only(bottom: 16),
                    child: ListTile(
                      leading: const Icon(Icons.warning_amber_rounded),
                      title: const Text('Company profile incomplete'),
                      subtitle: Text(
                        'Documents need: '
                        '${company.missingFields.join(', ')}',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/company-settings'),
                    ),
                  ),

                // One merged banner: company identity on top, the
                // subscription-status line as its bottom strip - no
                // separate second card repeating the same ID/logo.
                if (company != null)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [_brandNavy, _brandTealDark],
                            ),
                          ),
                          child: Row(
                      children: [
                        Container(
                          width: 46,
                          height: 46,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.15),
                            shape: BoxShape.circle,
                          ),
                          clipBehavior: Clip.antiAlias,
                          padding: const EdgeInsets.all(4),
                          child: company.logoPath.isNotEmpty
                              ? Image.file(
                                  File(company.logoPath),
                                  fit: BoxFit.contain,
                                  errorBuilder: (context, error, stackTrace) =>
                                      const Icon(Icons.storefront_outlined,
                                          color: Colors.white, size: 24),
                                )
                              : const Icon(Icons.storefront_outlined,
                                  color: Colors.white, size: 24),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Welcome back',
                                style: TextStyle(fontSize: 12, color: Colors.white70),
                              ),
                              Text(
                                company.companyName.isEmpty
                                    ? 'Set up your company'
                                    : company.companyName,
                                style: const TextStyle(
                                  fontSize: 20,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.white,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              if (hasDrsId) ...[
                                const SizedBox(height: 2),
                                Text(
                                  'My AppID: ${company.companyCode}',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: Colors.white70,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                        if (hasDrsId &&
                            _supportSettings != null &&
                            (_supportSettings!.whatsappNumber.isNotEmpty ||
                                _supportSettings!.supportPhoneNumber.isNotEmpty))
                          InkWell(
                            borderRadius: BorderRadius.circular(20),
                            onTap: () {
                              final number =
                                  _supportSettings!.whatsappNumber.isNotEmpty
                                      ? _supportSettings!.whatsappNumber
                                      : _supportSettings!.supportPhoneNumber;

                              ContactLauncher.openWhatsAppWithChoice(
                                context,
                                number,
                                message:
                                    'Hello Godown Book,\n\n'
                                    'I am a new user and would like some '
                                    'assistance getting started. Kindly '
                                    'connect with me to help with my query.\n\n'
                                    'My AppID: ${company.companyCode}',
                              );
                            },
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.chat_bubble_outline, color: Colors.white, size: 16),
                                  SizedBox(width: 4),
                                  Text(
                                    'Contact Us',
                                    style: TextStyle(
                                      fontSize: 11,
                                      color: Colors.white,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                      ],
                    ),
                        ),
                        if (_subscription != null)
                          _subscriptionStatusStrip(context),
                      ],
                    ),
                  ),

                const SizedBox(height: 20),

                if (_loading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 60),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (stats != null) ...[
                  _sectionTitle('Quick Actions'),
                  _quickActions(context),

                  _sectionTitle('Today'),
                  _todaySection(stats),

                  DashboardExpandableSection(
                    icon: Icons.inventory_2_outlined,
                    iconColor: _brandNavy,
                    title: 'Storage',
                    summary: '${stats.inStorage} customers storing  •  '
                        '${_qty(stats.unitsInStock)} units',
                    initiallyExpanded: true,
                    child: _storageSection(stats, context),
                  ),

                  DashboardExpandableSection(
                    icon: Icons.people_outline,
                    iconColor: _brandTealDark,
                    title: 'Customers',
                    summary: '${stats.activeCustomers} active customers',
                    child: _customerSection(stats, context),
                  ),

                  if (_supportSettings != null) _supportContactRow(_supportSettings!),
                  if (_subscription != null) _subscriptionIconsRow(context),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _sectionTitle(String text) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 12),
      child: Row(
        children: [
          Container(
            width: 4,
            height: 18,
            decoration: BoxDecoration(
              color: _brandTealLight,
              borderRadius: BorderRadius.circular(4),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            text,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: _brandNavy,
            ),
          ),
        ],
      ),
    );
  }

  /// The subscription-status line, shown as the bottom strip of the
  /// merged welcome banner (previously its own separate card that
  /// repeated the App ID/logo the banner already shows). Same
  /// status-message logic as before; tapping opens the full
  /// Subscription screen.
  Widget _subscriptionStatusStrip(BuildContext context) {
    final subscription = _subscription;
    if (subscription == null) return const SizedBox.shrink();

    final status = subscription.status;

    final showExpiryWarning = _isExpiringSoon && _daysUntilExpiry != null;
    final isHealthy = status == SubscriptionStatus.active && !showExpiryWarning;

    String statusMessage;
    if (status == SubscriptionStatus.expired) {
      statusMessage = 'Your subscription is expired, please renew it.';
    } else if (status == SubscriptionStatus.limited) {
      statusMessage = 'Subscribe now to unlock all Premium features.';
    } else if (showExpiryWarning) {
      final days = _daysUntilExpiry!;
      statusMessage = days <= 0
          ? 'Your subscription expires today - renew now.'
          : 'Expires in $days day${days == 1 ? '' : 's'} - renew soon.';
    } else if (isHealthy) {
      statusMessage = 'Your subscription is active.';
    } else {
      statusMessage = 'Limited access - subscribe for unlimited documents.';
    }

    return InkWell(
      onTap: () => context.push('/subscription'),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        color: isHealthy ? _brandTealLight : const Color(0xffE53935),
        child: Row(
          children: [
            Expanded(
              child: Text(
                statusMessage,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                isHealthy ? 'View Details' : 'Subscription Details',
                style: TextStyle(
                  color:
                      isHealthy ? _brandTealLight : const Color(0xffE53935),
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// A small stat tile - the shared building block for every summary
  /// grid below, sized to fit comfortably on a phone screen (2 per row).
  Widget _statTile(String label, String value, {Color? color}) {
    final accent = color ?? _brandTealDark;

    return Container(
      padding: const EdgeInsets.fromLTRB(0, 12, 12, 12),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: accent.withValues(alpha: 0.18)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            width: 4,
            margin: const EdgeInsets.symmetric(vertical: 2),
            decoration: BoxDecoration(
              color: accent,
              borderRadius: BorderRadius.circular(4),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: accent,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  label,
                  style: const TextStyle(fontSize: 12, color: Colors.grey),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _statGrid(List<Widget> tiles) {
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      crossAxisSpacing: 10,
      mainAxisSpacing: 10,
      // Was 1.9 - too tight for a 2-line label like "This FY Revenue
      // (2026-27)" to fit above the fixed cell height GridView.count
      // derives from this ratio, causing the reported bottom overflow.
      // 1.6 gives every tile (this ratio is shared across all 5
      // dashboard sections using _statGrid, not special-cased to
      // Financial Summary) genuinely more vertical room for a 2-line
      // label without needing a scrollable grid or a redesign.
      childAspectRatio: 1.6,
      children: tiles,
    );
  }

  Widget _quickActions(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: GridView.count(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 2,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        // Was 2.6 - a touch shorter per button (task's own "reduce
        // moderately, not tiny" instruction) without shrinking the
        // touch target below Material's 48dp minimum height.
        childAspectRatio: 3.0,
        children: [
          _actionButton(
            context,
            Icons.inventory_2_outlined,
            'New Storage',
            '/storage',
            color: _brandTealDark,
          ),
          _actionButton(
            context,
            Icons.outbox_outlined,
            'Release Goods',
            '/releases',
            color: _brandNavy,
          ),
          _actionButton(
            context,
            Icons.receipt_long_outlined,
            'Storage Bill',
            '/invoices',
            color: _brandBlue,
          ),
          _actionButton(
            context,
            Icons.receipt_outlined,
            'Payment Receipt',
            '/money-receipts',
            color: _brandTealLight,
          ),
          _actionButton(
            context,
            Icons.people_outline,
            'Customers',
            '/customers',
            color: _brandTealDark,
          ),
          // Letter Head needs no source record at all - it prints
          // purely from the Company Profile, so it routes straight to
          // its own PDF screen with no picker step.
          _actionButton(
            context,
            Icons.article_outlined,
            'Letter Head',
            '/letterhead-pdf',
            color: _brandBlue,
          ),
        ],
      ),
    );
  }

  Widget _actionButton(
    BuildContext context,
    IconData icon,
    String title,
    String route, {
    Color? color,
  }) {
    final effectiveColor = color ?? _brandTealDark;

    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => context.push(route),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.grey.shade200),
        ),
        child: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: effectiveColor.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 16, color: effectiveColor),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                title,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _qty(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

  Widget _todaySection(DashboardStats stats) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: _statGrid([
        _statTile('New Storage Today', '${stats.receiptsToday}'),
        _statTile('Rent Due', '${stats.rentDue.length}',
            color: stats.rentDue.isEmpty ? null : Colors.deepOrange),
      ]),
    );
  }

  Widget _storageSection(DashboardStats stats, BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        children: [
          _statGrid([
            _statTile('In Storage', '${stats.inStorage}'),
            _statTile('Units In Stock', _qty(stats.unitsInStock)),
            _statTile('Partly Released', '${stats.partlyReleased}',
                color: Colors.deepOrange),
            _statTile('Released', '${stats.releasedCount}', color: Colors.green),
          ]),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: () => context.push('/storage'),
              icon: const Icon(Icons.chevron_right),
              label: const Text('All storage'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _customerSection(DashboardStats stats, BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        children: [
          _statGrid([
            _statTile('Active Customers', '${stats.activeCustomers}'),
            _statTile('Total Customers', '${stats.customers.length}'),
          ]),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: () => context.push('/customers'),
              icon: const Icon(Icons.chevron_right),
              label: const Text('Manage customers'),
            ),
          ),
        ],
      ),
    );
  }

  /// Subscription-status icons - a second, icon-style entry point to
  /// the same existing /subscription and /subscription-history routes
  /// (also reachable from Settings) - genuinely reuses this screen's
  /// own already-loaded _subscription data, not a new status source.
  Widget _subscriptionIconsRow(BuildContext context) {
    final isActive = _isSubscriptionActive ?? false;

    final statusIcon = isActive ? Icons.verified : Icons.add_circle_outline;
    final statusColor = isActive ? const Color(0xff2E7D32) : const Color(0xff1F3864);
    final statusLabel = isActive ? 'Subscribed' : 'Subscribe Now';

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Card(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: Colors.grey.shade200),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Subscription',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              ),
              const Divider(height: 20),
              Row(
                children: [
                  Expanded(
                    child: _supportOption(
                      icon: statusIcon,
                      iconColor: statusColor,
                      label: statusLabel,
                      onTap: () => context.push('/subscription'),
                    ),
                  ),
                  Expanded(
                    child: _supportOption(
                      icon: Icons.history,
                      iconColor: const Color(0xff1F3864),
                      label: 'Subscription History',
                      onTap: () => context.push('/subscription-history'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// One contact row - icon chip, title, the actual number/hint, and a
  /// chevron. Reads as a tappable action rather than a bare icon, and
  /// shows the number itself so the user knows who they are calling
  /// before they tap.
  Widget _contactTile({
    required Widget iconWidget,
    required Color tint,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return Material(
      color: tint.withValues(alpha: 0.06),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: tint.withValues(alpha: 0.25)),
                ),
                alignment: Alignment.center,
                child: iconWidget,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Colors.grey,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: tint),
            ],
          ),
        ),
      ),
    );
  }

  /// WhatsApp/Call support row - genuinely sourced from the Super
  /// Admin's own single support contact (SubscriptionSettingsModel.
  /// whatsappNumber/supportPhoneNumber, the same number for every
  /// installed company - see SubscriptionSettingsModel's own doc
  /// comment), never a hardcoded/invented number and never a
  /// per-company value. Shown at the bottom of the Dashboard
  /// (post-login). Prefers whatsappNumber for the WhatsApp button
  /// specifically, falling back to supportPhoneNumber when no
  /// dedicated WhatsApp number was configured; "Call Us" always uses
  /// supportPhoneNumber. Renders nothing (not an empty/broken card)
  /// when neither is configured.
  Widget _supportContactRow(SubscriptionSettingsModel settings) {
    final whatsappNumber = settings.whatsappNumber.isNotEmpty
        ? settings.whatsappNumber
        : settings.supportPhoneNumber;
    final callNumber = settings.supportPhoneNumber;

    if (whatsappNumber.isEmpty && callNumber.isEmpty) {
      return const SizedBox.shrink();
    }

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Card(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: Colors.grey.shade200),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      color: _brandNavy.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      Icons.support_agent,
                      size: 19,
                      color: _brandNavy,
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Need help?',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          'Our support team is here for you',
                          style: TextStyle(fontSize: 12, color: Colors.grey),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              if (callNumber.isNotEmpty)
                _contactTile(
                  iconWidget: Icon(
                    Icons.call,
                    size: 20,
                    color: _brandBlue,
                  ),
                  tint: _brandBlue,
                  title: 'Call Us',
                  subtitle: callNumber,
                  onTap: () => ContactLauncher.call(callNumber),
                ),
              if (callNumber.isNotEmpty && whatsappNumber.isNotEmpty)
                const SizedBox(height: 10),
              if (whatsappNumber.isNotEmpty)
                _contactTile(
                  iconWidget: Image.asset(
                    'assets/images/whatsapp_icon.png',
                    width: 22,
                    height: 22,
                  ),
                  tint: const Color(0xff25D366),
                  title: 'WhatsApp',
                  subtitle: 'Chat with us  •  choose your app',
                  onTap: () => ContactLauncher.openWhatsAppWithChoice(
                    context,
                    whatsappNumber,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _supportOption({
    IconData? icon,
    Widget? iconWidget,
    required Color iconColor,
    required String label,
    required VoidCallback onTap,
  }) {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: iconColor.withValues(alpha: 0.1),
                shape: BoxShape.circle,
              ),
              child: iconWidget ?? Icon(icon, color: iconColor, size: 26),
            ),
            const SizedBox(height: 10),
            Text(
              label,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
    );
  }
}

/// A collapsible Dashboard section - icon + heading + optional glance
/// summary, collapsed by default, expanding to its full content only
/// when tapped. Keeps the home screen scannable instead of forcing
/// every section's full detail to always render - purely a display/
/// interaction wrapper around each section's own already-existing
/// content widget; no section's own data or calculation logic is
/// touched by this.
class DashboardExpandableSection extends StatefulWidget {
  final IconData icon;
  final Color iconColor;
  final String title;

  /// A short glance value shown next to the title even while
  /// collapsed (e.g. "12 Bookings") - null when there's nothing
  /// meaningful to summarize in one line.
  final String? summary;

  final Widget child;

  final bool initiallyExpanded;

  const DashboardExpandableSection({
    super.key,
    required this.icon,
    required this.iconColor,
    required this.title,
    this.summary,
    required this.child,
    this.initiallyExpanded = false,
  });

  @override
  State<DashboardExpandableSection> createState() =>
      _DashboardExpandableSectionState();
}

class _DashboardExpandableSectionState
    extends State<DashboardExpandableSection> {
  late bool _expanded = widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: Colors.grey.shade200),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InkWell(
              onTap: () => setState(() => _expanded = !_expanded),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 14,
                ),
                child: Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: widget.iconColor.withValues(alpha: 0.1),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(widget.icon, color: widget.iconColor, size: 20),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            widget.title,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          if (widget.summary != null)
                            Text(
                              widget.summary!,
                              style: const TextStyle(
                                fontSize: 12,
                                color: Colors.grey,
                              ),
                            ),
                        ],
                      ),
                    ),
                    Icon(
                      _expanded ? Icons.expand_less : Icons.expand_more,
                      color: Colors.grey,
                    ),
                  ],
                ),
              ),
            ),
            if (_expanded)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: widget.child,
              ),
          ],
        ),
      ),
    );
  }
}
