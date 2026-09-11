import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/subscription/subscription_status.dart';
import '../../../core/subscription/super_admin_scope.dart';
import '../models/payment_transaction_model.dart';
import '../models/subscription_model.dart';
import '../repositories/payment_transaction_repository.dart';
import '../repositories/subscription_repository.dart';

/// Section 14's Super Admin Dashboard.
///
/// IMPORTANT ARCHITECTURAL LIMITATION (Option 3, explicitly confirmed):
/// this app has no backend/cloud-sync layer - each device install has
/// its own local SQLite database, and CompanyDao's own single-row
/// pattern means exactly one company's data can ever exist in it. So
/// "TOTAL COMPANIES" below is always the current install's own single
/// company (0 or 1), not a genuinely cross-company count - the
/// repository calls underneath this screen are written the way a real
/// multi-company query would be (see SubscriptionRepository.
/// getAllAcrossCompanies()'s own doc comment), ready for a future
/// central backend without needing this screen to change, but that
/// backend does not exist yet.
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
  List<SubscriptionModel> _subscriptions = [];
  List<PaymentTransactionModel> _pendingPayments = [];
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
    final pending =
        await PaymentTransactionRepository.instance.getAllUnderReview();

    if (!mounted) return;

    setState(() {
      _subscriptions = subscriptions;
      _pendingPayments = pending;
      _isSuperAdmin = true;
      _loading = false;
    });
  }

  int get _activeCount =>
      _subscriptions.where((s) => s.status.grantsFullAccess).length;

  int get _trialCount => _subscriptions
      .where((s) => s.status == SubscriptionStatus.limited)
      .length;

  int get _expiredCount => _subscriptions
      .where((s) => s.status == SubscriptionStatus.expired)
      .length;

  int get _expiringSoonCount => _subscriptions
      .where((s) => s.status == SubscriptionStatus.expiringSoon)
      .length;

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
                  Card(
                    color: Theme.of(context).colorScheme.surfaceContainerHighest,
                    child: const Padding(
                      padding: EdgeInsets.all(12),
                      child: Row(
                        children: [
                          Icon(Icons.info_outline, size: 18),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'This device install has no cloud sync yet, '
                              'so figures below reflect only this '
                              'company. A future backend can connect '
                              'multiple companies to this same view.',
                              style: TextStyle(fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

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
                      _statTile(
                        'Pending Payments',
                        '${_pendingPayments.length}',
                        color: Colors.orange,
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
                      leading: const Icon(Icons.pending_actions),
                      title: const Text('Payment Verification Queue'),
                      subtitle: Text(
                        'Optional internal reference • '
                        '${_pendingPayments.length} payment'
                        '${_pendingPayments.length == 1 ? '' : 's'} awaiting review',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () =>
                          context.push('/super-admin/payment-queue'),
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
                          title: Text(
                            subscription.companyName.isNotEmpty
                                ? subscription.companyName
                                : subscription.companyId,
                          ),
                          subtitle: Text(subscription.status.label),
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
