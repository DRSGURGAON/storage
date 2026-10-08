import 'package:flutter/material.dart';

import '../../company/services/app_id_counter_service.dart';
import '../models/subscription_model.dart';
import '../models/subscription_plan_model.dart';
import '../repositories/subscription_repository.dart';

/// Super Admin verifies a referral before any bonus is given: shows the
/// referred company and the company whose App ID it entered, with names
/// and mobile numbers so the claim can be confirmed by a call, then
/// Approve (referrer gets 1 month), Not genuine (no bonus, logged) or
/// Decide later (stays pending).
class ReferralReviewDialog extends StatefulWidget {
  const ReferralReviewDialog._({required this.friend, this.plan});

  final SubscriptionModel friend;

  /// The plan just activated, when shown right after an activation.
  final SubscriptionPlanModel? plan;

  /// Opens the review when [friend] has a referral still pending.
  /// Returns true when a decision was saved.
  static Future<bool> showIfPending(
    BuildContext context,
    SubscriptionModel friend, {
    SubscriptionPlanModel? plan,
  }) async {
    if (!friend.referralPending) return false;
    final decided = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => ReferralReviewDialog._(friend: friend, plan: plan),
    );
    return decided ?? false;
  }

  @override
  State<ReferralReviewDialog> createState() => _ReferralReviewDialogState();
}

class _ReferralReviewDialogState extends State<ReferralReviewDialog> {
  static const _gold = Color(0xffB7791F);
  static const _muted = Color(0xff6B7685);

  final _reason = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  bool _rejecting = false;
  SubscriptionModel? _referrer;
  String? _error;

  SubscriptionModel get _friend => widget.friend;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    SubscriptionModel? referrer;
    String? error;
    try {
      referrer =
          await SubscriptionRepository.instance.getByCompanyCode(_friend.referredBy);
    } catch (_) {
      error = 'Could not load the referrer. Check the internet connection.';
    }
    if (!mounted) return;
    setState(() {
      _referrer = referrer;
      _error = error;
      _loading = false;
    });
  }

  Future<void> _approve() async {
    setState(() => _saving = true);
    try {
      final message = await SubscriptionRepository.instance
          .giveReferralBonusNow(_friend.companyId);
      if (!mounted) return;
      _done('Referral approved. $message');
    } catch (e) {
      _fail(e);
    }
  }

  Future<void> _reject() async {
    if (!_rejecting) {
      setState(() => _rejecting = true);
      return;
    }
    setState(() => _saving = true);
    try {
      await SubscriptionRepository.instance
          .rejectReferral(_friend.companyId, reason: _reason.text.trim());
      if (!mounted) return;
      _done('Referral marked as not genuine. No bonus has been given.');
    } catch (e) {
      _fail(e);
    }
  }

  void _done(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), duration: const Duration(seconds: 6)),
    );
    Navigator.of(context).pop(true);
  }

  void _fail(Object e) {
    if (!mounted) return;
    setState(() {
      _saving = false;
      _error = e is StateError ? e.message : '$e';
    });
  }

  static String _appId(SubscriptionModel s) {
    final code = s.companyCode.trim();
    return AppIdCounterService.isAssigned(code) ? code : 'Not assigned yet';
  }

  @override
  Widget build(BuildContext context) {
    final planMonths = widget.plan?.durationMonths;
    final shortPlan = planMonths != null &&
        planMonths < SubscriptionRepository.referralMinPlanMonths;

    return AlertDialog(
      icon: const Icon(Icons.verified_user_outlined, color: _gold),
      title: const Text('Verify Referral'),
      content: SizedBox(
        width: double.maxFinite,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Please confirm this referral with the referring company '
                'before approving. The bonus can be given only once.',
                style: TextStyle(fontSize: 13, color: _muted),
              ),
              const SizedBox(height: 14),
              _party(
                'New customer',
                _friend.companyName,
                _appId(_friend),
                _friend.authorizedSignatoryName,
                _friend.ownerMobile,
              ),
              const SizedBox(height: 10),
              if (_loading)
                const Padding(
                  padding: EdgeInsets.all(12),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_referrer == null && _error == null)
                _notice(
                  'No company is registered with App ID '
                  '${_friend.referredBy}. This referral cannot be approved.',
                  Colors.red,
                )
              else if (_referrer != null)
                _party(
                  'Referred by',
                  _referrer!.companyName,
                  _appId(_referrer!),
                  _referrer!.authorizedSignatoryName,
                  _referrer!.ownerMobile,
                  status: _referrer!.status.label,
                ),
              if (shortPlan) ...[
                const SizedBox(height: 10),
                _notice(
                  'The plan activated ($planMonths months) is '
                  'shorter than 1 year. Under the offer, the referral bonus '
                  'applies to plans of 1 year or more.',
                  Colors.orange.shade800,
                ),
              ],
              if (_rejecting) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _reason,
                  autofocus: true,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    labelText: 'Reason (optional)',
                    hintText: 'e.g. Referrer does not know this customer',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, style: const TextStyle(color: Colors.red)),
              ],
            ],
          ),
        ),
      ),
      actions: [
        SizedBox(
          width: double.infinity,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (!_rejecting)
                FilledButton.icon(
                  onPressed: _saving || _loading || _referrer == null
                      ? null
                      : _approve,
                  style: FilledButton.styleFrom(
                    backgroundColor: _gold,
                    minimumSize: const Size.fromHeight(46),
                  ),
                  icon: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.check_circle_outline, size: 18),
                  label: const Text('Approve - give 1 month free'),
                ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _saving || _loading ? null : _reject,
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.red,
                  side: const BorderSide(color: Colors.red),
                  minimumSize: const Size.fromHeight(46),
                ),
                icon: const Icon(Icons.block, size: 18),
                label: Text(
                  _rejecting ? 'Confirm: not genuine' : 'Not genuine - reject',
                ),
              ),
              const SizedBox(height: 4),
              TextButton(
                onPressed:
                    _saving ? null : () => Navigator.of(context).pop(false),
                child: Text(_rejecting ? 'Cancel' : 'Decide later'),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _party(
    String title,
    String name,
    String appId,
    String owner,
    String mobile, {
    String? status,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xffF6F7F9),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xffE3E6EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title.toUpperCase(),
            style: const TextStyle(
              fontSize: 10.5,
              letterSpacing: 0.8,
              fontWeight: FontWeight.w700,
              color: _muted,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            name.trim().isEmpty ? 'Company name not set' : name.trim(),
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 2),
          Text('App ID: $appId'),
          if (owner.trim().isNotEmpty) Text('Owner: ${owner.trim()}'),
          Text('Mobile: ${mobile.trim().isEmpty ? 'Not available' : mobile.trim()}'),
          if (status != null) Text('Subscription: $status'),
        ],
      ),
    );
  }

  Widget _notice(String text, Color color) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(text, style: TextStyle(fontSize: 12.5, color: color)),
    );
  }
}
