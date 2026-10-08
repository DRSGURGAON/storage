import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../company/services/app_id_counter_service.dart';
import '../models/subscription_model.dart';
import '../repositories/subscription_repository.dart';

/// "Refer & Earn" - the same card as Bill N Bilty's: a company's App ID
/// is its referral code. When a company that entered it is activated on
/// a plan of 12 months or more, the referrer gets one month free
/// (given on activation by the Super Admin - see
/// SubscriptionRepository._rewardReferrer).
///
/// Also lets a new company enter the App ID of whoever referred them, once.
class ReferEarnCard extends StatefulWidget {
  const ReferEarnCard({
    super.key,
    required this.subscription,
    required this.onChanged,
  });

  final SubscriptionModel subscription;

  /// Called after the referral code was saved, to reload the screen.
  final VoidCallback onChanged;

  static const playStoreLink =
      'https://play.google.com/store/apps/details?id=com.drs.godownbook';

  /// The invite a company sends to friends.
  static String inviteMessage(String appId) =>
      'Namaste! Main apne godown / storage business ke Bill, Receipt, '
      'Agreement aur stock ka hisaab "StorageBill Pro" app se rakhta hu - '
      'bahut aasaan aur professional hai.\n\n'
      'Download karo: $playStoreLink\n\n'
      'Subscribe karte waqt mera Referral Code (App ID) daalna: $appId';

  @override
  State<ReferEarnCard> createState() => _ReferEarnCardState();
}

class _ReferEarnCardState extends State<ReferEarnCard> {
  final _code = TextEditingController();
  bool _saving = false;
  String? _error;

  static const _gold = Color(0xffB7791F);
  static const _ink = Color(0xff1B2430);
  static const _muted = Color(0xff6B7685);

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _saveCode() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await SubscriptionRepository.instance
          .setReferredBy(widget.subscription.companyId, _code.text);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Referral code saved. Thank you!')),
      );
      widget.onChanged();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e is ArgumentError || e is StateError
          ? '${(e as dynamic).message}'
          : 'Could not save the code. Check your internet and try again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sub = widget.subscription;
    final appId = sub.companyCode.trim();
    final hasAppId = AppIdCounterService.isAssigned(appId);
    final earned = sub.referralCount;

    return Container(
      margin: const EdgeInsets.only(top: 16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xffFFF8E6), Color(0xffFFFDF7)],
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xffF1DDAA)),
      ),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: _gold.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.card_giftcard, color: _gold),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Refer & Earn',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: _ink,
                      ),
                    ),
                    Text(
                      'Get 1 month FREE for every friend who takes a '
                      'plan of 1 year or more',
                      style: TextStyle(fontSize: 12.5, color: _muted),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (hasAppId) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: _gold.withValues(alpha: 0.4),
                        style: BorderStyle.solid,
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Your referral code',
                          style: TextStyle(fontSize: 11, color: _muted),
                        ),
                        Text(
                          appId,
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 2,
                            color: _ink,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                IconButton.outlined(
                  tooltip: 'Copy code',
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: appId));
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Referral code copied')),
                    );
                  },
                  icon: const Icon(Icons.copy, size: 18),
                ),
                const SizedBox(width: 6),
                FilledButton.icon(
                  // WhatsApp opens its own "send to" list with the invite
                  // already typed.
                  onPressed: () => launchUrl(
                    Uri.parse(
                      'https://wa.me/?text='
                      '${Uri.encodeComponent(ReferEarnCard.inviteMessage(appId))}',
                    ),
                    mode: LaunchMode.externalApplication,
                  ),
                  icon: const Icon(Icons.share, size: 18),
                  label: const Text('Invite'),
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xff1FAF55),
                    minimumSize: const Size(0, 52),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
              ],
            ),
            if (earned > 0)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Row(
                  children: [
                    const Icon(Icons.verified, size: 18, color: Color(0xff1E9E5A)),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'You have earned $earned free month${earned == 1 ? '' : 's'}'
                        '${sub.referralBonusDays > 0 ? ' (${sub.referralBonusDays} days added on your next plan)' : ''}',
                        style: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: Color(0xff1E9E5A),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
          const Divider(height: 26),
          if (sub.referredBy.isNotEmpty)
            Row(
              children: [
                const Icon(Icons.how_to_reg, size: 18, color: _muted),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Referred by App ID ${sub.referredBy}',
                    style: const TextStyle(fontSize: 12.5, color: _muted),
                  ),
                ),
              ],
            )
          else ...[
            const Text(
              'Did a friend refer you? Enter their App ID',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: _ink,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    controller: _code,
                    textCapitalization: TextCapitalization.characters,
                    maxLength: 10,
                    decoration: InputDecoration(
                      hintText: 'Friend\'s App ID, e.g. SW1325',
                      counterText: '',
                      errorText: _error,
                      isDense: true,
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                OutlinedButton(
                  onPressed: _saving ? null : _saveCode,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 48),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Apply'),
                ),
              ],
            ),
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'Can be added once. Your friend gets their free month when '
                'your 1-year (or longer) plan is activated.',
                style: TextStyle(fontSize: 11.5, color: _muted),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
