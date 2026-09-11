import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/subscription/document_type.dart';
import '../../../shared/widgets/company_not_configured.dart';
import '../../../shared/widgets/document_pdf_view.dart';
import '../../../shared/widgets/pdf_document_actions.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
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
  Uint8List? _menuPdfBytes;
  GoodsReleaseModel? _release;
  CompanyModel? _company;
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
    if (!mounted) return;
    setState(() {
      _release = release;
      _company = company;
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
                            rebuildKey: _selectedCopies.join('|'),
                            onBytes: (bytes) => _menuPdfBytes = bytes,
                            build: ({required showWatermark}) =>
                                ReleasePdfService.instance.build(
                              release,
                              _company,
                              showWatermark: showWatermark,
                              copies: _selectedCopies.toList(),
                            ),
                          ),
                        ),
                      ],
                    ),
    );
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
