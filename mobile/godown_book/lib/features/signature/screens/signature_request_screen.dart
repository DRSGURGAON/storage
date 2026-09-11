import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../../core/contact/contact_launcher.dart';
import '../models/signature_request_model.dart';
import '../repositories/signature_repository.dart';

/// What the customer will be shown before they sign.
class SignatureRequestArgs {
  final String documentType;
  final String documentId;
  final String documentNo;

  final String customerName;
  final String customerPhone;

  /// The heading on the signing page, e.g. "Storage Agreement".
  final String title;

  /// The few lines of detail above the signature pad.
  final List<SignatureDetail> details;

  /// The terms the customer is agreeing to.
  final String terms;

  const SignatureRequestArgs({
    required this.documentType,
    required this.documentId,
    required this.documentNo,
    required this.customerName,
    required this.customerPhone,
    required this.title,
    required this.details,
    required this.terms,
  });
}

/// Ask the customer to sign from their own phone, and see what came
/// back. The operator sends a link; the customer opens it, reads the
/// document and signs on the screen.
class SignatureRequestScreen extends StatefulWidget {
  final SignatureRequestArgs args;

  const SignatureRequestScreen({super.key, required this.args});

  @override
  State<SignatureRequestScreen> createState() => _SignatureRequestScreenState();
}

