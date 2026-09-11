import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/subscription/document_type.dart';
import '../../../core/subscription/subscription_status.dart';
import '../../../core/subscription/super_admin_scope.dart';
import '../../kyc/widgets/kyc_review_card.dart';
import '../models/subscription_model.dart';
import '../repositories/subscription_repository.dart';

/// Section 19's suspend/cancel actions, reached from
/// SuperAdminDashboardScreen's company list. suspend()/cancel() both
/// enforce SuperAdminScope internally, so this screen's own actions
/// being visible is a UX affordance, not the security boundary.
///
/// Also covers the document's "View company profile" and "View basic
/// document/usage information" actions, reading the denormalized
/// company-profile fields carried on [subscription] itself (see
/// SubscriptionModel's own doc comment on ownerMobile/gstNumber/
/// authorizedSignatoryName/email/companyCode) rather than
/// CompanyController.instance.getCompany() - that call always returns
/// the SUPER ADMIN'S OWN device-local company regardless of which
/// company's subscription is being viewed, which was a genuine bug:
/// every company's detail screen silently showed the Super Admin's
/// own profile fields instead of the company actually being viewed.
///
/// "View company users" is NOT shown here - Users/Roles remain purely
/// local-SQLite, never synced to Firestore (see firestore.rules' own
/// doc comment on this architectural gap), so there is genuinely no
/// way for a Super Admin's device to see another company's user list
/// today; showing UserRepository.instance.getAll() here would repeat
/// the exact same bug this screen was just fixed for. See this
/// screen's own Company Users section for the honest message shown
/// instead.
///
/// "Deactivate Company" is not a separate action: cancel() already
/// achieves the same effect (SubscriptionStatus.cancelled is excluded
/// from grantsFullAccess) - only its label was clarified below, not a
/// second mechanism built.
///
/// SECURITY NOTE: the router's own redirect guard (AppRouter's
/// _superAdminRoutes) is the primary protection against a normal user
/// reaching this screen. The _isSuperAdmin check below is a second,
/// independent layer over the actual company profile/subscription/
/// users data shown here.
class SuperAdminCompanyDetailScreen extends StatefulWidget {
  final SubscriptionModel subscription;

  const SuperAdminCompanyDetailScreen({super.key, required this.subscription});

  @override
  State<SuperAdminCompanyDetailScreen> createState() =>
      _SuperAdminCompanyDetailScreenState();
}

class _SuperAdminCompanyDetailScreenState
    extends State<SuperAdminCompanyDetailScreen> {
  late SubscriptionModel _subscription;
  bool _acting = false;
  bool _loadingDetails = true;
  bool _isSuperAdmin = false;


  Map<String, int> _documentUsage = {};

  static const _trackedDocumentTypes = [
    DocumentType.quotation,
    DocumentType.storageReceipt,
    DocumentType.bill,
    DocumentType.moneyReceipt,
  ];

  @override
  void initState() {
    super.initState();
    _subscription = widget.subscription;
    _loadDetails();
  }

  Future<void> _loadDetails() async {
    await SuperAdminScope.refresh();

    if (!SuperAdminScope.isSuperAdmin) {
      if (!mounted) return;
      setState(() {
        _isSuperAdmin = false;
        _loadingDetails = false;
      });
      return;
    }

    final usage = <String, int>{};
    for (final type in _trackedDocumentTypes) {
      usage[type] = await SubscriptionRepository.instance
          .getDemoGenerationsUsed(_subscription.companyId, type);
    }

    if (!mounted) return;

    setState(() {
      _documentUsage = usage;
      _isSuperAdmin = true;
      _loadingDetails = false;
    });
  }

  Future<void> _suspend() async {
    final reason = await _promptReason('Suspend Subscription');
    if (reason == null) return;

    setState(() => _acting = true);

    try {
      await SubscriptionRepository.instance.suspend(
        _subscription.companyId,
        remarks: reason,
      );

      if (!mounted) return;
      setState(() {
        _subscription = _subscription.copyWith(
          status: SubscriptionStatus.suspended,
        );
        _acting = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _acting = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _cancel() async {
    final reason = await _promptReason('Deactivate Company');
    if (reason == null) return;

    setState(() => _acting = true);

    try {
      await SubscriptionRepository.instance.cancel(
        _subscription.companyId,
        remarks: reason,
      );

      if (!mounted) return;
      setState(() {
        _subscription = _subscription.copyWith(
          status: SubscriptionStatus.cancelled,
        );
        _acting = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _acting = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<String?> _promptReason(String title) async {
    final controller = TextEditingController();

    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(labelText: 'Reason'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
  }

  String _documentTypeLabel(String type) => DocumentType.label(type);

  @override
  Widget build(BuildContext context) {
    final canAct = _subscription.status != SubscriptionStatus.cancelled;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        title: const Text('Company Subscription'),
        centerTitle: true,
      ),
      body: _loadingDetails
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
              : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _subscription.companyName.isEmpty
                              ? 'Unnamed Company'
                              : _subscription.companyName,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        if (_subscription.companyCode.isNotEmpty &&
                            _subscription.companyCode != 'DRS001')
                          Text(
                            'Customer ID: ${_subscription.companyCode}',
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              color: Color(0xff1F3864),
                            ),
                          ),
                        if (_subscription.authorizedSignatoryName.isNotEmpty)
                          Text(
                            'Owner: ${_subscription.authorizedSignatoryName}',
                          ),
                        if (_subscription.ownerMobile.isNotEmpty)
                          Text('Mobile: ${_subscription.ownerMobile}'),
                        if (_subscription.email.isNotEmpty)
                          Text('Email: ${_subscription.email}'),
                        if (_subscription.gstNumber.isNotEmpty)
                          Text('GSTIN: ${_subscription.gstNumber}'),
                        if (_subscription.companyName.isEmpty &&
                            _subscription.ownerMobile.isEmpty &&
                            _subscription.gstNumber.isEmpty)
                          const Padding(
                            padding: EdgeInsets.only(top: 4),
                            child: Text(
                              'Profile details will appear once this '
                              'company opens the app online.',
                              style: TextStyle(
                                color: Colors.grey,
                                fontStyle: FontStyle.italic,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),

                Card(
                  child: ListTile(
                    title: Text(_subscription.status.label),
                    subtitle: Text(
                      _subscription.expiryDate != null
                          ? 'Expires: ${_subscription.expiryDate}'
                          : 'No active plan',
                    ),
                  ),
                ),

                const SizedBox(height: 20),

                Text('KYC Documents',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                KycReviewCard(companyId: _subscription.companyId),

                const SizedBox(height: 20),

                Text('Company Users', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    'User lists are still device-local and not yet synced '
                    'across companies - this company\'s Users & Roles are '
                    'only visible from that company\'s own device.',
                    style: TextStyle(color: Colors.grey),
                  ),
                ),

                const SizedBox(height: 20),

                Text('Document Usage', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (final type in _trackedDocumentTypes)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 2),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(_documentTypeLabel(type)),
                                Text('${_documentUsage[type] ?? 0} generated'),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 20),

                if (canAct) ...[
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: OutlinedButton(
                      onPressed: _acting ? null : _suspend,
                      child: const Text('Suspend Subscription'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: OutlinedButton(
                      onPressed: _acting ? null : _cancel,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.red,
                      ),
                      child: const Text('Deactivate Company'),
                    ),
                  ),
                ] else
                  const Text('This company has already been deactivated.'),
              ],
            ),
    );
  }
}
