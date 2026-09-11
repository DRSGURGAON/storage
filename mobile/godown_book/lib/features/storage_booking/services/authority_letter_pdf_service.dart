import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../company/models/company_model.dart';
import '../models/storage_booking_model.dart';

/// The two papers that decide whether goods may be handed over.
enum HandoverPaper {
  /// The customer authorises somebody else to collect their goods.
  authority,

  /// The customer takes responsibility when the receipt is lost, or
  /// when they are asking for a handover the paperwork does not cover.
  indemnity;

  String get label => switch (this) {
        HandoverPaper.authority => 'Authority Letter',
        HandoverPaper.indemnity => 'Indemnity Bond',
      };

  String get heading => switch (this) {
        HandoverPaper.authority => 'AUTHORITY LETTER',
        HandoverPaper.indemnity => 'INDEMNITY BOND',
      };
}

/// Details the operator fills in for the person who will collect.
class HandoverDetails {
  final String personName;
  final String personPhone;
  final String personIdProof;
  final String relation;
  final String reason;

  const HandoverDetails({
    this.personName = '',
    this.personPhone = '',
    this.personIdProof = '',
    this.relation = '',
    this.reason = '',
  });
}

/// Prints the letter for the customer to sign. Both papers are written
/// from the customer to the godown - the app only fills in what it
/// already knows, so nothing is typed twice.
///
/// The wording is a plain undertaking. It is not drafted as, and must
/// not be described as, a legally vetted instrument: an operator with a
/// high-value dispute should have their own lawyer look at it, and a
/// bond on stamp paper is a separate matter the app does not handle.
class AuthorityLetterPdfService {
  AuthorityLetterPdfService._();

