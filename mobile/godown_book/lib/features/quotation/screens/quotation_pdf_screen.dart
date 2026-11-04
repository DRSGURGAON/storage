import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/contact/whatsapp_templates.dart';
import '../../../core/subscription/document_type.dart';
import '../widgets/make_storage_receipt_confirm.dart';
import '../../../shared/widgets/company_not_configured.dart';
import '../../../shared/widgets/document_pdf_view.dart';
import '../../../shared/widgets/pdf_document_actions.dart';
import '../../billing/services/storage_charge_calculator.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';
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
  int _version = 0;

  /// The booking already made from this quotation, if any - so the
  /// button below offers to go straight to its bill or bilty instead
  /// of just the receipt.
  StorageBookingModel? _existingBooking;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final quotation = await QuotationRepository.instance.getById(widget.quotationId);
    final company = await CompanyController.instance.getCompany();
    final existing = await StorageBookingRepository.instance
        .getByQuotationId(widget.quotationId);

    if (!mounted) return;
    setState(() {
      _quotation = quotation;
      _company = company;
      _existingBooking = existing;
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
            onEdit: () async {
              await context.push('/quotation-edit', extra: widget.quotationId);
              _version++;
              await _load();
            },
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

    return Column(
      children: [
        Expanded(
          child: DocumentPdfView(
            documentType: DocumentType.quotation,
            fileName: _fileName,
            rebuildKey: '$_version',
            onBytes: (bytes) => _menuPdfBytes = bytes,
            whatsAppPhone: quotation.customerPhone,
            shareMessage: WhatsAppTemplates.instance.document(
              name: quotation.customerName,
              document: 'Quotation',
              number: quotation.quotationNo,
              amount: quotation.grandTotal,
            ),
            build: ({required showWatermark}) => QuotationPdfService.instance.build(
              quotation,
              _company,
              showWatermark: showWatermark,
            ),
          ),
        ),
        _nextDocumentsPanel(quotation),
      ],
    );
  }

  /// What naturally follows this quotation, shown right here below the
  /// document - not tucked behind a three-dot menu - the same way Bill
  /// N Bilty shows the next step on its own booking screen.
  Widget _nextDocumentsPanel(QuotationModel quotation) {
    final booking = _existingBooking;

    if (booking == null) {
      if (quotation.status == QuotationStatus.declined) return const SizedBox.shrink();
      return Container(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        child: _nextDocTile(
          icon: Icons.inventory_2_outlined,
          title: 'Storage Receipt',
          subtitle: 'Make one from this quotation',
          label: 'Make Storage Receipt',
          last: true,
          onTap: () async {
            await openMakeStorageReceipt(context, quotation);
            await _load();
          },
        ),
      );
    }

    final canMakeBill = StorageChargeCalculator.hasUnbilledRent(booking);
    final canRelease = booking.status.isOpen;

    return Container(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'What follows this receipt',
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12.5),
          ),
          const SizedBox(height: 8),
          _nextDocTile(
            icon: Icons.description_outlined,
            title: 'Storage Receipt',
            subtitle: 'View the full record',
            label: 'View',
            onTap: () async {
              await context.push('/storage-detail', extra: booking.id);
              await _load();
            },
          ),
          if (canMakeBill)
            _nextDocTile(
              icon: Icons.receipt_long_outlined,
              title: 'Storage Bill',
              subtitle: 'Bill the rent so far',
              label: 'Make Bill',
              onTap: () async {
                await context.push('/bill-create', extra: booking.id);
                await _load();
              },
            ),
          _nextDocTile(
            icon: Icons.local_shipping_outlined,
            title: 'Bilty / Lorry Receipt',
            subtitle: 'When the goods travel by truck',
            label: 'Make Bilty',
            onTap: () async {
              await context.push('/bilty-create', extra: booking.id);
              await _load();
            },
          ),
          if (canRelease)
            _nextDocTile(
              icon: Icons.outbox_outlined,
              title: 'Release Goods',
              subtitle: 'Hand the goods back to the customer',
              label: 'Release',
              last: true,
              onTap: () async {
                await context.push('/release-create', extra: booking.id);
                await _load();
              },
            ),
        ],
      ),
    );
  }

  Widget _nextDocTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required String label,
    required VoidCallback onTap,
    bool last = false,
  }) {
    return Card(
      margin: EdgeInsets.only(bottom: last ? 0 : 6),
      child: ListTile(
        leading: Icon(icon),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: FilledButton(onPressed: onTap, child: Text(label)),
      ),
    );
  }
}
