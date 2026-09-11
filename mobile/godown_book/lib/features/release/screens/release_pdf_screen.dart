import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/subscription/document_type.dart';
import '../../../shared/widgets/company_not_configured.dart';
import '../../../shared/widgets/document_pdf_view.dart';
import '../../../shared/widgets/pdf_document_actions.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
import '../../signature/models/signature_request_model.dart';
import '../../signature/repositories/signature_repository.dart';
import '../../signature/screens/signature_request_screen.dart';
import '../models/goods_release_model.dart';
import '../repositories/goods_release_repository.dart';
import '../services/release_pdf_service.dart';

class ReleasePdfScreen extends StatefulWidget {
  final String releaseId;

  const ReleasePdfScreen({super.key, required this.releaseId});

  @override
  State<ReleasePdfScreen> createState() => _ReleasePdfScreenState();
}

class _ReleasePdfScreenState extends State<ReleasePdfScreen> {
  static final _dateFormat = DateFormat('dd-MM-yyyy');

  Uint8List? _menuPdfBytes;
  GoodsReleaseModel? _release;
  CompanyModel? _company;
  SignedSignature? _signature;
  bool _loading = true;

  final Set<String> _selectedCopies = {...ReleasePdfService.copyLabels};

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final release = await GoodsReleaseRepository.instance.getById(widget.releaseId);
    final company = await CompanyController.instance.getCompany();
    final signature = await SignatureRepository.instance
        .signedFor(DocumentType.releaseRecord, widget.releaseId);
    if (!mounted) return;
    setState(() {
      _release = release;
      _company = company;
      _signature = signature;
      _loading = false;
    });
  }

  String get _fileName =>
      'Release-${(_release?.releaseNo ?? '').replaceAll('/', '-')}.pdf';

  @override
  Widget build(BuildContext context) {
    final release = _release;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/releases'),
        ),
        title: const Text('Release Record'),
        centerTitle: true,
        actions: [
          PdfActionsMenu(
            documentLabel: 'Release',
            fileName: () => _fileName,
            getPdfBytes: () => _menuPdfBytes,
            customerPhone: release?.customerPhone,
            onDelete: () => GoodsReleaseRepository.instance.delete(widget.releaseId),
            afterDelete: () =>
                context.canPop() ? context.pop() : context.go('/releases'),
            deleteWarning: 'The record will be deleted and the goods put back '
                'on the storage record.',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : release == null
              ? const Center(child: Text('Release not found.'))
              : (_company == null || !_company!.isConfigured)
                  ? CompanyNotConfigured(
                      missing: _company?.missingFields ?? const ['Company details'])
                  : Column(
                      children: [
                        _copySelector(),
                        Expanded(
                          child: DocumentPdfView(
                            documentType: DocumentType.releaseRecord,
                            fileName: _fileName,
                            rebuildKey:
                                '${_selectedCopies.join('|')}|${_signature?.signedAt ?? ''}',
                            onBytes: (bytes) => _menuPdfBytes = bytes,
                            build: ({required showWatermark}) =>
                                ReleasePdfService.instance.build(
                              release,
                              _company,
                              showWatermark: showWatermark,
                              customerSignature: _signature?.image,
                              customerSignatureNote: _signatureNote,
                              copies: _selectedCopies.toList(),
                            ),
                          ),
                        ),
                        _signatureBar(release),
                      ],
                    ),
    );
  }

  String get _signatureNote {
    final signature = _signature;
    if (signature == null) return '';
    final signedAt = DateTime.tryParse(signature.signedAt);
    final on = signedAt == null ? '' : ' on ${_dateFormat.format(signedAt)}';
    final by = signature.signerName.trim().isEmpty
        ? ''
        : ' by ${signature.signerName.trim()}';
    return 'Signed electronically$on$by';
  }

  /// The customer's own signature on the release is what answers "I
  /// never got my goods back" months later, so the app asks for it on
  /// the same screen the paper is printed from.
  Widget _signatureBar(GoodsReleaseModel release) {
    final signed = _signature != null;

    return SafeArea(
      top: false,
      child: Container(
        width: double.infinity,
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
        child: Row(
          children: [
            Icon(signed ? Icons.verified_outlined : Icons.draw_outlined,
                size: 20, color: signed ? Colors.green.shade700 : null),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                signed
                    ? 'Customer signature taken${_signatureNote.isEmpty ? '' : ' - ${_signatureNote.toLowerCase()}'}'
                    : 'No customer signature on this release yet',
                style: const TextStyle(fontSize: 12.5),
              ),
            ),
            TextButton(
              onPressed: () => _openSignature(release),
              child: Text(signed ? 'Manage' : 'Take signature'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openSignature(GoodsReleaseModel release) async {
    await context.push(
      '/signature',
      extra: SignatureRequestArgs(
        documentType: DocumentType.releaseRecord,
        documentId: release.id,
        documentNo: release.releaseNo,
        customerName: release.collectedByName.trim().isEmpty
            ? release.customerName
            : release.collectedByName,
        customerPhone: release.collectedByPhone.trim().isEmpty
            ? release.customerPhone
            : release.collectedByPhone,
        title: 'Goods Release',
        details: [
          SignatureDetail('Release No.', release.releaseNo),
          SignatureDetail('Against Receipt', release.bookingNo),
          SignatureDetail(
            'Goods',
            release.items
                .map((i) =>
                    '${i.itemName} - ${i.quantity.toStringAsFixed(0)} ${i.unit}')
                .join(', '),
          ),
          SignatureDetail('Collected by', release.collectedByName),
          if (release.vehicleNumber.trim().isNotEmpty)
            SignatureDetail('Vehicle', release.vehicleNumber),
        ],
        terms: 'I have received the goods listed above in good order and '
            'condition.\nI confirm I am the customer, or authorised by the '
            'customer to collect these goods.',
      ),
    );
    await _load();
  }

  Widget _copySelector() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Row(
        children: [
          const Text('Copies', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
          const SizedBox(width: 10),
          for (final label in ReleasePdfService.copyLabels)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: FilterChip(
                label: Text(label.replaceAll(' COPY', ''),
                    style: const TextStyle(fontSize: 11)),
                selected: _selectedCopies.contains(label),
                onSelected: (on) {
                  setState(() {
                    if (on) {
                      _selectedCopies.add(label);
                    } else if (_selectedCopies.length > 1) {
                      _selectedCopies.remove(label);
                    }
                  });
                },
              ),
            ),
        ],
      ),
    );
  }
}
