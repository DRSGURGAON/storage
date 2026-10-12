import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/subscription/document_type.dart';
import '../../../core/subscription/subscription_status.dart';
import '../../../core/subscription/super_admin_scope.dart';
import '../../kyc/widgets/kyc_review_card.dart';
import '../../company/services/app_id_counter_service.dart';
import '../models/subscription_model.dart';
import '../repositories/subscription_repository.dart';
import '../services/company_record_count_service.dart';
import '../widgets/super_admin_referral_card.dart';

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


  /// Null when the record could not be read - shown as unknown, never
  /// as "no free copies used".
  Map<String, int>? _documentUsage;

  /// True once the record has come from the server (a read or the live
  /// listener) - the PDF figures are unknown, not 0, until then.
  bool _liveKnown = false;

  /// Keeps this screen current while it is open: a PDF made on the
  /// company's phone shows here within seconds.
  StreamSubscription<SubscriptionModel?>? _live;

  @override
  void dispose() {
    _live?.cancel();
    super.dispose();
  }

  static Map<String, int> _freeCopiesIn(SubscriptionModel live) => {
        for (final type in DocumentType.all)
          if (SubscriptionRepository.demoGenerationsUsedIn(live, type) > 0)
            type: SubscriptionRepository.demoGenerationsUsedIn(live, type),
      };

  void _watch() {
    if (_live != null) return;
    _live = SubscriptionRepository.instance
        .watchLive(_subscription.companyId)
        .listen((live) {
      if (live == null || !mounted) return;
      setState(() {
        _subscription = live;
        _documentUsage = _freeCopiesIn(live);
        _liveKnown = true;
      });
    }, onError: (Object error) => debugPrint('Live company stopped: $error'));
  }

  CompanyRecordCounts? _recordCounts;
  String? _recordCountError;

  /// Every document the app counts free copies of - a partial list here
  /// would hide exactly the usage a Super Admin is looking for.
  static const _trackedDocumentTypes = DocumentType.all;

  @override
  void initState() {
    super.initState();
    _subscription = widget.subscription;
    _loadDetails();
  }

  /// After a Refer & Earn action: the new expiry and bonus figures.
  Future<void> _reloadSubscription() async {
    try {
      final fresh =
          await SubscriptionRepository.instance.readLive(_subscription.companyId);
      if (!mounted) return;
      setState(() => _subscription = fresh);
    } catch (_) {
      // Offline - the old figures stay on screen.
    }
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

    // One read straight from the server: never this phone's cached or
    // stand-in copy, and never a record created for a company that has
    // none.
    Map<String, int>? usage;
    try {
      final live =
          await SubscriptionRepository.instance.readLive(_subscription.companyId);
      _subscription = live;
      _liveKnown = true;
      usage = _freeCopiesIn(live);
    } catch (_) {
      usage = null;
    }

    // How much this company actually uses the app. Counted from its
    // own cloud backup, so it keeps counting after they subscribe -
    // unlike the free-copy counter above, which stops there.
    CompanyRecordCounts? counts;
    String? countError;
    try {
      counts = await CompanyRecordCountService.instance
          .forOwner(_subscription.ownerUid);
    } catch (error) {
      countError = '$error';
    }

    if (!mounted) return;

    setState(() {
      _documentUsage = usage;
      _recordCounts = counts;
      _recordCountError = countError;
      _isSuperAdmin = true;
      _loadingDetails = false;
    });
    _watch();
  }

  static String _when(String iso) {
    final at = DateTime.tryParse(iso)?.toLocal();
    if (at == null) return iso;
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(at.day)}-${two(at.month)}-${at.year} '
        '${two(at.hour)}:${two(at.minute)}';
  }

  /// Every PDF the company has generated, per document type - counted
  /// on the server, subscribed or not - and the app build it is on.
  Widget _pdfUsageSection(BuildContext context) {
    final pdfs = _subscription.pdfUsed;
    final version = _subscription.appVersion;
    final types = [
      for (final type in DocumentType.all)
        if ((pdfs[type] ?? 0) > 0) type,
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('PDFs Generated', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'Every PDF this company generated (each opening of a PDF '
          'screen), counted on the server - subscribed or not, and offline '
          'ones once the phone is back online. Updates live.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 4),
        Text(
          version.isEmpty
              ? 'App version not reported - the company is on an older app '
                  '(its PDFs are not being counted) or has not opened the '
                  'app online since.'
              : 'Company app: $version',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: version.isEmpty
                ? Colors.orange.shade800
                : Colors.green.shade800,
          ),
        ),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (!_liveKnown)
                  const Text('- (could not be read; check the internet)',
                      style: TextStyle(color: Colors.grey))
                else if (types.isEmpty)
                  const Text('No PDFs yet.',
                      style: TextStyle(color: Colors.grey)),
                for (final type in types)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(_documentTypeLabel(type)),
                        Text('${pdfs[type]}'),
                      ],
                    ),
                  ),
                if (_liveKnown) ...[
                  const Divider(),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Total',
                          style: TextStyle(fontWeight: FontWeight.w700)),
                      Text('${_subscription.pdfTotal}',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                    ],
                  ),
                ],
                if (_subscription.pdfLastAt.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      'Last PDF: ${_when(_subscription.pdfLastAt)}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
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
          textInputAction: TextInputAction.next,
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

  /// How many records this company has actually made, read from its own
  /// cloud backup. Numbers only - no customer name, no amount, nothing
  /// from inside a document.
  Widget _recordCountCard() {
    final counts = _recordCounts;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_recordCountError != null)
              Text(
                'Could not read the counts: $_recordCountError',
                style: const TextStyle(color: Colors.grey),
              )
            else if (counts == null)
              const Text('Counting...', style: TextStyle(color: Colors.grey))
            else if (counts.isEmpty)
              const Text(
                'Nothing backed up yet from this company.',
                style: TextStyle(color: Colors.grey),
              )
            else ...[
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Total documents',
                      style: TextStyle(fontWeight: FontWeight.w700)),
                  Text('${counts.totalDocuments}',
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                ],
              ),
              const Divider(height: 18),
              for (final entry in CompanyRecordCountService.documentTables.entries)
                _countRow(entry.value, counts.documents[entry.key] ?? 0),
              const Divider(height: 18),
              for (final entry in CompanyRecordCountService.masterTables.entries)
                _countRow(entry.value, counts.masters[entry.key] ?? 0),
              const SizedBox(height: 8),
              const Text(
                'Counted from this company\'s cloud backup, which runs '
                'every few minutes while their app is open. Anything made '
                'since their last backup is not counted yet.',
                style: TextStyle(color: Colors.grey, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _countRow(String label, int value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label),
          Text('$value'),
        ],
      ),
    );
  }

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
                        if (AppIdCounterService.isAssigned(
                            _subscription.companyCode))
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

                const SizedBox(height: 12),

                SuperAdminReferralCard(
                  subscription: _subscription,
                  onChanged: _reloadSubscription,
                ),

                const SizedBox(height: 20),

                Text('KYC Documents',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                KycReviewCard(companyId: _subscription.companyId),

                const SizedBox(height: 20),

                _pdfUsageSection(context),

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

                Text('Documents Made', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                _recordCountCard(),

                const SizedBox(height: 20),

                Text('Free Copies Used',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Padding(
                          padding: EdgeInsets.only(bottom: 8),
                          child: Text(
                            'Free copies this company used before '
                            'subscribing. It stops counting once a '
                            'subscription is active.',
                            style: TextStyle(color: Colors.grey, fontSize: 12),
                          ),
                        ),
                        if (_documentUsage == null)
                          const Text(
                              '- (could not be read; check the internet)',
                              style: TextStyle(color: Colors.grey))
                        else if (_documentUsage!.isEmpty)
                          const Text('No free copies used.',
                              style: TextStyle(color: Colors.grey)),
                        for (final type in _trackedDocumentTypes)
                          if ((_documentUsage?[type] ?? 0) > 0)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 2),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(_documentTypeLabel(type)),
                                  Text('${_documentUsage![type]} generated'),
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
