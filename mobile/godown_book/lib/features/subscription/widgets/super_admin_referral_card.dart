import 'package:flutter/material.dart';

import '../../company/services/app_id_counter_service.dart';
import '../models/subscription_model.dart';
import '../repositories/subscription_repository.dart';

/// Super Admin > company details: everything about Refer & Earn for one
/// company - who referred it and whether that bonus was given, whom it
/// referred, the free months it earned - plus the two manual actions:
/// "Give bonus now" and "Add 1 month free".
class SuperAdminReferralCard extends StatefulWidget {
  const SuperAdminReferralCard({
    super.key,
    required this.subscription,
    required this.onChanged,
  });

  final SubscriptionModel subscription;

  /// Called after an action changed a subscription, to reload.
  final VoidCallback onChanged;

  @override
  State<SuperAdminReferralCard> createState() => _SuperAdminReferralCardState();
}

class _SuperAdminReferralCardState extends State<SuperAdminReferralCard> {
  static const _gold = Color(0xffB7791F);
  static const _green = Color(0xff1E9E5A);
  static const _orange = Color(0xffD97706);

  bool _loading = true;
  bool _acting = false;
  SubscriptionModel? _referrer;
  List<SubscriptionModel> _referred = [];

  SubscriptionModel get _sub => widget.subscription;

  String get _appId {
    final code = _sub.companyCode.trim();
    return AppIdCounterService.isAssigned(code) ? code : '';
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant SuperAdminReferralCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.subscription != widget.subscription) _load();
  }

  Future<void> _load() async {
    final repo = SubscriptionRepository.instance;
    SubscriptionModel? referrer;
    var referred = <SubscriptionModel>[];
    try {
      if (_sub.referredBy.isNotEmpty) {
        referrer = await repo.getByCompanyCode(_sub.referredBy);
      }
      if (_appId.isNotEmpty) referred = await repo.getReferredBy(_appId);
    } catch (_) {
      // Offline: the card still shows what the subscription itself holds.
    }
    if (!mounted) return;
    setState(() {
      _referrer = referrer;
      _referred = referred;
      _loading = false;
    });
  }

  Future<void> _run(Future<String> Function() action) async {
    setState(() => _acting = true);
    String message;
    try {
      message = await action();
    } catch (e) {
      message = e is StateError ? e.message : '$e';
    }
    if (!mounted) return;
    setState(() => _acting = false);
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(Icons.card_giftcard, color: _gold),
        title: const Text('Refer & Earn'),
        content: Text(message),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('OK'),
          ),
        ],
      ),
    );
    widget.onChanged();
  }

  Future<void> _giveBonusNow() async {
    final referrerName = _referrer == null
        ? 'App ID ${_sub.referredBy}'
        : _label(_referrer!);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Give referral bonus?'),
        content: Text(
          '$referrerName gets 1 month free for referring this company. '
          'This can be given only once for this company.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Give 1 month'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _run(() => SubscriptionRepository.instance
        .giveReferralBonusNow(_sub.companyId));
  }

  Future<void> _addFreeMonth() async {
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add 1 month free?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Adds 1 month to ${_label(_sub)}. If no plan is running, '
              'the month is saved and added to their next plan.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reason,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Reason (optional)',
                hintText: 'e.g. Referral, offer, complaint',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Add 1 month'),
          ),
        ],
      ),
    );
    final text = reason.text.trim();
    reason.dispose();
    if (ok != true) return;
    await _run(() => SubscriptionRepository.instance
        .addFreeMonth(_sub.companyId, reason: text));
  }

  static String _label(SubscriptionModel s) {
    final name = s.companyName.trim();
    final code = s.companyCode.trim();
    final id = AppIdCounterService.isAssigned(code) ? 'App ID $code' : '';
    if (name.isEmpty) return id.isEmpty ? s.companyId : id;
    return id.isEmpty ? name : '$name ($id)';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pending = _sub.referredBy.isNotEmpty && !_sub.referralRewarded;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.card_giftcard, color: _gold),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Refer & Earn',
                    style: theme.textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                if (_loading)
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
            const SizedBox(height: 12),

            // Who referred this company.
            Text('Referred by', style: theme.textTheme.labelMedium),
            const SizedBox(height: 4),
            if (_sub.referredBy.isEmpty)
              const Text('Nobody - no referral code entered.',
                  style: TextStyle(color: Colors.grey))
            else ...[
              Text(
                _referrer == null
                    ? 'App ID ${_sub.referredBy}'
                    : _label(_referrer!),
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 6),
              _statusChip(
                pending ? 'Bonus pending' : 'Bonus given',
                pending ? _orange : _green,
              ),
              if (pending) ...[
                const SizedBox(height: 6),
                const Text(
                  'Given automatically when you activate a 1-year (or '
                  'longer) plan for this company. Or give it now:',
                  style: TextStyle(fontSize: 12.5, color: Colors.grey),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _acting ? null : _giveBonusNow,
                    icon: const Icon(Icons.redeem, size: 18),
                    label: const Text('Give bonus now (1 month)'),
                    style: FilledButton.styleFrom(backgroundColor: _gold),
                  ),
                ),
              ],
            ],

            const Divider(height: 26),

            // Whom this company referred.
            Text(
              'Companies referred by this company (${_referred.length})',
              style: theme.textTheme.labelMedium,
            ),
            const SizedBox(height: 4),
            if (_referred.isEmpty)
              Text(
                _loading ? '...' : 'None yet.',
                style: const TextStyle(color: Colors.grey),
              )
            else
              for (final friend in _referred)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(
                    children: [
                      Expanded(child: Text(_label(friend))),
                      _statusChip(
                        friend.referralRewarded ? 'Given' : 'Pending',
                        friend.referralRewarded ? _green : _orange,
                      ),
                    ],
                  ),
                ),
            const SizedBox(height: 8),
            Text(
              'Free months earned: ${_sub.referralCount}'
              '${_sub.referralBonusDays > 0 ? '   •   Saved for next plan: ${_sub.referralBonusDays} days' : ''}',
              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
            ),

            const Divider(height: 26),

            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _acting ? null : _addFreeMonth,
                icon: const Icon(Icons.add_circle_outline, size: 18),
                label: const Text('Add 1 month free'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statusChip(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}
