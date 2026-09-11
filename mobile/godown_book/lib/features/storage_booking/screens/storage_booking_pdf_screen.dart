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
import '../models/storage_booking_model.dart';
import '../repositories/storage_booking_repository.dart';
import '../services/goods_list_pdf_service.dart';
import '../services/storage_agreement_pdf_service.dart';
import '../services/storage_receipt_pdf_service.dart';

/// Which of the three papers a booking prints as.
enum BookingDocumentKind {
  receipt,
  inventory,
  agreement;

  String get title => switch (this) {
        BookingDocumentKind.receipt => 'Storage Receipt',
        BookingDocumentKind.inventory => 'Goods List',
        BookingDocumentKind.agreement => 'Storage Agreement',
      };

  String get documentType => switch (this) {
        BookingDocumentKind.receipt => DocumentType.storageReceipt,
        BookingDocumentKind.inventory => DocumentType.itemList,
        BookingDocumentKind.agreement => DocumentType.storageAgreement,
      };

  String get filePrefix => switch (this) {
        BookingDocumentKind.receipt => 'StorageReceipt',
        BookingDocumentKind.inventory => 'GoodsList',
        BookingDocumentKind.agreement => 'StorageAgreement',
      };

  static BookingDocumentKind fromName(String? name) =>
      BookingDocumentKind.values.firstWhere(
        (k) => k.name == name,
        orElse: () => BookingDocumentKind.receipt,
      );
}

/// Renders one of a booking's papers as a PDF - loading / error /
/// company-not-configured states, the share menu, and the subscription
/// gate (free watermarked copies, then subscribe).
class StorageBookingPdfScreen extends StatefulWidget {
  final String bookingId;
  final BookingDocumentKind kind;

  const StorageBookingPdfScreen({
    super.key,
    required this.bookingId,
    required this.kind,
  });

  @override
  State<StorageBookingPdfScreen> createState() => _StorageBookingPdfScreenState();
}

class _StorageBookingPdfScreenState extends State<StorageBookingPdfScreen> {
  Uint8List? _menuPdfBytes;

  StorageBookingModel? _booking;
  CompanyModel? _company;
  bool _loading = true;
  Object? _buildError;

  bool? _isActive;
  int? _remainingDemos;
  bool _demoConfirmed = false;

  final Set<String> _selectedCopies = {...StorageReceiptPdfService.copyLabels};

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final booking = await StorageBookingRepository.instance.getById(widget.bookingId);
    final company = await CompanyController.instance.getCompany();

    final service = SubscriptionAccessService.instance;
    final active = await service.isSubscriptionActive();
    final remaining = active
        ? 0
        : await service.getRemainingDemoGenerations(widget.kind.documentType);

    if (!mounted) return;

    setState(() {
      _booking = booking;
      _company = company;
      _isActive = active;
      _remainingDemos = remaining;
      _loading = false;
    });
  }

  String get _fileName =>
      '${widget.kind.filePrefix}-${(_booking?.bookingNo ?? '').replaceAll('/', '-')}.pdf';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/storage'),
        ),
        title: Text('${widget.kind.title} PDF'),
        centerTitle: true,
        actions: [
          PdfActionsMenu(
            documentLabel: widget.kind.title,
            fileName: () => _fileName,
            getPdfBytes: () => _menuPdfBytes,
            customerPhone: _booking?.customerPhone,
            onEdit: () => context.push('/storage-edit', extra: widget.bookingId),
            onDelete: () => StorageBookingRepository.instance.delete(widget.bookingId),
            afterDelete: () => context.canPop() ? context.pop() : context.go('/storage'),
            deleteWarning: 'This storage record and its goods list will be permanently deleted.',
          ),
        ],
      ),
      body: _loading ? const Center(child: CircularProgressIndicator()) : _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    final booking = _booking;
    if (booking == null) {
      return const Center(child: Text('Storage record not found.'));
    }

    final company = _company;
    if (company == null || !company.isConfigured) {
      return CompanyNotConfigured(
        missing: company?.missingFields ?? const ['Company details'],
      );
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

    return Column(
      children: [
        if (widget.kind == BookingDocumentKind.receipt) _copySelector(),
        Expanded(
          child: PdfPreview(
            key: ValueKey(_selectedCopies.join('|')),
            build: (_) async {
              try {
                final bytes = await _buildBytes(booking, showWatermark);
                _menuPdfBytes = bytes;

                if (FeatureFlags.demoGenerationLimitEnforced && isDemoCopy) {
                  await SubscriptionAccessService.instance
                      .recordDemoGeneration(widget.kind.documentType);
                }
                return bytes;
              } catch (error, stackTrace) {
                debugPrint('${widget.kind.title} PDF build failed: $error\n$stackTrace');
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
          ),
        ),
      ],
    );
  }

  Future<Uint8List> _buildBytes(StorageBookingModel booking, bool showWatermark) {
    switch (widget.kind) {
      case BookingDocumentKind.receipt:
        return StorageReceiptPdfService.instance.build(
          booking,
          _company,
          showWatermark: showWatermark,
          copies: _selectedCopies.toList(),
        );
      case BookingDocumentKind.inventory:
        return GoodsListPdfService.instance.build(
          booking,
          _company,
          showWatermark: showWatermark,
        );
      case BookingDocumentKind.agreement:
        return StorageAgreementPdfService.instance.build(
          booking,
          _company,
          showWatermark: showWatermark,
        );
    }
  }

  Widget _copySelector() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Copies to include',
            style: Theme.of(context).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              for (final label in StorageReceiptPdfService.copyLabels)
                FilterChip(
                  label: Text(label.replaceAll(' COPY', ''), style: const TextStyle(fontSize: 11)),
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
            ],
          ),
        ],
      ),
    );
  }
}
