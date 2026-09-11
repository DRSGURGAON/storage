import 'dart:io';

import 'package:flutter/material.dart';

import '../../../core/tenant/tenant_scope.dart';
import '../../company/controllers/company_controller.dart';
import '../models/kyc_submission_model.dart';
import '../repositories/kyc_repository.dart';
import '../utils/kyc_document_picker.dart';

/// The subscriber's KYC screen (Settings -> KYC Documents): upload
/// exactly two identity documents - PAN card (mandatory) plus one more
/// govt. ID (Aadhaar / DL / Passport / Voter ID / other) - submit for
/// verification, and see the current Approved/Pending/Rejected status.
class KycScreen extends StatefulWidget {
  const KycScreen({super.key});

  @override
  State<KycScreen> createState() => _KycScreenState();
}

class _KycScreenState extends State<KycScreen> {
  KycSubmissionModel? _submission;
  bool _loading = true;
  bool _saving = false;

  String _secondDocType = KycSecondDocType.options.first;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!TenantScope.isReady) {
      if (mounted) setState(() => _loading = false);
      return;
    }

    final companyId = TenantScope.companyId;

    // Local first, then pull any review verdict the Super Admin has
    // since recorded in the cloud.
    var submission = await KycRepository.instance.getLocal(companyId);
    if (submission != null && submission.status == KycStatus.pending) {
      // A submission made offline (or before the server rules were
      // published) may never have reached the server - retry silently
      // so pending submissions upload themselves on every visit.
      final company = await CompanyController.instance.getCompany();
      await KycRepository.instance.ensureUploaded(
        submission,
        companyName: company?.companyName ?? '',
        companyCode: company?.companyCode ?? '',
      );

      submission = await KycRepository.instance.refreshStatus(companyId);
    }

    if (!mounted) return;

    setState(() {
      _submission = submission ?? KycSubmissionModel(companyId: companyId);
      if ((submission?.secondDocType ?? '').isNotEmpty &&
          KycSecondDocType.options.contains(submission!.secondDocType)) {
        _secondDocType = submission.secondDocType;
      }
      _loading = false;
    });
  }

  Future<void> _pickDocument({required bool isPan}) async {
    try {
      final picked =
          await KycDocumentPicker.pick(prefix: isPan ? 'pan' : 'second-id');

      if (picked == null || !mounted) return;

      setState(() {
        _submission = isPan
            ? _submission!.copyWith(
                panFilePath: picked.path,
                panFileName: picked.name,
              )
            : _submission!.copyWith(
                secondFilePath: picked.path,
                secondFileName: picked.name,
              );
      });
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$e')),
      );
    }
  }

  Future<void> _submit() async {
    final submission = _submission;
    if (submission == null || _saving) return;

    if (submission.panFilePath.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('PAN card photo is required.')),
      );
      return;
    }
    if (submission.secondFilePath.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$_secondDocType photo is required.')),
      );
      return;
    }

    setState(() => _saving = true);

    final toSave = submission.copyWith(
      secondDocType: _secondDocType,
      status: KycStatus.pending,
      submittedAt: DateTime.now().toIso8601String(),
      reviewedAt: '',
      rejectionReason: '',
    );

    try {
      await KycRepository.instance.saveLocal(toSave);

      final company = await CompanyController.instance.getCompany();
      final result = await KycRepository.instance.pushToCloud(
        toSave,
        companyName: company?.companyName ?? '',
        companyCode: company?.companyCode ?? '',
      );

      if (!mounted) return;

      setState(() {
        _submission = toSave;
        _saving = false;
      });

      final message = switch (result) {
        KycPushResult.uploaded => 'KYC submitted for verification.',
        KycPushResult.permissionDenied =>
          'The server rejected the upload - the app\'s Firestore rules '
              'have not been updated yet (Firebase Console -> Firestore '
              '-> Rules -> publish the latest rules). Saved on this '
              'device; it will upload automatically once the rules are '
              'published.',
        KycPushResult.failed =>
          'Saved on this device, but could not upload to the server. '
              'Check your internet - it will retry automatically the '
              'next time you open this screen.',
      };

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
          duration: Duration(
            seconds: result == KycPushResult.uploaded ? 4 : 8,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;

      setState(() => _saving = false);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not submit: $e')),
      );
    }
  }

  (Color, IconData, String) _statusVisual(String status) => switch (status) {
        KycStatus.approved => (Colors.green, Icons.verified_outlined,
            'KYC Approved'),
        KycStatus.pending => (Colors.orange, Icons.hourglass_top_outlined,
            'KYC Pending Approval'),
        KycStatus.rejected => (Colors.red, Icons.cancel_outlined,
            'KYC Rejected - please re-submit'),
        _ => (Colors.grey, Icons.badge_outlined, 'KYC Not Submitted'),
      };

  Widget _documentBox({
    required String title,
    required String path,
    required VoidCallback onPick,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            InkWell(
              onTap: onPick,
              child: Container(
                height: 160,
                width: double.infinity,
                decoration: BoxDecoration(
                  border: Border.all(color: Theme.of(context).dividerColor),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: path.isEmpty
                    ? Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.upload_file_outlined, size: 36),
                          const SizedBox(height: 8),
                          Text(
                            'Tap to Upload',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      )
                    : ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.file(File(path), fit: BoxFit.contain),
                      ),
              ),
            ),
            if (path.isNotEmpty)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: onPick,
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('Change'),
                ),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final submission = _submission;

    return Scaffold(
      appBar: AppBar(title: const Text('KYC Documents'), centerTitle: true),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : submission == null
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'Set up your Company Profile first, then upload '
                      'your KYC documents here.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                  children: [
                    Builder(builder: (context) {
                      final (color, icon, label) =
                          _statusVisual(submission.status);
                      return Card(
                        color: color.withValues(alpha: 0.12),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Icon(icon, color: color),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      label,
                                      style: TextStyle(
                                        color: color,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              if (submission.status == KycStatus.rejected &&
                                  submission.rejectionReason.isNotEmpty) ...[
                                const SizedBox(height: 6),
                                Text(
                                  'Reason: ${submission.rejectionReason}',
                                  style:
                                      Theme.of(context).textTheme.bodySmall,
                                ),
                              ],
                            ],
                          ),
                        ),
                      );
                    }),

                    const SizedBox(height: 8),

                    Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 4, vertical: 8),
                      child: Text(
                        'Two identity documents are required: your PAN '
                        'card, plus any one more government ID.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),

                    _documentBox(
                      title: '1. PAN Card (required)',
                      path: submission.panFilePath,
                      onPick: () => _pickDocument(isPan: true),
                    ),

                    const SizedBox(height: 8),

                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: DropdownButtonFormField<String>(
                          initialValue: _secondDocType,
                          decoration: const InputDecoration(
                            labelText: '2. Second ID Type',
                          ),
                          items: [
                            for (final option in KycSecondDocType.options)
                              DropdownMenuItem(
                                value: option,
                                child: Text(option),
                              ),
                          ],
                          onChanged: (value) {
                            if (value != null) {
                              setState(() => _secondDocType = value);
                            }
                          },
                        ),
                      ),
                    ),

                    const SizedBox(height: 8),

                    _documentBox(
                      title: '2. $_secondDocType (required)',
                      path: submission.secondFilePath,
                      onPick: () => _pickDocument(isPan: false),
                    ),
                  ],
                ),
      bottomNavigationBar: _loading || submission == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: SizedBox(
                  height: 50,
                  child: ElevatedButton(
                    onPressed: _saving ||
                            submission.status == KycStatus.approved
                        ? null
                        : _submit,
                    child: _saving
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(submission.status == KycStatus.approved
                            ? 'KYC Approved'
                            : submission.status == KycStatus.pending
                                ? 'Re-Submit for Verification'
                                : 'Submit for Verification'),
                  ),
                ),
              ),
            ),
    );
  }
}
