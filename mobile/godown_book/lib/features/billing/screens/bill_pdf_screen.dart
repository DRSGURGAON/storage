import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/subscription/document_type.dart';
import '../../../shared/widgets/company_not_configured.dart';
import '../../../shared/widgets/document_pdf_view.dart';
import '../../../shared/widgets/pdf_document_actions.dart';
import '../../company/controllers/company_controller.dart';
import '../../company/models/company_model.dart';
import '../models/bill_model.dart';
import '../repositories/billing_repository.dart';
import '../services/bill_pdf_service.dart';

class BillPdfScreen extends StatefulWidget {
  final String billId;

  const BillPdfScreen({super.key, required this.billId});

  @override
  State<BillPdfScreen> createState() => _BillPdfScreenState();
}

class _BillPdfScreenState extends State<BillPdfScreen> {
  Uint8List? _menuPdfBytes;
  BillModel? _bill;
  CompanyModel? _company;
  double? _previousBalance;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final bill = await BillingRepository.instance.getBillById(widget.billId);
    final company = await CompanyController.instance.getCompany();

    double? previous;
    if (bill != null && bill.customerId.isNotEmpty) {
      final billDate = DateTime.tryParse(bill.billDate);
      if (billDate != null) {
        previous = await BillingRepository.instance
            .openingBalance(bill.customerId, billDate);
      }
    }

    if (!mounted) return;
    setState(() {
      _bill = bill;
      _company = company;
      _previousBalance = previous;
      _loading = false;
    });
  }

  String get _fileName =>
      'Bill-${(_bill?.billNo ?? '').replaceAll('/', '-')}.pdf';

  @override
  Widget build(BuildContext context) {
    final bill = _bill;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/bills'),
        ),
        title: const Text('Storage Bill'),
        centerTitle: true,
        actions: [
          PdfActionsMenu(
            documentLabel: 'Bill',
            fileName: () => _fileName,
            getPdfBytes: () => _menuPdfBytes,
            customerPhone: bill?.customerPhone,
            onEdit: () => context.push('/bill-edit', extra: widget.billId),
            onDelete: () => BillingRepository.instance.deleteBill(widget.billId),
            afterDelete: () => context.canPop() ? context.pop() : context.go('/bills'),
            deleteWarning: 'The bill will be deleted. Receipts already issued '
                'against it stay on the customer\'s account.',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : bill == null
              ? const Center(child: Text('Bill not found.'))
              : (_company == null || !_company!.isConfigured)
                  ? CompanyNotConfigured(
                      missing: _company?.missingFields ?? const ['Company details'])
                  : DocumentPdfView(
                      documentType: DocumentType.bill,
                      fileName: _fileName,
                      onBytes: (bytes) => _menuPdfBytes = bytes,
                      build: ({required showWatermark}) => BillPdfService.instance.build(
                        bill,
                        _company,
                        showWatermark: showWatermark,
                        previousBalance: _previousBalance,
                      ),
                    ),
    );
  }
}
