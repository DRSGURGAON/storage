import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app/theme/brand.dart';
import '../../core/contact/contact_launcher.dart';
import '../../core/subscription/subscription_access_service.dart';
import '../../core/subscription/subscription_status.dart';
import '../../core/tenant/tenant_provider.dart';
import '../../core/tenant/tenant_scope.dart';
import '../company/controllers/company_controller.dart';
import '../company/models/company_model.dart';
import '../company/repositories/company_repository.dart';
import '../company/services/company_firestore_sync_service.dart';
import '../company/services/drs_id_counter_service.dart';
import '../promo/promo_banner.dart';
import '../subscription/models/subscription_model.dart';
import '../subscription/models/subscription_settings_model.dart';
import '../subscription/repositories/subscription_repository.dart';
import '../subscription/repositories/subscription_settings_repository.dart';
import 'services/dashboard_stats_service.dart';

/// The screen an operator opens twenty times a day. Top to bottom: who
/// is in the godown and how each lot is doing, the money, what needs
/// doing today, and the things they start most often. Every figure
/// comes from DashboardStatsService.
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  static final _rupees = NumberFormat.decimalPattern('en_IN');
  static final _dayFormat = DateFormat('EEEE, d MMM');

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

  Future<void> _open(String route, {Object? extra}) async {
    // Customers and Documents are tabs on the shell's bar, so they are
    // switched to, never stacked on top of Home.
    if (route == '/customers' || route == '/documents') {
      context.go(route);
      return;
    }
    await context.push(route, extra: extra);
    if (mounted) _load();
  }

  String _money(double value) => '₹${_rupees.format(value.round())}';

  static String _qty(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

  // ==========================================================================
  // Build
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    final company = ref.watch(currentCompanyProvider).value;
    final stats = _stats;

    return Scaffold(
      backgroundColor: Brand.paper,
      body: RefreshIndicator(
        onRefresh: _load,
        color: Brand.navy,
        child: ListView(
          padding: EdgeInsets.zero,
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            _header(company, stats),
            if (company != null && !company.isConfigured) _setupBanner(company),
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 60),
                child: Center(child: CircularProgressIndicator(color: Brand.navy)),
              )
            else if (stats != null) ...[
              _moneyTiles(stats),
              _todayTasks(stats),
            ],
            // One remotely-published offer, or nothing at all (no gap).
            PromoBanner(
              subscriptionStatus: _subscription?.status,
              subscriptionActive: _isSubscriptionActive,
            ),
            _actionGrid(),
            _documentGrid(),
            if (_subscription != null) _subscriptionStrip(),
            if (_supportSettings != null) _supportCard(_supportSettings!),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  // ==========================================================================
  // Header: who we are, and the godown map
  // ==========================================================================

  Widget _header(CompanyModel? company, DashboardStats? stats) {
    final top = MediaQuery.of(context).padding.top;
    final name = (company?.companyName ?? '').trim();
    final appId = (company?.companyCode ?? '').trim();
    final city = (company?.city ?? '').trim();
    final subtitle = [
      if (city.isNotEmpty) city,
      if (appId.isNotEmpty) 'ID $appId',
    ].join('  ·  ');

    return Container(
      padding: EdgeInsets.fromLTRB(20, top + 14, 20, 24),
      decoration: const BoxDecoration(
        color: Brand.navy,
        borderRadius: BorderRadius.only(
          bottomLeft: Radius.circular(30),
          bottomRight: Radius.circular(30),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _logoBadge(company),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name.isEmpty ? 'Set up your company' : name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      subtitle.isEmpty ? _dayFormat.format(DateTime.now()) : subtitle,
                      style: const TextStyle(
                        color: Brand.inkOnNavyMuted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              _headerIcon(Icons.folder_open_outlined, 'Documents',
                  () => _open('/documents')),
              const SizedBox(width: 8),
              _headerIcon(Icons.settings_outlined, 'Settings',
                  () => _open('/settings')),
            ],
          ),
          const SizedBox(height: 22),
          _godownMap(stats),
        ],
      ),
    );
  }

  Widget _logoBadge(CompanyModel? company) {
    final path = company?.logoPath ?? '';
    return Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        color: path.isEmpty ? Brand.green : Colors.white,
        borderRadius: BorderRadius.circular(13),
      ),
      clipBehavior: Clip.antiAlias,
      padding: EdgeInsets.all(path.isEmpty ? 0 : 4),
      child: path.isEmpty
          ? const Icon(Icons.warehouse_outlined, color: Brand.greenInk, size: 22)
          : Image.file(
              File(path),
              fit: BoxFit.contain,
              errorBuilder: (_, _, _) =>
                  const Icon(Icons.warehouse_outlined, color: Brand.navy, size: 22),
            ),
    );
  }

  Widget _headerIcon(IconData icon, String tooltip, VoidCallback onTap) {
    return Material(
      color: Brand.navySoft,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: SizedBox(
          width: 40,
          height: 40,
          child: Icon(icon, color: Colors.white, size: 20, semanticLabel: tooltip),
        ),
      ),
    );
  }

  /// One square per lot in storage, coloured by how it is doing. The
  /// picture a godown owner has in their head, drawn.
  Widget _godownMap(DashboardStats? stats) {
    final states = stats?.slotStates ?? const <SlotState>[];
    final capacity = stats?.capacity ?? 0;
    final lots = states.where((s) => s != SlotState.empty).length;
    final overdue = states.where((s) => s == SlotState.overdue).length;
    final due = states.where((s) => s == SlotState.billDue).length;

    if (stats != null && lots == 0 && capacity == 0) {
      return InkWell(
        onTap: () => _open('/storage-create'),
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Brand.navySoft,
            borderRadius: BorderRadius.circular(16),
          ),
          child: const Row(
            children: [
              Icon(Icons.add_box_outlined, color: Brand.green),
              SizedBox(width: 12),
              Expanded(
                child: Text(
                  'The godown is empty. Add the first storage entry.',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
              ),
              Icon(Icons.chevron_right, color: Brand.inkOnNavyMuted),
            ],
          ),
        ),
      );
    }

    const shown = 80;
    return InkWell(
      onTap: () => _open('/storage'),
      borderRadius: BorderRadius.circular(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                stats == null ? '—' : '$lots',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 30,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  lots == 1 ? 'lot in storage' : 'lots in storage',
                  style: const TextStyle(
                    color: Brand.inkOnNavyMuted,
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              if (stats != null)
                Text(
                  '${_qty(stats.itemsInStorage)} items',
                  style: const TextStyle(
                    color: Brand.green,
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 4,
            runSpacing: 4,
            children: [
              for (final state in states.take(shown))
                Container(
                  width: 14,
                  height: 10,
                  decoration: BoxDecoration(
                    color: switch (state) {
                      SlotState.overdue => Brand.coral,
                      SlotState.billDue => Brand.amber,
                      SlotState.paidUp => Brand.green,
                      SlotState.empty => Brand.navyLine,
                    },
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              if (states.length > shown)
                Text(
                  '+${states.length - shown}',
                  style: const TextStyle(
                    color: Brand.inkOnNavyMuted,
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              if (stats == null)
                for (var i = 0; i < 20; i++)
                  Container(
                    width: 14,
                    height: 10,
                    decoration: BoxDecoration(
                      color: Brand.navyLine,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 14,
            runSpacing: 4,
            children: [
              _legend(Brand.green, 'Paid up'),
              _legend(Brand.amber, due == 0 ? 'Bill due' : 'Bill due · $due'),
              _legend(Brand.coral, overdue == 0 ? 'Overdue' : 'Overdue · $overdue'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _legend(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2)),
        ),
        const SizedBox(width: 5),
        Text(
          label,
          style: const TextStyle(
            color: Brand.inkOnNavyMuted,
            fontSize: 11.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }

  Widget _setupBanner(CompanyModel company) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
      child: Material(
        color: Brand.amberSoft,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => _open('/company-settings'),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                const Icon(Icons.business_outlined, color: Brand.amberInk),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Finish your company profile',
                        style: TextStyle(
                          color: Brand.amberInk,
                          fontWeight: FontWeight.w800,
                          fontSize: 14,
                        ),
                      ),
                      Text(
                        'Documents still need: ${company.missingFields.join(', ')}',
                        style: const TextStyle(
                          color: Brand.amberInk,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right, color: Brand.amberInk),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ==========================================================================
  // Money
  // ==========================================================================

  Widget _moneyTiles(DashboardStats stats) {
    final outstanding = stats.totalOutstanding;
    final unpaid = stats.unpaidBills.length;
    final toRaise = stats.rentDue.length;
    final clear = unpaid == 0;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 0),
      child: Column(
        children: [
          _tile(
            color: clear ? Brand.mintSoft : Brand.coralSoft,
            onTap: () => _open('/bills'),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _tileLabel(clear ? 'Outstanding' : 'To collect',
                          clear ? Brand.mintInk : Brand.coralDeep),
                      const SizedBox(height: 2),
                      Text(
                        _money(outstanding),
                        style: TextStyle(
                          color: clear ? Brand.mintInk : Brand.coralInk,
                          fontSize: 30,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.5,
                        ),
                      ),
                    ],
                  ),
                ),
                _tileButton(
                  clear ? 'All paid up' : '$unpaid bill${unpaid == 1 ? '' : 's'}',
                  clear ? Brand.mintInk : Brand.coralDeep,
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _tile(
                  color: Brand.mintSoft,
                  onTap: () => _open('/payments'),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _tileLabel('Received today', Brand.mintInk),
                      const SizedBox(height: 2),
                      Text(
                        _money(stats.collectedToday),
                        style: const TextStyle(
                          color: Brand.mintInk,
                          fontSize: 24,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.5,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _tile(
                  color: Brand.amberSoft,
                  onTap: toRaise == 0
                      ? () => _open('/bills')
                      : () => _open('/bill-create', extra: stats.rentDue.first.id),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _tileLabel('Bills to raise', Brand.amberInk),
                      const SizedBox(height: 2),
                      Text(
                        '$toRaise',
                        style: const TextStyle(
                          color: Brand.amberInk,
                          fontSize: 24,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.5,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _tile({required Color color, required VoidCallback onTap, required Widget child}) {
    return Material(
      color: color,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Padding(padding: const EdgeInsets.fromLTRB(18, 14, 18, 14), child: child),
      ),
    );
  }

  Widget _tileLabel(String text, Color color) => Text(
        text.toUpperCase(),
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.6,
        ),
      );

  Widget _tileButton(String text, Color color) => Container(
        height: 40,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(20)),
        alignment: Alignment.center,
        child: Text(
          text,
          style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w800),
        ),
      );

  // ==========================================================================
  // Today's work
  // ==========================================================================

  /// Only what genuinely needs doing, each with the one tap that does
  /// it. Nothing is listed when the desk is clear.
  Widget _todayTasks(DashboardStats stats) {
    final rows = <Widget>[];

    if (stats.rentDue.isNotEmpty) {
      final n = stats.rentDue.length;
      rows.add(_task(
        icon: Icons.receipt_long_outlined,
        tint: Brand.amberSoft,
        ink: Brand.amberInk,
        title: '$n bill${n == 1 ? '' : 's'} to raise',
        subtitle: stats.rentDue.take(3).map((b) => b.customerName).join(', '),
        action: 'Raise',
        primary: true,
        onTap: () => _open('/bill-create', extra: stats.rentDue.first.id),
      ));
    }

    if (stats.unpaidBills.isNotEmpty) {
      final overdue = stats.overdueBills.length;
      rows.add(_task(
        icon: Icons.currency_rupee,
        tint: Brand.coralSoft,
        ink: Brand.coralDeep,
        title: '${_money(stats.totalOutstanding)} to collect',
        subtitle: '${stats.unpaidBills.length} unpaid'
            '${overdue == 0 ? '' : ' · $overdue overdue'}',
        action: overdue == 0 ? 'Bills' : 'Remind',
        onTap: () => _open(overdue == 0 ? '/bills' : '/notices'),
      ));
    }

    if (stats.pastExpectedEnd.isNotEmpty) {
      final n = stats.pastExpectedEnd.length;
      rows.add(_task(
        icon: Icons.event_busy_outlined,
        tint: Brand.skySoft,
        ink: Brand.skyInk,
        title: '$n past the expected end date',
        subtitle: stats.pastExpectedEnd.take(3).map((b) => b.customerName).join(', '),
        action: 'Open',
        onTap: () => _open('/storage'),
      ));
    }

    if (stats.quotationsAwaitingReply.isNotEmpty) {
      final n = stats.quotationsAwaitingReply.length;
      rows.add(_task(
        icon: Icons.mark_email_unread_outlined,
        tint: Brand.skySoft,
        ink: Brand.skyInk,
        title: '$n quotation${n == 1 ? '' : 's'} awaiting reply',
        subtitle: stats.quotationsAwaitingReply.take(3).map((q) => q.customerName).join(', '),
        action: 'Open',
        onTap: () => _open('/quotations'),
      ));
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionTitle("Today's work", trailing: rows.isEmpty ? null : '${rows.length}'),
          const SizedBox(height: 10),
          if (rows.isEmpty)
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Brand.card,
                border: Border.all(color: Brand.line),
                borderRadius: BorderRadius.circular(18),
              ),
              child: const Row(
                children: [
                  Icon(Icons.check_circle_outline, color: Brand.mintInk),
                  SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'All clear. Bills are raised, payments are in, nothing is overdue.',
                      style: TextStyle(fontWeight: FontWeight.w600, color: Brand.ink),
                    ),
                  ),
                ],
              ),
            )
          else
            for (var i = 0; i < rows.length; i++) ...[
              if (i > 0) const SizedBox(height: 10),
              rows[i],
            ],
        ],
      ),
    );
  }

  Widget _task({
    required IconData icon,
    required Color tint,
    required Color ink,
    required String title,
    required String subtitle,
    required String action,
    required VoidCallback onTap,
    bool primary = false,
  }) {
    return Material(
      color: Brand.card,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
          decoration: BoxDecoration(
            border: Border.all(color: Brand.line),
            borderRadius: BorderRadius.circular(18),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(14)),
                child: Icon(icon, color: ink, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: Brand.ink,
                      ),
                    ),
                    if (subtitle.isNotEmpty)
                      Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: Brand.inkMuted,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                height: 38,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: primary ? Brand.green : Brand.chip,
                  borderRadius: BorderRadius.circular(12),
                ),
                alignment: Alignment.center,
                child: Text(
                  action,
                  style: TextStyle(
                    color: primary ? Brand.greenInk : Brand.navy,
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ==========================================================================
  // What do you want to do?
  // ==========================================================================

  Widget _actionGrid() {
    final actions = <_Action>[
      _Action('Storage', Icons.inventory_2_outlined, Brand.navy, Brand.green,
          () => _open('/storage-create')),
      _Action('Bill', Icons.receipt_long_outlined, Brand.amberSoft, Brand.amberInk,
          () => _open('/bill-create')),
      _Action('Payment', Icons.payments_outlined, Brand.mintSoft, Brand.mintInk,
          () => _open('/payment-create')),
      _Action('Quotation', Icons.request_quote_outlined, Brand.skySoft, Brand.skyInk,
          () => _open('/quotation-create')),
      _Action('Bilty', Icons.local_shipping_outlined, Brand.chip, Brand.navy,
          () => _open('/bilty-create')),
      _Action('Release', Icons.outbox_outlined, Brand.chip, Brand.navy,
          () => _open('/release-create')),
      _Action('Customer', Icons.person_add_alt_1_outlined, Brand.chip, Brand.navy,
          () => _open('/customer-create')),
      _Action('Notice', Icons.mail_outline, Brand.chip, Brand.navy,
          () => _open('/notice-create')),
    ];

    return _grid('What do you want to do?', actions);
  }

  /// Every register the app keeps, on the dashboard itself. These used
  /// to sit behind a "More" sheet - an owner looking for last month's
  /// bills should not have to know that.
  Widget _documentGrid() {
    final documents = <_Action>[
      _Action('Storage records', Icons.inventory_2_outlined, Brand.mintSoft,
          Brand.mintInk, () => _open('/storage')),
      _Action('Customers', Icons.people_outline, Brand.skySoft, Brand.skyInk,
          () => _open('/customers')),
      _Action('Bills', Icons.receipt_long_outlined, Brand.amberSoft, Brand.amberInk,
          () => _open('/bills')),
      _Action('Payments', Icons.payments_outlined, Brand.mintSoft, Brand.mintInk,
          () => _open('/payments')),
      _Action('Quotations', Icons.request_quote_outlined, Brand.skySoft, Brand.skyInk,
          () => _open('/quotations')),
      _Action('Bilty / LR', Icons.local_shipping_outlined, Brand.chip, Brand.navy,
          () => _open('/bilties')),
      _Action('Notices', Icons.mail_outline, Brand.coralSoft, Brand.coralInk,
          () => _open('/notices')),
      _Action('Damage reports', Icons.report_gmailerrorred_outlined, Brand.coralSoft,
          Brand.coralInk, () => _open('/incidents')),
      _Action('Releases', Icons.outbox_outlined, Brand.chip, Brand.navy,
          () => _open('/releases')),
      _Action('Reports', Icons.bar_chart_outlined, Brand.chip, Brand.navy,
          () => _open('/reports')),
      _Action('All documents', Icons.folder_open_outlined, Brand.chip, Brand.navy,
          () => _open('/documents')),
    ];

    // Roomier tiles: these labels are two words, and two lines.
    return _grid('All documents', documents, aspect: 0.70);
  }

  Widget _grid(String title, List<_Action> actions, {double aspect = 0.78}) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionTitle(title),
          const SizedBox(height: 12),
          GridView.count(
            crossAxisCount: 4,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 14,
            crossAxisSpacing: 10,
            childAspectRatio: aspect,
            children: [for (final a in actions) _actionButton(a)],
          ),
        ],
      ),
    );
  }

  Widget _actionButton(_Action action) {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: action.onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 60,
            height: 60,
            decoration: BoxDecoration(
              color: action.fill,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Icon(action.icon, color: action.ink, size: 26),
          ),
          const SizedBox(height: 7),
          Text(
            action.label,
            maxLines: 2,
            textAlign: TextAlign.center,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w800,
              color: Brand.ink,
              height: 1.15,
            ),
          ),
        ],
      ),
    );
  }

  // ==========================================================================
  // Subscription and support
  // ==========================================================================

  Widget _subscriptionStrip() {
    final subscription = _subscription!;
    final status = subscription.status;
    final showExpiryWarning = _isExpiringSoon && _daysUntilExpiry != null;
    final healthy = status == SubscriptionStatus.active && !showExpiryWarning;

    String message;
    if (status == SubscriptionStatus.expired) {
      message = 'Your subscription has expired - renew it to keep printing.';
    } else if (status == SubscriptionStatus.limited) {
      message = 'Subscribe to make unlimited documents.';
    } else if (showExpiryWarning) {
      final days = _daysUntilExpiry!;
      message = days <= 0
          ? 'Your subscription expires today - renew now.'
          : 'Expires in $days day${days == 1 ? '' : 's'} - renew soon.';
    } else if (healthy) {
      message = 'Subscription active.';
    } else {
      message = 'Limited access - subscribe for unlimited documents.';
    }

    final active = _isSubscriptionActive ?? false;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 0),
      child: Material(
        color: healthy ? Brand.card : Brand.coralSoft,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => _open('/subscription'),
          child: Container(
            padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
            decoration: BoxDecoration(
              border: Border.all(color: healthy ? Brand.line : Colors.transparent),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Row(
              children: [
                Icon(
                  active ? Icons.verified_outlined : Icons.workspace_premium_outlined,
                  color: healthy ? Brand.mintInk : Brand.coralDeep,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    message,
                    style: TextStyle(
                      color: healthy ? Brand.ink : Brand.coralInk,
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  healthy ? 'Details' : 'See plans',
                  style: TextStyle(
                    color: healthy ? Brand.navy : Brand.coralDeep,
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Icon(Icons.chevron_right,
                    size: 18, color: healthy ? Brand.navy : Brand.coralDeep),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// The app owner's support contact, from the Super Admin's own
  /// settings - never a per-company number, never invented.
  Widget _supportCard(SubscriptionSettingsModel settings) {
    final whatsapp = settings.whatsappNumber.isNotEmpty
        ? settings.whatsappNumber
        : settings.supportPhoneNumber;
    final call = settings.supportPhoneNumber;
    if (whatsapp.isEmpty && call.isEmpty) return const SizedBox.shrink();

    final company = ref.read(currentCompanyProvider).value;
    final appId = company?.companyCode ?? '';

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
      child: Row(
        children: [
          if (call.isNotEmpty)
            Expanded(
              child: _supportButton(
                icon: const Icon(Icons.call_outlined, color: Brand.navy, size: 20),
                label: 'Call support',
                onTap: () => ContactLauncher.call(call),
              ),
            ),
          if (call.isNotEmpty && whatsapp.isNotEmpty) const SizedBox(width: 10),
          if (whatsapp.isNotEmpty)
            Expanded(
              child: _supportButton(
                icon: Image.asset('assets/images/whatsapp_icon.png', width: 20, height: 20),
                label: 'WhatsApp',
                onTap: () => ContactLauncher.openWhatsAppWithChoice(
                  context,
                  whatsapp,
                  message: 'Hello StorageBill Pro,\n\nI need some help.'
                      '${appId.isEmpty ? '' : '\n\nMy App ID: $appId'}',
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _supportButton({
    required Widget icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Brand.card,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          height: 48,
          decoration: BoxDecoration(
            border: Border.all(color: Brand.line),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              icon,
              const SizedBox(width: 8),
              Text(label,
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, fontSize: 13, color: Brand.ink)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sectionTitle(String text, {String? trailing}) {
    return Row(
      children: [
        Expanded(
          child: Text(
            text,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Brand.navy),
          ),
        ),
        if (trailing != null)
          Text(
            trailing,
            style: const TextStyle(
                fontSize: 13, fontWeight: FontWeight.w800, color: Brand.inkMuted),
          ),
      ],
    );
  }
}

class _Action {
  final String label;
  final IconData icon;
  final Color fill;
  final Color ink;
  final VoidCallback onTap;

  const _Action(this.label, this.icon, this.fill, this.ink, this.onTap);
}
