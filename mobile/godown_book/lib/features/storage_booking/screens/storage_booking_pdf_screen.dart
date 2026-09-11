import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/subscription/document_type.dart';
import '../../../shared/widgets/company_not_configured.dart';
import '../../../shared/widgets/document_pdf_view.dart';
import '../../../shared/widgets/pdf_document_actions.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
import '../../signature/repositories/signature_repository.dart';
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
  SignedSignature? _customerSignature;
  bool _loading = true;

  final Set<String> _selectedCopies = {...StorageReceiptPdfService.copyLabels};

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final booking = await StorageBookingRepository.instance.getById(widget.bookingId);
    final company = await CompanyController.instance.getCompany();

    // The customer's own signature, when they have signed from a link.
    final signature = booking == null
        ? null
        : await SignatureRepository.instance
            .signedFor(DocumentType.storageReceipt, booking.id);

    if (!mounted) return;

    setState(() {
      _booking = booking;
      _company = company;
      _customerSignature = signature;
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

    return Column(
      children: [
        if (widget.kind == BookingDocumentKind.receipt) _copySelector(),
        Expanded(
          child: DocumentPdfView(
            documentType: widget.kind.documentType,
            fileName: _fileName,
            rebuildKey: _selectedCopies.join('|'),
            onBytes: (bytes) => _menuPdfBytes = bytes,
            build: ({required showWatermark}) => _buildBytes(booking, showWatermark),
          ),
        ),
      ],
    );
  }

  /// What prints under a signature that came from a link - plainly
  /// what it is, with the date, and nothing more claimed for it.
  String get _signatureNote {
    final signature = _customerSignature;
    if (signature == null) return '';

    final signedAt = DateTime.tryParse(signature.signedAt);
    final when = signedAt == null
        ? ''
        : ' on ${signedAt.day.toString().padLeft(2, '0')}-'
            '${signedAt.month.toString().padLeft(2, '0')}-${signedAt.year}';
    final who = signature.signerName.trim();

    return 'Signed electronically$when${who.isEmpty ? '' : ' by $who'}';
  }

  Future<Uint8List> _buildBytes(StorageBookingModel booking, bool showWatermark) {
    switch (widget.kind) {
      case BookingDocumentKind.receipt:
        return StorageReceiptPdfService.instance.build(
          booking,
          _company,
          showWatermark: showWatermark,
          copies: _selectedCopies.toList(),
          customerSignature: _customerSignature?.image,
          customerSignatureNote: _signatureNote,
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
          customerSignature: _customerSignature?.image,
          customerSignatureNote: _signatureNote,
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
