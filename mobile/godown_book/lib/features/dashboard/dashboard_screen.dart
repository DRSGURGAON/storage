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

/// The home screen: what the operator can do, what happened today, and
/// what needs attention. Every figure comes from DashboardStatsService,
/// which only reads the existing, already-company-scoped repositories.
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  Color get _brandNavy => Theme.of(context).colorScheme.primary;
  Color get _brandBlue => Theme.of(context).colorScheme.primaryContainer;
  Color get _brandTealDark => Theme.of(context).colorScheme.secondary;
  Color get _brandTealLight => Theme.of(context).colorScheme.tertiary;

  DashboardStats? _stats;
  bool _loading = true;

  SubscriptionModel? _subscription;
  bool? _isSubscriptionActive;
  bool _isExpiringSoon = false;
  int? _daysUntilExpiry;

  /// The app owner's own support contact - the same number for every
  /// installed company, not a per-company value.
  SubscriptionSettingsModel? _supportSettings;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    await _backfillAppId();

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

  /// Mints this company's App ID the first time it is online. Offline,
  /// it simply tries again on the next load.
  Future<void> _backfillAppId() async {
    try {
      final company = await CompanyController.instance.getCompany();
      if (company == null) return;

      final code = company.companyCode.trim();
      if (code.isNotEmpty) return;

      final updated = company.copyWith(
        companyCode: await DrsIdCounterService.instance.assignNextDrsId(),
        updatedAt: DateTime.now().toIso8601String(),
      );

      await CompanyRepository.instance.saveCompany(updated);
      await CompanyFirestoreSyncService.instance.pushToCloud(updated);

      ref.invalidate(currentCompanyProvider);
    } catch (_) {
      // Offline or the counter is unreachable - retried next time.
    }
  }

  String _money(double value) {
    if (value >= 100000) return '₹${(value / 100000).toStringAsFixed(1)}L';
    return '₹${value.toStringAsFixed(0)}';
  }

  static String _qty(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

  String get _greeting {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context) {
    final company = ref.watch(currentCompanyProvider).value;
    final needsSetup = company != null && !company.isConfigured;
    final hasAppId = (company?.companyCode ?? '').isNotEmpty;
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
          'Godown Book',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.folder_open_outlined, color: Colors.white),
            tooltip: 'Documents',
            onPressed: () => context.push('/documents'),
          ),
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
                if (needsSetup)
                  Card(
                    color: const Color(0xffFFF4E5),
                    margin: const EdgeInsets.only(bottom: 16),
                    child: ListTile(
                      leading: const Icon(Icons.warning_amber_rounded),
                      title: const Text('Company profile incomplete'),
                      subtitle: Text(
                        'Your documents need: ${company.missingFields.join(', ')}',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/company-settings'),
                    ),
                  ),

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
                                            const Icon(Icons.warehouse_outlined,
                                                color: Colors.white, size: 24),
                                      )
                                    : const Icon(Icons.warehouse_outlined,
                                        color: Colors.white, size: 24),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      '$_greeting 👋',
                                      style: const TextStyle(fontSize: 12, color: Colors.white70),
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
                                    if (hasAppId) ...[
                                      const SizedBox(height: 2),
                                      Text(
                                        'My App ID: ${company.companyCode}',
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
                              if (hasAppId &&
                                  _supportSettings != null &&
                                  (_supportSettings!.whatsappNumber.isNotEmpty ||
                                      _supportSettings!.supportPhoneNumber.isNotEmpty))
                                InkWell(
                                  borderRadius: BorderRadius.circular(20),
                                  onTap: () {
                                    final number = _supportSettings!.whatsappNumber.isNotEmpty
                                        ? _supportSettings!.whatsappNumber
                                        : _supportSettings!.supportPhoneNumber;

                                    ContactLauncher.openWhatsAppWithChoice(
                                      context,
                                      number,
                                      message: 'Hello Godown Book,\n\n'
                                          'I need some help getting started.\n\n'
                                          'My App ID: ${company.companyCode}',
                                    );
                                  },
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 10, vertical: 8),
                                    decoration: BoxDecoration(
                                      color: Colors.white.withValues(alpha: 0.15),
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: const Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(Icons.chat_bubble_outline,
                                            color: Colors.white, size: 16),
                                        SizedBox(width: 4),
                                        Text(
                                          'Help',
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
                        if (_subscription != null) _subscriptionStatusStrip(context),
                      ],
                    ),
                  ),

                const SizedBox(height: 20),

                _sectionTitle('Quick Actions'),
                _quickActions(context),

                if (_loading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 40),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (stats != null) ...[
                  _sectionTitle("Today"),
                  _todaySection(stats),

                  _sectionTitle('Needs Attention'),
                  _attentionSection(stats, context),

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
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: _brandNavy),
          ),
        ],
      ),
    );
  }

  /// The subscription line, as the bottom strip of the welcome banner.
  Widget _subscriptionStatusStrip(BuildContext context) {
    final subscription = _subscription;
    if (subscription == null) return const SizedBox.shrink();

    final status = subscription.status;
    final showExpiryWarning = _isExpiringSoon && _daysUntilExpiry != null;
    final isHealthy = status == SubscriptionStatus.active && !showExpiryWarning;

    String statusMessage;
    if (status == SubscriptionStatus.expired) {
      statusMessage = 'Your subscription has expired - please renew it.';
    } else if (status == SubscriptionStatus.limited) {
      statusMessage = 'Subscribe to make unlimited documents.';
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
                    color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13),
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
                isHealthy ? 'View Details' : 'See Plans',
                style: TextStyle(
                  color: isHealthy ? _brandTealLight : const Color(0xffE53935),
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

  Widget _quickActions(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: GridView.count(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 2,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        childAspectRatio: 3.0,
        children: [
          _actionButton(context, Icons.person_add_alt_1_outlined, 'New Customer',
              '/customer-create', color: _brandTealDark),
          _actionButton(context, Icons.request_quote_outlined, 'New Quotation',
              '/quotation-create', color: _brandNavy),
          _actionButton(context, Icons.inventory_2_outlined, 'New Storage',
              '/storage-create', color: _brandBlue),
          _actionButton(context, Icons.receipt_long_outlined, 'Create Bill',
              '/bill-create', color: _brandTealLight),
          _actionButton(context, Icons.payments_outlined, 'Receive Payment',
              '/payment-create', color: _brandTealDark),
          _actionButton(context, Icons.outbox_outlined, 'Release Goods',
              '/release-create', color: _brandNavy),
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
      onTap: () async {
        await context.push(route);
        _load();
      },
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

  Widget _todaySection(DashboardStats stats) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: GridView.count(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 2,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 1.6,
        children: [
          _statTile('Customers Storing', '${stats.customersStoring}',
              onTap: () => context.push('/customers')),
          _statTile('Items In Storage', _qty(stats.itemsInStorage),
              onTap: () => context.push('/storage')),
          _statTile(
            'Bills Due',
            '${stats.unpaidBills.length}',
            color: stats.unpaidBills.isEmpty ? null : Colors.red,
            onTap: () => context.push('/bills'),
          ),
          _statTile(
            'Received Today',
            _money(stats.collectedToday),
            color: Colors.green,
            onTap: () => context.push('/payments'),
          ),
        ],
      ),
    );
  }

  Widget _statTile(String label, String value, {Color? color, VoidCallback? onTap}) {
    final accent = color ?? _brandTealDark;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
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
                        fontSize: 20, fontWeight: FontWeight.bold, color: accent),
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
      ),
    );
  }

  /// Only what genuinely needs doing - nothing is listed when the desk
  /// is clear.
  Widget _attentionSection(DashboardStats stats, BuildContext context) {
    final rows = <Widget>[];

    if (stats.rentDue.isNotEmpty) {
      rows.add(_attentionRow(
        Icons.receipt_long_outlined,
        Colors.deepOrange,
        '${stats.rentDue.length} storage bill${stats.rentDue.length == 1 ? '' : 's'} to raise',
        stats.rentDue.take(3).map((b) => b.customerName).join(', '),
        () async {
          await context.push('/bill-create', extra: stats.rentDue.first.id);
          _load();
        },
      ));
    }

    if (stats.unpaidBills.isNotEmpty) {
      rows.add(_attentionRow(
        Icons.currency_rupee,
        Colors.red,
        '${_money(stats.totalOutstanding)} outstanding',
        '${stats.unpaidBills.length} bill${stats.unpaidBills.length == 1 ? '' : 's'} unpaid'
        '${stats.overdueBills.isEmpty ? '' : ', ${stats.overdueBills.length} overdue'}',
        () async {
          await context.push('/bills');
          _load();
        },
      ));
    }

    if (stats.pastExpectedEnd.isNotEmpty) {
      rows.add(_attentionRow(
        Icons.event_busy_outlined,
        Colors.indigo,
        '${stats.pastExpectedEnd.length} past the expected end date',
        stats.pastExpectedEnd.take(3).map((b) => b.customerName).join(', '),
        () async {
          await context.push('/storage');
          _load();
        },
      ));
    }

    if (stats.quotationsAwaitingReply.isNotEmpty) {
      rows.add(_attentionRow(
        Icons.mark_email_unread_outlined,
        _brandBlue,
        '${stats.quotationsAwaitingReply.length} quotation${stats.quotationsAwaitingReply.length == 1 ? '' : 's'} awaiting reply',
        stats.quotationsAwaitingReply.take(3).map((q) => q.customerName).join(', '),
        () async {
          await context.push('/quotations');
          _load();
        },
      ));
    }

    if (rows.isEmpty) {
      return const Padding(
        padding: EdgeInsets.only(bottom: 16),
        child: Card(
          child: ListTile(
            leading: Icon(Icons.check_circle_outline, color: Color(0xff2E7D32)),
            title: Text('Nothing pending'),
            subtitle: Text('Bills are raised, payments are in, nothing is overdue.'),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Card(child: Column(children: rows)),
    );
  }

  Widget _attentionRow(
    IconData icon,
    Color color,
    String title,
    String subtitle,
    VoidCallback onTap,
  ) {
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: color.withValues(alpha: 0.12),
        foregroundColor: color,
        child: Icon(icon, size: 18),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: subtitle.isEmpty ? null : Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    );
  }

  Widget _subscriptionIconsRow(BuildContext context) {
    final isActive = _isSubscriptionActive ?? false;

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
              const Text('Subscription',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              const Divider(height: 20),
              Row(
                children: [
                  Expanded(
                    child: _supportOption(
                      icon: isActive ? Icons.verified : Icons.add_circle_outline,
                      iconColor:
                          isActive ? const Color(0xff2E7D32) : const Color(0xff1F3864),
                      label: isActive ? 'Subscribed' : 'Subscribe Now',
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
                    Text(title,
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                    Text(subtitle,
                        style: const TextStyle(fontSize: 12, color: Colors.grey)),
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

  /// The app owner's support contact, from the Super Admin's own
  /// settings - never a per-company number, never invented.
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
                    child: Icon(Icons.support_agent, size: 19, color: _brandNavy),
                  ),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Need help?',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                        Text('Our support team is here for you',
                            style: TextStyle(fontSize: 12, color: Colors.grey)),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              if (callNumber.isNotEmpty)
                _contactTile(
                  iconWidget: Icon(Icons.call, size: 20, color: _brandBlue),
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
    required IconData icon,
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
              child: Icon(icon, color: iconColor, size: 26),
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
