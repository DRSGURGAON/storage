import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/permissions/permission_service.dart';
import '../../../core/subscription/super_admin_scope.dart';
import '../../kyc/widgets/kyc_review_card.dart';
import '../models/subscription_history_model.dart';
import '../models/subscription_model.dart';
import '../models/subscription_plan_model.dart';
import '../repositories/subscription_plan_repository.dart';
import '../repositories/subscription_repository.dart';

/// V1's corrected Super Admin flow (payment is fully off-app): Super
/// Admin searches the customer's registered mobile number (the
/// customer sent their payment screenshot to WhatsApp/phone
/// externally), reviews the company's subscription details, and
/// manually authorizes/renews/extends/suspends/cancels. No
/// PaymentTransaction submission is involved anywhere in this screen -
/// SubscriptionRepository.activate()/suspend()/cancel() are called
/// directly, all of which independently enforce SuperAdminScope.
class SuperAdminAuthorizeScreen extends StatefulWidget {
  const SuperAdminAuthorizeScreen({super.key});

  @override
  State<SuperAdminAuthorizeScreen> createState() =>
      _SuperAdminAuthorizeScreenState();
}

class _SuperAdminAuthorizeScreenState
    extends State<SuperAdminAuthorizeScreen> {
  final _searchController = TextEditingController();

  bool _isSuperAdmin = false;
  bool _loadingAccess = true;
  bool _searching = false;
  bool _searched = false;

  SubscriptionModel? _subscription;
  List<SubscriptionHistoryModel> _history = [];

  @override
  void initState() {
    super.initState();
    _checkAccess();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _checkAccess() async {
    await SuperAdminScope.refresh();

    if (!mounted) return;

    setState(() {
      _isSuperAdmin = SuperAdminScope.isSuperAdmin;
      _loadingAccess = false;
    });
  }

  Future<void> _search() async {
    final query = _searchController.text.trim();

    if (query.isEmpty) return;

    setState(() {
      _searching = true;
      _searched = true;
      _subscription = null;
      _history = [];
    });

    // The query can be either the customer's mobile number or their
    // unique App ID (DRS-xxxx, shown under the company name on their
    // dashboard) - a 10-digit number is tried as a phone first, and
    // anything else (or a phone that matches nothing) is tried as a
    // DRS ID. Both lookups tolerate natural formatting.
    var subscription =
        await SubscriptionRepository.instance.getByMobileNumber(query);
    subscription ??=
        await SubscriptionRepository.instance.getByCompanyCode(query);

    if (subscription == null) {
      if (!mounted) return;
      setState(() => _searching = false);
      return;
    }

    final history = await SubscriptionRepository.instance.getHistory(
      subscription.companyId,
    );

    if (!mounted) return;

    setState(() {
      _subscription = subscription;
      _history = history;
      _searching = false;
    });
  }

  Future<void> _reload() async {
    final subscription = _subscription;
    if (subscription == null) return;

    final refreshed = await SubscriptionRepository.instance
        .getOrCreateForCompany(subscription.companyId);
    final history = await SubscriptionRepository.instance.getHistory(
      subscription.companyId,
    );

    if (!mounted) return;

    setState(() {
      _subscription = refreshed;
      _history = history;
    });
  }

  Future<void> _openAuthorizeDialog({bool isRenewal = false}) async {
    final subscription = _subscription;
    if (subscription == null) return;

    final plans = await SubscriptionPlanRepository.instance.getActivePlans();

    if (!mounted) return;

    final acted = await showDialog<bool>(
      context: context,
      builder: (context) => _AuthorizeDialog(
        subscription: subscription,
        plans: plans,
        isRenewal: isRenewal,
      ),
    );

    if (acted == true) _reload();
  }

  Future<void> _suspendOrCancel({required bool cancel}) async {
    final subscription = _subscription;
    if (subscription == null) return;

    final reasonController = TextEditingController();

    final confirmed = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(cancel ? 'Cancel Subscription' : 'Suspend Subscription'),
        content: TextField(
          controller: reasonController,
          decoration: const InputDecoration(labelText: 'Reason'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(context).pop(reasonController.text.trim()),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );

    if (confirmed == null) return;

    try {
      if (cancel) {
        await SubscriptionRepository.instance.cancel(
          subscription.companyId,
          remarks: confirmed,
        );
      } else {
        await SubscriptionRepository.instance.suspend(
          subscription.companyId,
          remarks: confirmed,
        );
      }

      if (!mounted) return;
      _reload();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop()
              ? context.pop()
              : context.go('/super-admin'),
        ),
        title: const Text('Authorize Subscription'),
        centerTitle: true,
      ),
      body: _loadingAccess
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
              : _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'Search by the customer\'s registered mobile number '
          '(the number they used to send their payment screenshot).',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _searchController,
                decoration: const InputDecoration(
                  labelText: 'Mobile Number or App ID (e.g. 4838)',
                  prefixIcon: Icon(Icons.search),
                ),
                onSubmitted: (_) => _search(),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton(
              onPressed: _searching ? null : _search,
              child: _searching
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Search'),
            ),
          ],
        ),
        const SizedBox(height: 20),
        if (_searched && !_searching && _subscription == null)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(
              child: Text(
                'No company found for this mobile number.',
                textAlign: TextAlign.center,
              ),
            ),
          ),
        if (_subscription != null) _buildResult(context),
      ],
    );
  }

  Widget _buildResult(BuildContext context) {
    final subscription = _subscription!;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  subscription.companyName.isEmpty
                      ? 'Unnamed Company'
                      : subscription.companyName,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                if (subscription.companyCode.isNotEmpty &&
                    subscription.companyCode != 'DRS001')
                  Text(
                    'App ID: ${subscription.companyCode}',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                if (subscription.authorizedSignatoryName.isNotEmpty)
                  Text('Customer: ${subscription.authorizedSignatoryName}'),
                if (subscription.ownerMobile.isNotEmpty)
                  Text('Mobile: ${subscription.ownerMobile}'),
                const Divider(height: 20),
                _row('Status', subscription.status.label),
                _row('Plan', subscription.planId ?? '-'),
                _row('Start Date', subscription.startDate ?? '-'),
                _row('Expiry Date', subscription.expiryDate ?? '-'),
              ],
            ),
          ),
        ),

        const SizedBox(height: 12),

        // The company's KYC documents right where authorization
        // happens - so the Super Admin can check (and approve/reject)
        // KYC before authorizing the subscription.
        Text('KYC Documents', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        KycReviewCard(companyId: subscription.companyId),

        const SizedBox(height: 16),

        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton.icon(
              onPressed: () => _openAuthorizeDialog(isRenewal: false),
              icon: const Icon(Icons.verified),
              label: const Text('AUTHORIZE'),
            ),
            FilledButton.icon(
              onPressed: () => _openAuthorizeDialog(isRenewal: true),
              icon: const Icon(Icons.autorenew),
              label: const Text('RENEW / EXTEND'),
            ),
            OutlinedButton.icon(
              onPressed: () => _suspendOrCancel(cancel: false),
              icon: const Icon(Icons.pause_circle_outline),
              label: const Text('SUSPEND'),
            ),
            OutlinedButton.icon(
              onPressed: () => _suspendOrCancel(cancel: true),
              style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
              icon: const Icon(Icons.cancel_outlined),
              label: const Text('CANCEL'),
            ),
          ],
        ),

        const SizedBox(height: 24),

        if (_history.isNotEmpty) ...[
          Text('Authorization History', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          for (final entry in _history)
            Card(
              child: ListTile(
                title: Text('${entry.planName} • ₹${entry.amount.toStringAsFixed(0)}'),
                subtitle: Text(
                  '${entry.startDate} → ${entry.endDate}'
                  '${entry.remarks.isNotEmpty ? '\n${entry.remarks}' : ''}',
                ),
                isThreeLine: entry.remarks.isNotEmpty,
              ),
            ),
        ],
      ],
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.grey)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

