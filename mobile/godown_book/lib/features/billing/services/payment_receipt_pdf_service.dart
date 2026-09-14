import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/constants/default_terms.dart';
import '../../../core/document_terms/document_terms_repository.dart';
import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_box_row.dart';
import '../../../core/document_theme/pdf_fonts.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../../core/utils/amount_in_words.dart';
import '../../company/models/company_model.dart';
import '../models/bill_model.dart';
import '../models/payment_model.dart';

/// The payment receipt - proof that money was received, and what it
/// leaves outstanding. The same paper, with different words on it,
/// serves as the advance receipt voucher, the deposit papers and the
/// credit note: one numbered entry, one printed record of it.
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

    final document = await PdfFonts.document();
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
            PdfPageKit.footer(context, company, leftLabel: _footerLabel(payment)),
        build: (context) => [
          ...PdfPageKit.top(company, logo, _style, _heading(payment)),
          _infoRow(payment, bill),
          pw.SizedBox(height: 8),
          _amountBand(payment),
          pw.SizedBox(height: 8),
          _detailBox(payment, bill, balanceAfter, company),
          pw.SizedBox(height: 6),
          PdfPageKit.terms(
            'Note :-',
            _customTerms.isNotEmpty
                ? _customTerms
                : DefaultStorageTerms.receiptTerms.join('\n'),
            _style,
          ),
          if (payment.needsRevenueStamp) ...[
            pw.SizedBox(height: 8),
            _revenueStamp(),
          ],
          pw.SizedBox(height: 16),
          PdfPageKit.signatures(
            company,
            signature,
            _style,
            otherParties: [_signatureParty(payment)],
          ),
        ],
      ),
    );

    return document.save();
  }

  /// The band across the top says which way the money went. A refund
  /// printed as "AMOUNT RECEIVED" has the customer signing for money he
  /// was paid, which is the opposite of what happened.
  String _bandLabel(PaymentModel payment) => switch (payment.paymentType) {
        PaymentType.creditNote => 'AMOUNT CREDITED',
        PaymentType.depositRefund => 'AMOUNT REFUNDED',
        PaymentType.depositAdjusted => 'AMOUNT ADJUSTED',
        _ => 'AMOUNT RECEIVED',
      };

  /// Who signs, and for what. On a refund the godown is the one paying
  /// out, so the customer acknowledges receipt of the money.
  String _signatureParty(PaymentModel payment) => switch (payment.paymentType) {
        PaymentType.creditNote => 'Customer (Acknowledged)',
        PaymentType.depositAdjusted => 'Customer (Acknowledged)',
        PaymentType.depositRefund => 'Received By (Signature)',
        _ => 'Received From (Signature)',
      };

  /// A deposit is not a payment and money going back is not a receipt -
  /// the paper has to say which one it is.
  String _heading(PaymentModel payment) => switch (payment.paymentType) {
        PaymentType.advance => 'ADVANCE RECEIPT VOUCHER',
        PaymentType.securityDeposit => 'SECURITY DEPOSIT RECEIPT',
        PaymentType.depositRefund => 'DEPOSIT REFUND VOUCHER',
        PaymentType.depositAdjusted => 'DEPOSIT ADJUSTMENT NOTE',
        PaymentType.creditNote => 'CREDIT NOTE',
        _ => 'PAYMENT RECEIPT',
      };

  String _footerLabel(PaymentModel payment) => switch (payment.paymentType) {
        PaymentType.advance => 'Advance Receipt Voucher',
        PaymentType.securityDeposit => 'Security Deposit Receipt',
        PaymentType.depositRefund => 'Deposit Refund Voucher',
        PaymentType.depositAdjusted => 'Deposit Adjustment Note',
        PaymentType.creditNote => 'Credit Note',
        _ => 'Payment Receipt',
      };

  /// The one line that says what this paper does, printed under the
  /// figures so nobody has to guess.
  String _meaning(PaymentModel payment, BillModel? bill) =>
      switch (payment.paymentType) {
        PaymentType.advance =>
          'Advance received against storage charges (SAC 996729). It will '
              'be adjusted in the tax invoice raised for the storage period. '
              'Issued as a receipt voucher under Rule 50 of the CGST Rules, '
              '2017; this voucher is not a tax invoice.',
        PaymentType.creditNote => bill != null
            ? 'This credit note is issued under section 34 of the CGST Act, '
                '2017 and reduces the amount payable against Invoice '
                '${bill.billNo}. No money has changed hands.'
            : 'This credit note reduces the amount payable on the '
                'customer\'s account. No money has changed hands.',
        PaymentType.securityDeposit =>
          'Security deposit held for the customer. It is refundable when '
              'the goods are collected and all charges are settled.',
        PaymentType.depositRefund =>
          'Security deposit returned to the customer.',
        PaymentType.depositAdjusted =>
          'Security deposit applied against the charges outstanding.',
        _ => '',
      };

  pw.Widget _infoRow(PaymentModel payment, BillModel? bill) {
    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead(payment.isCreditNote ? 'CREDIT NOTE' : 'RECEIPT', _style),
            PdfPageKit.gridRow(
                payment.isCreditNote ? 'Credit Note No.' : 'Receipt No.',
                payment.receiptNo,
                _style,
                bold: true),
            PdfPageKit.gridRow('Date', PdfPageKit.date(payment.paymentDate), _style, bold: true),
            if (!payment.isCreditNote)
              PdfPageKit.gridRow('Mode', payment.mode.label, _style),
            PdfPageKit.gridRow('Type', payment.paymentType.label, _style, isLast: true),
          ],
        ),
      ),
      PdfPageKit.box(
        payment.isCreditNote ? 'ISSUED TO' : 'RECEIVED FROM',
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
              '${_bandLabel(payment)}  '
              '${PdfPageKit.money(payment.amount)}',
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

  /// A receipt for cash above Rs. 5,000 needs a one-rupee revenue stamp
  /// (Indian Stamp Act, 1899, Schedule I, Article 53) - a box on the
  /// paper for it, so it is not forgotten.
  pw.Widget _revenueStamp() {
    return pw.Row(
      mainAxisAlignment: pw.MainAxisAlignment.end,
      children: [
        pw.Container(
          width: 80,
          height: 48,
          alignment: pw.Alignment.center,
          decoration: pw.BoxDecoration(
            border: pw.Border.all(color: PdfPageKit.black, width: 0.5),
          ),
          child: pw.Text(
            'Affix Re. 1\nRevenue Stamp\n(cash above Rs. 5,000)',
            textAlign: pw.TextAlign.center,
            style: const pw.TextStyle(fontSize: 6),
          ),
        ),
      ],
    );
  }

  pw.Widget _detailBox(
    PaymentModel payment,
    BillModel? bill,
    double? balanceAfter,
    CompanyModel? company,
  ) {
    final meaning = _meaning(payment, bill);
    final noteLabel = payment.isCreditNote ? 'Reason' : 'Note';
    final hasGst = (company?.gstNumber ?? '').trim().isNotEmpty;

    // A credit note against a taxed invoice credits tax as well as
    // value, and Rule 53 wants both shown, with the invoice it reduces.
    final gstOnNote = payment.isCreditNote && bill != null && bill.gstPercent > 0
        ? payment.amount - payment.amount / (1 + bill.gstPercent / 100)
        : 0.0;

    return pw.Container(
      decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
      child: pw.Column(
        children: [
          if (payment.isCreditNote && bill != null) ...[
            PdfPageKit.gridRow('Against Invoice',
                '${bill.billNo} dated ${PdfPageKit.date(bill.billDate)}', _style),
            if (gstOnNote > 0.004) ...[
              PdfPageKit.gridRow('Taxable Value Credited',
                  PdfPageKit.money(payment.amount - gstOnNote), _style),
              PdfPageKit.gridRow(
                  'GST Credited (${bill.gstPercent.toStringAsFixed(2)}%)',
                  PdfPageKit.money(gstOnNote),
                  _style),
            ],
          ],
          if (payment.paymentType == PaymentType.advance && hasGst) ...[
            PdfPageKit.gridRow('Place of Supply', (company?.state ?? '').trim().isEmpty
                ? '-' : company!.state.trim(), _style),
            PdfPageKit.gridRow('Reverse Charge', 'No', _style),
          ],
          if (bill != null) ...[
            PdfPageKit.gridRow('Bill Total', PdfPageKit.money(bill.grandTotal), _style),
            PdfPageKit.gridRow('Received / Credited Against This Bill',
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
            PdfPageKit.gridRow(noteLabel, payment.notes.trim(), _style,
                isLast: meaning.isEmpty),
          if (meaning.isNotEmpty)
            pw.Container(
              width: double.infinity,
              padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 5),
              child: pw.Text(
                meaning,
                style: const pw.TextStyle(fontSize: 7.5, lineSpacing: 1.4),
              ),
            ),
        ],
      ),
    );
  }
}
