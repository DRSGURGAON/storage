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
import '../models/payment_model.dart';
import '../repositories/billing_repository.dart';
import '../services/payment_receipt_pdf_service.dart';

class PaymentReceiptPdfScreen extends StatefulWidget {
  final String paymentId;

  const PaymentReceiptPdfScreen({super.key, required this.paymentId});

  @override
  State<PaymentReceiptPdfScreen> createState() => _PaymentReceiptPdfScreenState();
}

class _PaymentReceiptPdfScreenState extends State<PaymentReceiptPdfScreen> {
  Uint8List? _menuPdfBytes;
  PaymentModel? _payment;
  BillModel? _bill;
  CompanyModel? _company;
  double? _balanceAfter;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final payment = await BillingRepository.instance.getPaymentById(widget.paymentId);
    final company = await CompanyController.instance.getCompany();

    BillModel? bill;
    if (payment != null && payment.billId.isNotEmpty) {
      bill = await BillingRepository.instance.getBillById(payment.billId);
    }

    double? balanceAfter;
    if (payment != null && payment.customerId.isNotEmpty) {
      final balance =
          await BillingRepository.instance.balanceForCustomer(payment.customerId);
      balanceAfter = balance.billed - balance.received - balance.credited;
    }

    if (!mounted) return;
    setState(() {
      _payment = payment;
      _bill = bill;
      _company = company;
      _balanceAfter = balanceAfter;
      _loading = false;
    });
  }

  bool get _isCreditNote => _payment?.isCreditNote ?? false;

  String get _fileName =>
      '${_isCreditNote ? 'CreditNote' : 'Receipt'}-'
      '${(_payment?.receiptNo ?? '').replaceAll('/', '-')}.pdf';

  @override
  Widget build(BuildContext context) {
    final payment = _payment;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/payments'),
        ),
        title: Text(_isCreditNote ? 'Credit Note' : 'Payment Receipt'),
        centerTitle: true,
        actions: [
          PdfActionsMenu(
            documentLabel: _isCreditNote ? 'Credit Note' : 'Receipt',
            fileName: () => _fileName,
            getPdfBytes: () => _menuPdfBytes,
            customerPhone: payment?.payerPhone,
            onDelete: () => BillingRepository.instance.deletePayment(widget.paymentId),
            afterDelete: () =>
                context.canPop() ? context.pop() : context.go('/payments'),
            deleteWarning: _isCreditNote
                ? 'The credit note will be deleted and the amount put back '
                    'on the bill.'
                : 'The receipt will be deleted and the money taken off '
                    'the bill it settled.',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : payment == null
              ? const Center(child: Text('Receipt not found.'))
              : (_company == null || !_company!.isConfigured)
                  ? CompanyNotConfigured(
                      missing: _company?.missingFields ?? const ['Company details'])
                  : DocumentPdfView(
                      documentType: _isCreditNote
                          ? DocumentType.creditNote
                          : DocumentType.moneyReceipt,
                      fileName: _fileName,
                      onBytes: (bytes) => _menuPdfBytes = bytes,
                      build: ({required showWatermark}) =>
                          PaymentReceiptPdfService.instance.build(
                        payment,
                        _company,
                        bill: _bill,
                        showWatermark: showWatermark,
                        balanceAfter: _balanceAfter,
                      ),
                    ),
    );
  }
}
