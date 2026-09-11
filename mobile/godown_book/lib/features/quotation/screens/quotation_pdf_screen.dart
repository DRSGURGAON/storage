import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:printing/printing.dart';

import '../../../core/constants/feature_flags.dart';
import '../../../core/subscription/document_type.dart';
import '../../../core/subscription/subscription_access_service.dart';
import '../../../shared/widgets/company_not_configured.dart';
import '../../../shared/widgets/pdf_document_actions.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
import '../../subscription/widgets/demo_generation_gate.dart';
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
  Object? _buildError;

  bool? _isActive;
  int? _remainingDemos;
  bool _demoConfirmed = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final quotation = await QuotationRepository.instance.getById(widget.quotationId);
    final company = await CompanyController.instance.getCompany();

    final service = SubscriptionAccessService.instance;
    final active = await service.isSubscriptionActive();
    final remaining =
        active ? 0 : await service.getRemainingDemoGenerations(DocumentType.quotation);

    if (!mounted) return;
    setState(() {
      _quotation = quotation;
      _company = company;
      _isActive = active;
      _remainingDemos = remaining;
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

    if (_buildError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48),
              const SizedBox(height: 12),
              Text('The PDF could not be generated.\n$_buildError', textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () => setState(() => _buildError = null),
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }

    if (FeatureFlags.demoGenerationLimitEnforced && _isActive == false && !_demoConfirmed) {
      if ((_remainingDemos ?? 0) <= 0) {
        return DemoLimitReached(onViewSubscription: () => context.push('/subscription'));
      }
      return DemoGenerationGate(
        remaining: _remainingDemos!,
        onGenerate: () => setState(() => _demoConfirmed = true),
      );
    }

    final isDemoCopy = _isActive == false;
    final showWatermark = FeatureFlags.watermarkEnabled && isDemoCopy;

    return PdfPreview(
      build: (_) async {
        try {
          final bytes = await QuotationPdfService.instance.build(
            quotation,
            _company,
            showWatermark: showWatermark,
          );
          _menuPdfBytes = bytes;

          if (FeatureFlags.demoGenerationLimitEnforced && isDemoCopy) {
            await SubscriptionAccessService.instance
                .recordDemoGeneration(DocumentType.quotation);
          }
          return bytes;
        } catch (error, stackTrace) {
          debugPrint('Quotation PDF build failed: $error\n$stackTrace');
          if (mounted) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted) setState(() => _buildError = error);
            });
          }
          rethrow;
        }
      },
      pdfFileName: _fileName,
      canDebug: false,
      allowPrinting: true,
      allowSharing: true,
      actions: [
        PdfPreviewAction(
          icon: const Icon(Icons.share),
          onPressed: (context, build, format) async {
            await Printing.sharePdf(bytes: await build(format), filename: _fileName);
          },
        ),
      ],
    );
  }
}
