import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_terms/document_terms_repository.dart';
import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_box_row.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../../core/utils/amount_in_words.dart';
import '../../company/models/company_model.dart';
import '../models/bill_model.dart';
import '../models/payment_model.dart';

/// The payment receipt - proof that money was received, and what it
/// leaves outstanding.
class PaymentReceiptPdfService {
  PaymentReceiptPdfService._();

  static final PaymentReceiptPdfService instance = PaymentReceiptPdfService._();

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);
  String _customTerms = '';

  Future<Uint8List> build(
    PaymentModel payment,
    CompanyModel? company, {
    BillModel? bill,
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,

    /// What the customer still owes overall after this receipt - printed
    /// only when the caller supplies it.
    double? balanceAfter,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);
    _customTerms = await DocumentTermsRepository.instance
        .getTerms(DocumentTermsType.moneyReceipt);

    final document = pw.Document();
    final logo = await PdfPageKit.loadImage(company?.logoPath ?? '');
    final signature = await PdfPageKit.loadImage(company?.signaturePath ?? '');

    document.addPage(
      pw.MultiPage(
        pageTheme: PdfPageKit.pageTheme(
          style: _style,
          showWatermark: showWatermark,
          watermarkText: watermarkText,
          watermarkOpacity: watermarkOpacity,
        ),
        footer: (context) =>
            PdfPageKit.footer(context, company, leftLabel: 'Payment Receipt'),
        build: (context) => [
          ...PdfPageKit.top(company, logo, _style, 'PAYMENT RECEIPT'),
          _infoRow(payment, bill),
          pw.SizedBox(height: 8),
          _amountBand(payment),
          pw.SizedBox(height: 8),
          _detailBox(payment, bill, balanceAfter),
          if (_customTerms.isNotEmpty) ...[
            pw.SizedBox(height: 6),
            PdfPageKit.terms('Note :-', _customTerms, _style),
          ],
          pw.SizedBox(height: 16),
          PdfPageKit.signatures(
            company,
            signature,
            _style,
            otherParties: const ['Received From (Signature)'],
          ),
        ],
      ),
    );

    return document.save();
  }

  pw.Widget _infoRow(PaymentModel payment, BillModel? bill) {
    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('RECEIPT', _style),
            PdfPageKit.gridRow('Receipt No.', payment.receiptNo, _style, bold: true),
            PdfPageKit.gridRow('Date', PdfPageKit.date(payment.paymentDate), _style, bold: true),
            PdfPageKit.gridRow('Mode', payment.mode.label, _style),
            PdfPageKit.gridRow('Type', payment.paymentType.label, _style, isLast: true),
          ],
        ),
      ),
      PdfPageKit.box(
        'RECEIVED FROM',
        _style,
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.kv('Name', payment.payerName, _style),
            PdfPageKit.kv('Mobile', payment.payerPhone, _style),
            PdfPageKit.kv(
              'Against',
              bill != null
                  ? 'Bill ${bill.billNo}'
                  : (payment.against.trim().isEmpty ? 'On account' : payment.against.trim()),
              _style,
            ),
            if (payment.referenceNo.trim().isNotEmpty)
              PdfPageKit.kv('Reference', payment.referenceNo, _style),
          ],
        ),
      ),
    ]);
  }

  pw.Widget _amountBand(PaymentModel payment) {
    return pw.Container(
      width: double.infinity,
      decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
      child: pw.Column(
        children: [
          pw.Container(
            width: double.infinity,
            color: _style.primary,
            padding: const pw.EdgeInsets.symmetric(vertical: 8),
            alignment: pw.Alignment.center,
            child: pw.Text(
              'AMOUNT RECEIVED  ${PdfPageKit.money(payment.amount)}',
              style: pw.TextStyle(
                fontSize: 14,
                fontWeight: pw.FontWeight.bold,
                color: _style.onPrimary,
              ),
            ),
          ),
          pw.Padding(
            padding: const pw.EdgeInsets.all(6),
            child: pw.Text(
              AmountInWords.convert(payment.amount),
              textAlign: pw.TextAlign.center,
              style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }

  pw.Widget _detailBox(PaymentModel payment, BillModel? bill, double? balanceAfter) {
    return pw.Container(
      decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
      child: pw.Column(
        children: [
          if (bill != null) ...[
            PdfPageKit.gridRow('Bill Total', PdfPageKit.money(bill.grandTotal), _style),
            PdfPageKit.gridRow('Received Against This Bill',
                PdfPageKit.money(bill.amountPaid), _style),
            PdfPageKit.gridRow('Balance On This Bill',
                PdfPageKit.money(bill.balanceDue), _style, bold: true),
          ],
          if (balanceAfter != null)
            PdfPageKit.gridRow(
              balanceAfter >= 0 ? 'Total Outstanding' : 'Advance With Us',
              PdfPageKit.money(balanceAfter.abs()),
              _style,
              bold: true,
            ),
          if (payment.notes.trim().isNotEmpty)
            PdfPageKit.gridRow('Note', payment.notes.trim(), _style, isLast: true),
        ],
      ),
    );
  }
}
