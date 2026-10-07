import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/subscription/subscription_status.dart';
import '../../../core/subscription/super_admin_scope.dart';
import '../models/subscription_model.dart';
import '../repositories/subscription_repository.dart';
import '../repositories/subscription_settings_repository.dart';
import '../services/app_user_presence_service.dart';
import '../utils/signup_counts.dart';

/// Section 14's Super Admin Dashboard.
///
/// WHERE THE FIGURES COME FROM: the company tiles are genuinely
/// cross-company, read from Firestore through SubscriptionRepository.
/// getAllAcrossCompanies().
///
/// SECURITY NOTE: the router's own redirect guard (AppRouter's
/// _superAdminRoutes) is the primary protection against a normal user
/// reaching this screen at all. The _isSuperAdmin check below is a
/// second, independent layer - this screen never assumes it was only
/// ever reached through the router.
class SuperAdminDashboardScreen extends StatefulWidget {
  const SuperAdminDashboardScreen({super.key});

  @override
  State<SuperAdminDashboardScreen> createState() =>
      _SuperAdminDashboardScreenState();
}

class _SuperAdminDashboardScreenState
    extends State<SuperAdminDashboardScreen> {
  static final _joinedFormat = DateFormat('dd MMM yyyy');

  List<SubscriptionModel> _subscriptions = [];

  /// Null when the list could not be read - shown as unknown, not 0.
  List<AppUserRecord>? _appUsers;

  int _warningDays = 30;
  bool _loading = true;
  bool _isSuperAdmin = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    await SuperAdminScope.refresh();

    if (!SuperAdminScope.isSuperAdmin) {
      if (!mounted) return;
      setState(() {
        _isSuperAdmin = false;
        _loading = false;
      });
      return;
    }

    final subscriptions =
        await SubscriptionRepository.instance.getAllAcrossCompanies();
    List<AppUserRecord>? appUsers;
    try {
      appUsers = await AppUserPresenceService.instance.getAll();
    } catch (error) {
      debugPrint('Sign-in records not read: $error');
    }
    final settings = await SubscriptionSettingsRepository.instance.get();
    final warning = settings.expiryWarningDays;

    if (!mounted) return;

    setState(() {
      _subscriptions = subscriptions;
      _appUsers = appUsers;
      if (warning.isNotEmpty) {
        _warningDays = warning.reduce((a, b) => a > b ? a : b);
      }
      _isSuperAdmin = true;
      _loading = false;
    });
  }

  // From expiryDate, not only the stored status: a lapsed record keeps
  // status ACTIVE in the cloud (only a Super Admin may change a status),
  // and EXPIRING_SOON is never stored at all.
  bool _isLive(SubscriptionModel s) =>
      s.status.grantsFullAccess && !s.hasLapsed;

  int get _activeCount => _subscriptions.where(_isLive).length;

  int get _trialCount => _subscriptions
      .where((s) => s.status == SubscriptionStatus.limited)
      .length;

  int get _expiredCount => _subscriptions
      .where((s) =>
          s.status == SubscriptionStatus.expired ||
          (s.status.grantsFullAccess && s.hasLapsed))
      .length;

  /// Live, with the last day within the largest expiry-warning window.
  int get _expiringSoonCount {
    final today = DateTime.now();
    final start = DateTime(today.year, today.month, today.day);
    return _subscriptions.where((s) {
      final last = s.expiresOn;
      if (!_isLive(s) || last == null) return false;
      return last.difference(start).inDays <= _warningDays;
    }).length;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/dashboard'),
        ),
        title: const Text('Super Admin Dashboard'),
        centerTitle: true,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : !_isSuperAdmin
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'This area requires Super Admin access.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // These figures come from getAllAcrossCompanies(),
                  // which reads every company's subscription document
                  // out of Firestore. The banner that used to sit here
                  // said the opposite - that there was no cloud sync
                  // and the numbers were this install's own - which
                  // stopped being true when that method moved to
                  // Firestore, and read as a fault on a screen that was
                  // working correctly.
                  Card(
                    color: Theme.of(context).colorScheme.surfaceContainerHighest,
                    child: const Padding(
                      padding: EdgeInsets.all(12),
                      child: Row(
                        children: [
                          Icon(Icons.cloud_done_outlined, size: 18),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Company figures are live for every company, '
                              'read from the cloud. Pull down to refresh.',
                              style: TextStyle(fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                  const SizedBox(height: 16),

                  _loginsCard(),

                  const SizedBox(height: 16),

                  GridView.count(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisCount: 2,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    childAspectRatio: 1.6,
                    children: [
                      _statTile(
                        'Total Companies',
                        '${_subscriptions.length}',
                      ),
                      _statTile(
                        'Active',
                        '$_activeCount',
                        color: Colors.green,
                      ),
                      _statTile(
                        'Trial / Limited',
                        '$_trialCount',
                        color: Colors.blueGrey,
                      ),
                      _statTile(
                        'Expiring Soon',
                        '$_expiringSoonCount',
                        color: Colors.orange,
                      ),
                      _statTile(
                        'Expired',
                        '$_expiredCount',
                        color: Colors.red,
                      ),
                    ],
                  ),

                  const SizedBox(height: 20),

                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.verified_user),
                      title: const Text('Authorize Subscription'),
                      subtitle: const Text(
                        'Search by mobile number, then authorize/renew/'
                        'extend/suspend/cancel',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/super-admin/authorize'),
                    ),
                  ),

                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.tune),
                      title: const Text('Plans & Settings'),
                      subtitle: const Text(
                        'Pricing, UPI/QR, demo limits, watermark',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/super-admin/settings'),
                    ),
                  ),

                  const SizedBox(height: 20),

                  Text(
                    'Companies',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),

                  if (_subscriptions.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 16),
                      child: Text('No subscription records yet.'),
                    )
                  else
                    for (final subscription in _subscriptions)
                      Card(
                        child: ListTile(
                          // A company that signed in but has not filled
                          // its profile yet has no name - its internal
                          // id told the Super Admin nothing.
                          title: Text(
                            subscription.companyName.isNotEmpty
                                ? subscription.companyName
                                : 'Company name not set yet',
                            style: subscription.companyName.isNotEmpty
                                ? null
                                : const TextStyle(fontStyle: FontStyle.italic),
                          ),
                          subtitle: Text(_companySubtitle(subscription)),
                          onTap: () => context.push(
                            '/super-admin/company-detail',
                            extra: subscription,
                          ),
                        ),
                      ),
                ],
              ),
            ),
    );
  }

  String _companySubtitle(SubscriptionModel subscription) {
    final joined = SignupCounts.joinedOn(subscription);
    return [
      subscription.status.label,
      if (subscription.ownerMobile.isNotEmpty) subscription.ownerMobile,
      if (joined != null) 'Joined ${_joinedFormat.format(joined)}',
    ].join('  ·  ');
  }

  Widget _loginsCard() {
    final users = _appUsers;

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              users == null ? '-' : '${users.length}',
              style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 2),
            Text(
              'Downloaded and logged in',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              users == null
                  ? 'Could not read the login list. Pull down to try again.'
                  : 'Someone who logged in on an older version is counted '
                      'the next time they open the app.',
              style: const TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statTile(String label, String value, {Color? color}) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.shade200),
      ),
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
              color: color,
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
    );
  }
}
