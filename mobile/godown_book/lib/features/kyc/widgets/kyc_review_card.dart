import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../models/kyc_submission_model.dart';
import '../repositories/kyc_repository.dart';

/// The Super Admin's KYC review card for one company - status, tap to
/// view each document (pinch-zoom), Approve / Reject for pending
/// submissions. Loads its own data from kycSubmissions/{companyId},
/// so any Super Admin screen can drop it in with just the companyId
/// (used by both the Authorize Subscription search screen and the
/// company detail screen).
class KycReviewCard extends StatefulWidget {
  final String companyId;

  const KycReviewCard({super.key, required this.companyId});

  @override
  State<KycReviewCard> createState() => _KycReviewCardState();
}

class _KycReviewCardState extends State<KycReviewCard> {
  KycReview? _kyc;
  bool _loading = true;
  bool _acting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(KycReviewCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.companyId != widget.companyId) {
      _loading = true;
      _load();
    }
  }

  Future<void> _load() async {
    final kyc = await KycRepository.instance.getForReview(widget.companyId);

    if (!mounted) return;

    setState(() {
      _kyc = kyc;
      _loading = false;
    });
  }

  Future<void> _review({required bool approve}) async {
    if (_acting) return;

    String reason = '';
    if (!approve) {
      final controller = TextEditingController();
      final entered = await showDialog<String>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Reject KYC'),
          content: TextField(
            controller: controller,
            decoration: const InputDecoration(labelText: 'Reason'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () =>
                  Navigator.of(dialogContext).pop(controller.text.trim()),
              child: const Text('Confirm'),
            ),
          ],
        ),
      );
      if (entered == null || entered.isEmpty) return;
      reason = entered;
    }

    setState(() => _acting = true);

    try {
      await KycRepository.instance.review(
        widget.companyId,
        approve: approve,
        rejectionReason: reason,
      );

      await _load();

      if (!mounted) return;

      setState(() => _acting = false);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(approve ? 'KYC approved.' : 'KYC rejected.')),
      );
    } catch (e) {
      if (!mounted) return;

      setState(() => _acting = false);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not update KYC: $e')),
      );
    }
  }

  void _viewImage(String title, Uint8List? bytes) {
    if (bytes == null) return;

    showDialog<void>(
      context: context,
      builder: (dialogContext) => Dialog(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                title,
                style: Theme.of(dialogContext).textTheme.titleMedium,
              ),
            ),
            Flexible(
              child: InteractiveViewer(
                child: Image.memory(bytes, fit: BoxFit.contain),
              ),
            ),
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Close'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Center(
            child: SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ),
        ),
      );
    }

    final kyc = _kyc;

    if (kyc == null) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(12),
          child: Text(
            'No KYC submitted yet (or the server is unreachable).',
            style: TextStyle(color: Colors.grey),
          ),
        ),
      );
    }

    final statusColor = switch (kyc.status) {
      KycStatus.approved => Colors.green,
      KycStatus.rejected => Colors.red,
      _ => Colors.orange,
    };

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.verified_user_outlined, color: statusColor),
                const SizedBox(width: 8),
                Text(
                  KycStatus.label(kyc.status),
                  style: TextStyle(
                    color: statusColor,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            if (kyc.status == KycStatus.rejected &&
                kyc.rejectionReason.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('Reason: ${kyc.rejectionReason}'),
              ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: kyc.panImage == null
                        ? null
                        : () => _viewImage('PAN Card', kyc.panImage),
                    icon: const Icon(Icons.image_outlined, size: 18),
                    label: const Text('PAN Card'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: kyc.secondImage == null
                        ? null
                        : () => _viewImage(
                              kyc.secondDocType.isEmpty
                                  ? 'Second ID'
                                  : kyc.secondDocType,
                              kyc.secondImage,
                            ),
                    icon: const Icon(Icons.image_outlined, size: 18),
                    label: Text(
                      kyc.secondDocType.isEmpty
                          ? 'Second ID'
                          : kyc.secondDocType,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
            ),
            if (kyc.status == KycStatus.pending) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed:
                          _acting ? null : () => _review(approve: true),
                      icon: const Icon(Icons.check, size: 18),
                      label: const Text('Approve'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed:
                          _acting ? null : () => _review(approve: false),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.red,
                      ),
                      icon: const Icon(Icons.close, size: 18),
                      label: const Text('Reject'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
