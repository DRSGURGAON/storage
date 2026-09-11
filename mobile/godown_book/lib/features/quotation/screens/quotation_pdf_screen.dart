import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/subscription/document_type.dart';
import '../../../shared/widgets/company_not_configured.dart';
import '../../../shared/widgets/document_pdf_view.dart';
import '../../../shared/widgets/pdf_document_actions.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
import '../models/quotation_model.dart';
import '../repositories/quotation_repository.dart';
import '../services/quotation_pdf_service.dart';

class QuotationPdfScreen extends StatefulWidget {
  final String quotationId;

  const QuotationPdfScreen({super.key, required this.quotationId});

  @override
  State<QuotationPdfScreen> createState() => _QuotationPdfScreenState();
}

class _QuotationPdfScreenState extends State<QuotationPdfScreen> {
  Uint8List? _menuPdfBytes;

  QuotationModel? _quotation;
  CompanyModel? _company;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final quotation = await QuotationRepository.instance.getById(widget.quotationId);
    final company = await CompanyController.instance.getCompany();

    if (!mounted) return;
    setState(() {
      _quotation = quotation;
      _company = company;
      _loading = false;
    });
  }

  String get _fileName =>
      'Quotation-${(_quotation?.quotationNo ?? '').replaceAll('/', '-')}.pdf';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/quotations'),
        ),
        title: const Text('Quotation PDF'),
        centerTitle: true,
        actions: [
          PdfActionsMenu(
            documentLabel: 'Quotation',
            fileName: () => _fileName,
            getPdfBytes: () => _menuPdfBytes,
            customerPhone: _quotation?.customerPhone,
            onEdit: () => context.push('/quotation-edit', extra: widget.quotationId),
            onDelete: () => QuotationRepository.instance.delete(widget.quotationId),
            afterDelete: () => context.canPop() ? context.pop() : context.go('/quotations'),
          ),
        ],
      ),
      body: _loading ? const Center(child: CircularProgressIndicator()) : _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    final quotation = _quotation;
    if (quotation == null) return const Center(child: Text('Quotation not found.'));

    final company = _company;
    if (company == null || !company.isConfigured) {
      return CompanyNotConfigured(missing: company?.missingFields ?? const ['Company details']);
    }

    return DocumentPdfView(
      documentType: DocumentType.quotation,
      fileName: _fileName,
      onBytes: (bytes) => _menuPdfBytes = bytes,
      build: ({required showWatermark}) => QuotationPdfService.instance.build(
        quotation,
        _company,
        showWatermark: showWatermark,
      ),
    );
  }
}
