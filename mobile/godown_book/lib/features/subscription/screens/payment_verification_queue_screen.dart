import 'dart:io';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/permissions/permission_service.dart';
import '../../../core/subscription/super_admin_scope.dart';
import '../data/payment_proof_dao.dart';
import '../models/payment_proof_model.dart';
import '../models/payment_transaction_model.dart';
import '../repositories/payment_transaction_repository.dart';
import '../repositories/subscription_plan_repository.dart';
import '../repositories/subscription_repository.dart';
import '../widgets/referral_review_dialog.dart';

/// Every payment proof a customer has submitted for Super Admin
/// review, oldest first. Tapping one opens the review dialog, which
/// shows the screenshot alongside the UTR and amount so the admin can
/// check it against their own bank statement before activating the
/// subscription - or reject it with a reason, which drops the company
/// back to Limited.
///
/// Guarded at both the router (redirect for non-admins - see
/// app_router.dart's super-admin route list) and the repository layer
/// (PaymentTransactionRepository.verify()/reject() both call
/// SuperAdminScope internally and throw SuperAdminRequiredException
/// for a non-admin caller), so this screen being reached by any means
/// never grants unauthorised access to the actual actions.
class PaymentVerificationQueueScreen extends StatefulWidget {
  const PaymentVerificationQueueScreen({super.key});

  @override
  State<PaymentVerificationQueueScreen> createState() =>
      _PaymentVerificationQueueScreenState();
}

class _PaymentVerificationQueueScreenState
    extends State<PaymentVerificationQueueScreen> {
  List<PaymentTransactionModel> _pending = [];
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

    final pending =
        await PaymentTransactionRepository.instance.getAllUnderReview();

    if (!mounted) return;

    setState(() {
      _pending = pending;
      _isSuperAdmin = true;
      _loading = false;
    });
  }

  Future<void> _openReview(PaymentTransactionModel transaction) async {
    final acted = await showDialog<bool>(
      context: context,
      builder: (context) => _ReviewDialog(transaction: transaction),
    );

    if (acted == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/super-admin'),
        ),
        title: const Text('Payment Verification Queue'),
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
              : _pending.isEmpty
                  ? const Center(child: Text('No payments awaiting review.'))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: _pending.length,
                        itemBuilder: (context, index) {
                          final transaction = _pending[index];

                          return Card(
                            margin: const EdgeInsets.symmetric(vertical: 4),
                            child: ListTile(
                              leading: const CircleAvatar(
                                child: Icon(Icons.hourglass_top, size: 18),
                              ),
                              title: Text(
                                '${transaction.payerName}  •  ₹'
                                '${transaction.amount.toStringAsFixed(0)}',
                              ),
                              subtitle: Text('UTR: ${transaction.utrNumber}'),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: () => _openReview(transaction),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}

/// Verify (activates the subscription) or reject (returns the company
/// to Limited, with a reason) - the two outcomes a submitted payment
/// can have.
class _ReviewDialog extends StatefulWidget {
  final PaymentTransactionModel transaction;

  const _ReviewDialog({required this.transaction});

  @override
  State<_ReviewDialog> createState() => _ReviewDialogState();
}

class _ReviewDialogState extends State<_ReviewDialog> {
  PaymentProofModel? _proof;
  bool _loadingProof = true;
  bool _acting = false;

  final _rejectionReasonController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadProof();
  }

  @override
  void dispose() {
    _rejectionReasonController.dispose();
    super.dispose();
  }

  Future<void> _loadProof() async {
    final proofId = widget.transaction.proofId;
    final proof =
        proofId == null ? null : await PaymentProofDao.instance.getById(proofId);

    if (!mounted) return;

    setState(() {
      _proof = proof;
      _loadingProof = false;
    });
  }

  Future<void> _verify() async {
    if (_acting) return;

    final plan = await SubscriptionPlanRepository.instance
        .getById(widget.transaction.planId);

    if (plan == null) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('The plan for this payment no longer exists.'),
        ),
      );
      return;
    }

    setState(() => _acting = true);

    try {
      await PaymentTransactionRepository.instance.verify(
        transaction: widget.transaction,
        plan: plan,
        reviewerMobileNumber:
            PermissionService.currentMobileNumberOverride ?? '',
      );

      if (!mounted) return;

      final referral = SubscriptionRepository.instance.lastReferralMessage;
      if (referral.isNotEmpty) {
        await showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            icon: const Icon(Icons.card_giftcard, color: Color(0xffB7791F)),
            title: const Text('Referral'),
            content: Text(referral),
            actions: [
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('OK'),
              ),
            ],
          ),
        );
        if (!mounted) return;
      }

      // Refer & Earn: a pending referral is verified now.
      try {
        final friend = await SubscriptionRepository.instance
            .readLive(widget.transaction.companyId);
        if (mounted) {
          await ReferralReviewDialog.showIfPending(context, friend, plan: plan);
        }
      } catch (_) {
        // Offline: it stays pending in Super Admin > Refer & Earn.
      }
      if (!mounted) return;

      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _acting = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _reject() async {
    if (_acting) return;

    if (_rejectionReasonController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('A rejection reason is required.')),
      );
      return;
    }

    setState(() => _acting = true);

    try {
      await PaymentTransactionRepository.instance.reject(
        transaction: widget.transaction,
        reason: _rejectionReasonController.text.trim(),
        reviewerMobileNumber:
            PermissionService.currentMobileNumberOverride ?? '',
      );

      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _acting = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final transaction = widget.transaction;

    return AlertDialog(
      title: const Text('Review Payment'),
      content: SizedBox(
        width: double.maxFinite,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Payer: ${transaction.payerName}'),
              Text('Amount: ₹${transaction.amount.toStringAsFixed(2)}'),
              Text('UTR: ${transaction.utrNumber}'),
              Text('Date: ${transaction.paymentDate}'),
              if (transaction.remark.isNotEmpty)
                Text('Remark: ${transaction.remark}'),
              const SizedBox(height: 12),
              if (_loadingProof)
                const Center(child: CircularProgressIndicator())
              else if (_proof != null)
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.file(
                    File(_proof!.filePath),
                    height: 220,
                    fit: BoxFit.contain,
                    errorBuilder: (context, error, stackTrace) =>
                        const Text('Screenshot could not be loaded.'),
                  ),
                )
              else
                const Text('No screenshot attached.'),
              const SizedBox(height: 12),
              TextField(
                textCapitalization: TextCapitalization.sentences,
                controller: _rejectionReasonController,
                decoration: const InputDecoration(
                  labelText: 'Rejection reason (required to reject)',
                ),
                maxLines: 2,
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _acting ? null : () => Navigator.of(context).pop(false),
          child: const Text('Close'),
        ),
        OutlinedButton(
          onPressed: _acting ? null : _reject,
          child: const Text('Reject'),
        ),
        FilledButton(
          onPressed: _acting ? null : _verify,
          child: _acting
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Verify & Activate'),
        ),
      ],
    );
  }
}
