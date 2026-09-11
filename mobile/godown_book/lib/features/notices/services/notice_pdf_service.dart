import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../../core/utils/amount_in_words.dart';
import '../../company/models/company_model.dart';
import '../models/notice_model.dart';

/// The letter itself - a reminder, a final notice, or the notice given
/// before goods are disposed of.
///
/// The wording is deliberately plain and makes no legal claim the
/// operator cannot back: it states the amount, the date it was taken
/// on, the date to pay by, and what the storage agreement allows. It
/// never threatens anything the agreement does not provide for.
class NoticePdfService {
  NoticePdfService._();

  static final NoticePdfService instance = NoticePdfService._();

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);

  Future<Uint8List> build(
    NoticeModel notice,
    CompanyModel? company, {
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);

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
            PdfPageKit.footer(context, company, leftLabel: notice.kind.label),
        build: (context) => [
          ...PdfPageKit.top(company, logo, _style, notice.kind.heading),
          _addressBlock(notice),
          pw.SizedBox(height: 10),
          _subject(notice),
          pw.SizedBox(height: 8),
          ..._body(notice, company),
          pw.SizedBox(height: 14),
          _amountBand(notice),
          pw.SizedBox(height: 18),
          PdfPageKit.signatures(
            company,
            signature,
            _style,
            otherParties: const ['Received / Sent on'],
          ),
          pw.SizedBox(height: 10),
          _deliveryNote(),
        ],
      ),
    );

    return document.save();
  }

  pw.Widget _addressBlock(NoticeModel n) {
    return pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Expanded(
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text('To,',
                  style: const pw.TextStyle(fontSize: 8.5)),
              pw.SizedBox(height: 2),
              pw.Text(n.customerName,
                  style: pw.TextStyle(fontSize: 9.5, fontWeight: pw.FontWeight.bold)),
              if (n.customerAddress.trim().isNotEmpty)
                pw.Text(n.customerAddress.trim(),
                    style: const pw.TextStyle(fontSize: 8.5)),
              if (n.customerPhone.trim().isNotEmpty)
                pw.Text('Mobile: ${n.customerPhone}',
                    style: const pw.TextStyle(fontSize: 8.5)),
            ],
          ),
        ),
        pw.SizedBox(width: 12),
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.end,
          children: [
            pw.Text('Notice No.: ${n.noticeNo}',
                style: pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold)),
            pw.Text('Date: ${PdfPageKit.date(n.noticeDate)}',
                style: const pw.TextStyle(fontSize: 8.5)),
          ],
        ),
      ],
    );
  }

  pw.Widget _subject(NoticeModel n) {
    final about = n.bookingNo.trim().isEmpty
        ? 'storage charges outstanding'
        : 'storage charges outstanding on Storage Receipt ${n.bookingNo}';

    return pw.Text(
      'Subject: ${n.kind.label} - $about',
      style: pw.TextStyle(
        fontSize: 9,
        fontWeight: pw.FontWeight.bold,
        color: _style.primary,
      ),
    );
  }

  List<pw.Widget> _body(NoticeModel n, CompanyModel? company) {
    final amount = PdfPageKit.money(n.amountDue);
    final asOn = n.dueAsOn.trim().isEmpty
        ? PdfPageKit.date(n.noticeDate)
        : PdfPageKit.date(n.dueAsOn);
    final payBy = n.payByDate.trim().isEmpty ? '' : PdfPageKit.date(n.payByDate);
    final godown = (company?.companyName ?? '').trim();

    final paragraphs = <String>[];

    paragraphs.add(
      'Your goods are lying in our godown'
      '${n.bookingNo.trim().isEmpty ? '' : ' against Storage Receipt ${n.bookingNo}'}'
      '. As on $asOn, an amount of $amount '
      '(${AmountInWords.convert(n.amountDue)}) is outstanding towards storage '
      'charges.',
    );

    switch (n.kind) {
      case NoticeKind.reminder:
        paragraphs.add(
          'You are requested to kindly clear this amount'
          '${payBy.isEmpty ? '' : ' on or before $payBy'}. If the payment has '
          'already been made, please ignore this letter and share the payment '
          'details with us.',
        );
      case NoticeKind.finalNotice:
        paragraphs.add(
          'This is a final reminder. Please clear the outstanding amount'
          '${payBy.isEmpty ? '' : ' on or before $payBy'}. Until the dues are '
          'cleared, the goods will remain in our custody and will not be '
          'released, as provided in the storage agreement signed by you.',
        );
        paragraphs.add(
          'Storage charges continue to run for the whole period the goods '
          'remain in the godown.',
        );
      case NoticeKind.disposal:
        paragraphs.add(
          'Despite earlier reminders, the outstanding amount has not been '
          'paid. You are hereby given notice that if the dues are not cleared'
          '${payBy.isEmpty ? '' : ' on or before $payBy'}, '
          '${godown.isEmpty ? 'we' : godown} intends to dispose of the goods '
          'held against this storage record, as provided in the storage '
          'agreement signed by you, and to apply the proceeds towards the '
          'amount due.',
        );
        paragraphs.add(
          'Any amount recovered over and above the dues and the costs of sale '
          'will be paid back to you, and any shortfall will remain payable by '
          'you. You may avoid this by clearing the dues and collecting your '
          'goods before the above date.',
        );
    }

    if (n.bodyNote.trim().isNotEmpty) paragraphs.add(n.bodyNote.trim());

    paragraphs.add(
      'Please treat this as urgent. For any clarification, contact us on '
      '${(company?.mobile1 ?? '').trim().isEmpty ? 'the number printed above' : company!.mobile1}.',
    );

    return [
      for (final text in paragraphs)
        pw.Padding(
          padding: const pw.EdgeInsets.only(bottom: 6),
          child: pw.Text(
            text,
            textAlign: pw.TextAlign.justify,
            style: const pw.TextStyle(fontSize: 9, lineSpacing: 1.6),
          ),
        ),
    ];
  }

  pw.Widget _amountBand(NoticeModel n) {
    return pw.Container(
      width: double.infinity,
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfPageKit.black, width: 0.7),
      ),
      padding: const pw.EdgeInsets.all(7),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text('AMOUNT OUTSTANDING',
              style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold)),
          pw.Text(
            PdfPageKit.money(n.amountDue),
            style: pw.TextStyle(
              fontSize: 11,
              fontWeight: pw.FontWeight.bold,
              color: _style.primary,
            ),
          ),
        ],
      ),
    );
  }

  pw.Widget _deliveryNote() {
    return pw.Text(
      'A copy of this letter is retained in our records along with the date '
      'and manner of sending.',
      style: const pw.TextStyle(fontSize: 6.5),
    );
  }
}