/// The AUTHORIZE dialog - select plan, confirm amount, set start date;
/// expiry is computed automatically by
/// SubscriptionRepository.activate() (Section 21's own renewal-vs-fresh
/// logic already handles both "authorize" and "renew/extend" the same
/// way this dialog serves both).
class _AuthorizeDialog extends StatefulWidget {
  final SubscriptionModel subscription;
  final List<SubscriptionPlanModel> plans;
  final bool isRenewal;

  const _AuthorizeDialog({
    required this.subscription,
    required this.plans,
    required this.isRenewal,
  });

  @override
  State<_AuthorizeDialog> createState() => _AuthorizeDialogState();
}

class _AuthorizeDialogState extends State<_AuthorizeDialog> {
  SubscriptionPlanModel? _selectedPlan;
  final _amountController = TextEditingController();
  DateTime _startDate = DateTime.now();
  final _remarksController = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _amountController.dispose();
    _remarksController.dispose();
    super.dispose();
  }

  void _onPlanSelected(SubscriptionPlanModel? plan) {
    setState(() {
      _selectedPlan = plan;
      if (plan != null) {
        _amountController.text = plan.finalAmount.toStringAsFixed(0);
      }
    });
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _startDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );

    if (picked != null) setState(() => _startDate = picked);
  }

  Future<void> _save() async {
    final plan = _selectedPlan;

    if (plan == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select a plan.')),
      );
      return;
    }

    setState(() => _saving = true);

    try {
      await SubscriptionRepository.instance.activate(
        companyId: widget.subscription.companyId,
        plan: plan,
        paymentReference: null,
        paymentMethod: 'OFF_APP_MANUAL',
        authorizedByMobileNumber:
            PermissionService.currentMobileNumberOverride,
        remarks: _remarksController.text.trim(),
        explicitStartDate: _startDate,
      );

      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.isRenewal ? 'Renew / Extend' : 'Authorize Subscription'),
      content: SizedBox(
        width: double.maxFinite,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DropdownButtonFormField<SubscriptionPlanModel>(
                initialValue: _selectedPlan,
                decoration: const InputDecoration(labelText: 'Plan'),
                items: [
                  for (final plan in widget.plans)
                    DropdownMenuItem(
                      value: plan,
                      child: Text('${plan.name} (${plan.durationMonths}mo)'),
                    ),
                ],
                onChanged: _onPlanSelected,
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _amountController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Payment Amount (₹)'),
              ),
              const SizedBox(height: 12),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Start Date'),
                subtitle: Text(
                  '${_startDate.day.toString().padLeft(2, '0')}/'
                  '${_startDate.month.toString().padLeft(2, '0')}/'
                  '${_startDate.year}',
                ),
                trailing: const Icon(Icons.calendar_today, size: 18),
                onTap: _pickDate,
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _remarksController,
                decoration: const InputDecoration(labelText: 'Admin Remarks'),
                maxLines: 2,
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Save Authorization'),
        ),
      ],
    );
  }
}