  static final AuthorityLetterPdfService instance = AuthorityLetterPdfService._();

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);

  Future<Uint8List> build(
    StorageBookingModel booking,
    CompanyModel? company, {
    required HandoverPaper paper,
    HandoverDetails details = const HandoverDetails(),
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);

    final document = pw.Document();
    final logo = await PdfPageKit.loadImage(company?.logoPath ?? '');

    document.addPage(
      pw.MultiPage(
        pageTheme: PdfPageKit.pageTheme(
          style: _style,
          showWatermark: showWatermark,
          watermarkText: watermarkText,
          watermarkOpacity: watermarkOpacity,
        ),
        footer: (context) =>
            PdfPageKit.footer(context, company, leftLabel: paper.label),
        build: (context) => [
          ...PdfPageKit.top(company, logo, _style, paper.heading),
          _toBlock(booking, company),
          pw.SizedBox(height: 12),
          ..._body(booking, company, paper, details),
          pw.SizedBox(height: 10),
          _detailsBox(booking, details),
          pw.SizedBox(height: 26),
          _signBlock(booking, paper),
        ],
      ),
    );

    return document.save();
  }

  pw.Widget _toBlock(StorageBookingModel b, CompanyModel? company) {
    return pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Expanded(
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text('To,', style: const pw.TextStyle(fontSize: 8.5)),
              pw.SizedBox(height: 2),
              pw.Text(
                (company?.companyName ?? '').isEmpty
                    ? 'The Godown Keeper'
                    : company!.companyName,
                style: pw.TextStyle(fontSize: 9.5, fontWeight: pw.FontWeight.bold),
              ),
              if ((company?.address ?? '').trim().isNotEmpty)
                pw.Text(company!.address.trim(),
                    style: const pw.TextStyle(fontSize: 8.5)),
            ],
          ),
        ),
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.end,
          children: [
            pw.Text('Storage Receipt: ${b.bookingNo}',
                style: pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold)),
            pw.Text('Date: ______________',
                style: const pw.TextStyle(fontSize: 8.5)),
          ],
        ),
      ],
    );
  }

  List<pw.Widget> _body(
    StorageBookingModel b,
    CompanyModel? company,
    HandoverPaper paper,
    HandoverDetails details,
  ) {
    final godown = (company?.companyName ?? '').trim().isEmpty
        ? 'your godown'
        : company!.companyName.trim();
    final person = details.personName.trim().isEmpty
        ? '______________________'
        : details.personName.trim();

    final paragraphs = <String>[];

    paragraphs.add(
      'I, ${b.customerName}, have kept my household goods in $godown against '
      'Storage Receipt No. ${b.bookingNo}'
      '${b.storageStartDate.trim().isEmpty ? '' : ' dated ${PdfPageKit.date(b.storageStartDate)}'}.',
    );

    switch (paper) {
      case HandoverPaper.authority:
        paragraphs.add(
          'I authorise $person'
          '${details.relation.trim().isEmpty ? '' : ' (${details.relation.trim()})'} '
          'to collect the goods on my behalf. Please hand over the goods to '
          'them after verifying their identity.',
        );
        paragraphs.add(
          'Whatever is handed over to the person named above shall be treated '
          'as handed over to me, and I shall have no claim against you in '
          'respect of that handover.',
        );
      case HandoverPaper.indemnity:
        paragraphs.add(
          details.reason.trim().isEmpty
              ? 'My copy of the storage receipt is not available, and I still '
                  'request you to release the goods to me or to the person '
                  'named below.'
              : details.reason.trim(),
        );
        paragraphs.add(
          'I confirm that the goods are mine, that I have not transferred them '
          'or pledged them to anybody else, and that no other person has any '
          'claim on them. I undertake to make good any loss, claim or expense '
          'that you may suffer because you have released the goods on this '
          'request.',
        );
    }

    paragraphs.add(
      'All dues payable on this storage record have been, or will be, cleared '
      'before the goods are taken out.',
    );

    return [
      for (final text in paragraphs)
        pw.Padding(
          padding: const pw.EdgeInsets.only(bottom: 7),
          child: pw.Text(
            text,
            textAlign: pw.TextAlign.justify,
            style: const pw.TextStyle(fontSize: 9, lineSpacing: 1.7),
          ),
        ),
    ];
  }

  pw.Widget _detailsBox(StorageBookingModel b, HandoverDetails details) {
    pw.Widget line(String label, String value) => pw.Padding(
          padding: const pw.EdgeInsets.only(bottom: 3),
          child: pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.SizedBox(
                width: 120,
                child: pw.Text(label,
                    style: pw.TextStyle(
                        fontSize: 8, fontWeight: pw.FontWeight.bold)),
              ),
              pw.Expanded(
                child: pw.Text(
                  value.trim().isEmpty ? '_________________________' : value.trim(),
                  style: const pw.TextStyle(fontSize: 8),
                ),
              ),
            ],
          ),
        );

    return PdfPageKit.box(
      'PERSON COLLECTING THE GOODS',
      _style,
      pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          line('Name', details.personName),
          line('Mobile', details.personPhone),
          line('ID proof shown', details.personIdProof),
          line('Relation to me', details.relation),
          line('Goods', _goodsLine(b)),
        ],
      ),
    );
  }

  /// What is lying in the godown, in one line, so the letter says what
  /// it is about without the operator retyping it.
  String _goodsLine(StorageBookingModel b) {
    if (b.items.isNotEmpty) {
      return b.items
          .map((i) => '${i.itemName} - ${PdfPageKit.qty(i.quantity)} ${i.unit}')
          .join(', ');
    }
    return b.goodsDescription.trim();
  }

  pw.Widget _signBlock(StorageBookingModel b, HandoverPaper paper) {
    pw.Widget slot(String label, String subLabel) => pw.Expanded(
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.SizedBox(height: 34),
              pw.Container(width: double.infinity, height: 0.6, color: PdfPageKit.black),
              pw.SizedBox(height: 3),
              pw.Text(label,
                  style: pw.TextStyle(fontSize: 7.5, fontWeight: pw.FontWeight.bold)),
              pw.Text(subLabel,
                  style: const pw.TextStyle(fontSize: 6.5)),
            ],
          ),
        );

    return pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Row(
          children: [
            slot('Signature of ${b.customerName}', 'Mobile: ${b.customerPhone}'),
            pw.SizedBox(width: 18),
            slot('Witness', 'Name, mobile and signature'),
          ],
        ),
        pw.SizedBox(height: 10),
        pw.Text(
          paper == HandoverPaper.indemnity
              ? 'Where the value is high or there is a dispute, take this on '
                  'stamp paper and have it notarised.'
              : 'Attach a copy of the identity proof of the person collecting.',
          style: const pw.TextStyle(fontSize: 6.5),
        ),
      ],
    );
  }
}