class _SignatureRequestScreenState extends State<SignatureRequestScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy, h:mm a');

  List<SignatureRequestModel> _requests = const [];
  bool _loading = true;
  bool _working = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool checkCloud = true}) async {
    final repo = SignatureRepository.instance;
    var requests = await repo.getForDocument(
      widget.args.documentType,
      widget.args.documentId,
    );

    if (checkCloud) {
      final refreshed = <SignatureRequestModel>[];
      for (final request in requests) {
        refreshed.add(request.status == SignatureStatus.pending
            ? await repo.refresh(request)
            : request);
      }
      requests = refreshed;
    }

    if (!mounted) return;
    setState(() {
      _requests = requests;
      _loading = false;
    });
  }

  SignatureRequestModel? get _signed {
    for (final request in _requests) {
      if (request.isSigned) return request;
    }
    return null;
  }

  SignatureRequestModel? get _pending {
    for (final request in _requests) {
      if (request.status == SignatureStatus.pending && !request.hasExpired) {
        return request;
      }
    }
    return null;
  }

  Future<void> _create() async {
    setState(() => _working = true);
    try {
      final request = await SignatureRepository.instance.request(
        documentType: widget.args.documentType,
        documentId: widget.args.documentId,
        documentNo: widget.args.documentNo,
        customerName: widget.args.customerName,
        customerPhone: widget.args.customerPhone,
        title: widget.args.title,
        details: widget.args.details,
        terms: widget.args.terms,
      );

      await _load(checkCloud: false);
      if (!mounted) return;
      setState(() => _working = false);
      _share(request);
    } catch (error) {
      if (!mounted) return;
      setState(() => _working = false);
      showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Could not make the link'),
          content: Text('$error'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('OK'),
            ),
          ],
        ),
      );
    }
  }

  void _share(SignatureRequestModel request) {
    final message = 'Namaste ${request.customerName},\n\n'
        '${widget.args.title}${request.documentNo.isEmpty ? '' : ' ${request.documentNo}'} '
        'ke liye aapka signature chahiye. Neeche wale link ko kholiye, '
        'details padhiye aur phone par hi sign kar dijiye:\n\n'
        '${request.link}\n\n'
        'Link ${SignatureRepository.linkLife.inDays} din tak chalega.';

    if (request.customerPhone.trim().isEmpty) {
      Clipboard.setData(ClipboardData(text: message));
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No mobile number - message copied.')),
      );
      return;
    }

    ContactLauncher.openWhatsAppWithChoice(
      context,
      request.customerPhone,
      message: message,
    );
  }

  Future<void> _check() async {
    setState(() => _working = true);
    await _load();
    if (!mounted) return;
    setState(() => _working = false);

    final signed = _signed;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(signed == null
            ? 'Not signed yet. The customer can still open the link.'
            : 'Signed. It will print on the document.'),
      ),
    );
  }

  Future<void> _cancel(SignatureRequestModel request) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Cancel this link?'),
        content: const Text(
          'The link will stop working. You can send a new one any time.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Keep it'),
          ),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Cancel link'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    await SignatureRepository.instance.cancel(request);
    await _load(checkCloud: false);
  }

  Future<void> _remove(SignatureRequestModel request) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Remove this signature?'),
        content: const Text(
          'The signature will be deleted and the document will print an '
          'empty signature line again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Keep it'),
          ),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    await SignatureRepository.instance.delete(request);
    await _load(checkCloud: false);
  }

  String _when(String iso) {
    final date = DateTime.tryParse(iso);
    return date == null ? iso : _dateFormat.format(date);
  }

  @override
  Widget build(BuildContext context) {
    final signed = _signed;
    final pending = _pending;

    return Scaffold(
      appBar: AppBar(title: const Text('Customer Signature'), centerTitle: true),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.description_outlined),
                    title: Text(widget.args.title),
                    subtitle: Text(
                      '${widget.args.documentNo}  •  ${widget.args.customerName}'
                      '${widget.args.customerPhone.isEmpty ? '' : '  •  ${widget.args.customerPhone}'}',
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                if (signed != null) ...[
                  _signedCard(signed),
                ] else if (pending != null) ...[
                  _pendingCard(pending),
                ] else ...[
                  _askCard(),
                ],

                const SizedBox(height: 16),
                _history(),
              ],
            ),
    );
  }

  Widget _askCard() {
    final configured = SignatureRepository.signBaseUrl.trim().isNotEmpty;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Get the signature on the phone',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            const SizedBox(height: 6),
            const Text(
              'Send the customer a link. They open it, read the details and '
              'the terms, and sign with their finger. The signature then '
              'prints on this document.',
              style: TextStyle(color: Colors.grey),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton.icon(
                onPressed: _working || !configured ? null : _create,
                icon: _working
                    ? const SizedBox(
                        width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.draw_outlined),
                label: const Text('Send signature link'),
              ),
            ),
            if (!configured) ...[
              const SizedBox(height: 10),
              Text(
                'The signing page is not set up yet. A Super Admin adds its '
                'web address in Super Admin Settings.',
                style: TextStyle(color: Colors.red.shade700, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _pendingCard(SignatureRequestModel request) {
    return Card(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.hourglass_top_outlined),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text('Waiting for the customer to sign',
                      style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text('Link sent ${_when(request.createdAt)}. '
                'Works till ${_when(request.expiresAt)}.'),
            const SizedBox(height: 12),
            SelectableText(
              request.link,
              style: const TextStyle(fontSize: 12, color: Colors.blue),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  onPressed: () => _share(request),
                  icon: const Icon(Icons.chat_outlined, size: 18),
                  label: const Text('Send again'),
                ),
                OutlinedButton.icon(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: request.link));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Link copied.')),
                    );
                  },
                  icon: const Icon(Icons.copy, size: 18),
                  label: const Text('Copy link'),
                ),
                OutlinedButton.icon(
                  onPressed: _working ? null : _check,
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('Check now'),
                ),
                TextButton.icon(
                  onPressed: () => _cancel(request),
                  icon: const Icon(Icons.close, size: 18),
                  label: const Text('Cancel link'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _signedCard(SignatureRequestModel request) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.verified_outlined, color: Colors.green.shade700),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text('Signed',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Signed by ${request.signerName.isEmpty ? request.customerName : request.signerName} '
              'on ${_when(request.signedAt)}.',
            ),
            const SizedBox(height: 12),
            if (request.signaturePath.isNotEmpty)
              Container(
                width: double.infinity,
                height: 120,
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.grey.shade300),
                  borderRadius: BorderRadius.circular(8),
                  color: Colors.white,
                ),
                padding: const EdgeInsets.all(8),
                child: Image.file(
                  File(request.signaturePath),
                  fit: BoxFit.contain,
                  errorBuilder: (context, error, stackTrace) => const Center(
                    child: Text('The signature image is missing from this device.'),
                  ),
                ),
              ),
            const SizedBox(height: 10),
            const Text(
              'This prints on the document above the customer signature line, '
              'with the date it was signed.',
              style: TextStyle(color: Colors.grey, fontSize: 12),
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: () => _remove(request),
              icon: const Icon(Icons.delete_outline, size: 18),
              label: const Text('Remove signature'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _history() {
    final past = _requests
        .where((r) => r.status != SignatureStatus.signed && r.hasExpired ||
            r.status == SignatureStatus.cancelled ||
            r.status == SignatureStatus.expired)
        .toList();

    if (past.isEmpty) return const SizedBox.shrink();

    return Card(
      child: Column(
        children: [
          const ListTile(
            dense: true,
            title: Text('Earlier links', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
          for (final request in past)
            ListTile(
              dense: true,
              leading: const Icon(Icons.link_off, size: 18),
              title: Text(request.status.label),
              subtitle: Text('Sent ${_when(request.createdAt)}'),
            ),
        ],
      ),
    );
  }
}
