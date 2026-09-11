import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_box_row.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../../core/utils/amount_in_words.dart';
import '../../company/models/company_model.dart';
import '../models/consignment_model.dart';

/// The three papers one consignment produces.
enum BiltyPaper {
  /// The carrier's own receipt for the goods - the bilty.
  lorryReceipt,

  /// What the consignor signs and hands over with the goods.
  forwardingNote,

  /// Goods moving without a tax invoice.
  deliveryChallan;

  String get label => switch (this) {
        BiltyPaper.lorryReceipt => 'Lorry Receipt',
        BiltyPaper.forwardingNote => 'Goods Forwarding Note',
        BiltyPaper.deliveryChallan => 'Delivery Challan',
      };

  String get shortLabel => switch (this) {
        BiltyPaper.lorryReceipt => 'Bilty / LR',
        BiltyPaper.forwardingNote => 'Forwarding Note',
        BiltyPaper.deliveryChallan => 'Delivery Challan',
      };
}

/// Prints the bilty pack from one consignment record.
///
/// The wording follows ordinary Indian road-transport practice: the
/// forwarding note carries the consignor's declaration of value and of
/// dangerous goods, and the lorry receipt is the carrier's
/// acknowledgement of what was handed over. Neither claims anything
/// beyond that.
class ConsignmentPdfService {
  ConsignmentPdfService._();

  static final ConsignmentPdfService instance = ConsignmentPdfService._();

  /// The copies a bilty is written in. The driver's copy travels with
  /// the truck, which is what a checkpost asks to see.
  static const List<String> copyLabels = [
    'CONSIGNOR COPY',
    'CONSIGNEE COPY',
    'DRIVER COPY',
    'OFFICE COPY',
  ];

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);

  Future<Uint8List> build(
    ConsignmentModel consignment,
    CompanyModel? company, {
    required BiltyPaper paper,
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,
    List<String>? copies,
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);

    final document = pw.Document();
    final logo = await PdfPageKit.loadImage(company?.logoPath ?? '');
    final signature = await PdfPageKit.loadImage(company?.signaturePath ?? '');

    final selected = paper == BiltyPaper.lorryReceipt
        ? (copies == null || copies.isEmpty
            ? copyLabels
            : copyLabels.where(copies.contains).toList())
        : const [''];

    for (final copyLabel in selected) {
      document.addPage(
        pw.MultiPage(
          pageTheme: PdfPageKit.pageTheme(
            style: _style,
            showWatermark: showWatermark,
            watermarkText: watermarkText,
            watermarkOpacity: watermarkOpacity,
          ),
          footer: (context) => PdfPageKit.footer(
            context,
            company,
            leftLabel: copyLabel.isEmpty ? paper.label : copyLabel,
          ),
          build: (context) => switch (paper) {
            BiltyPaper.lorryReceipt =>
              _lorryReceipt(consignment, company, logo, signature, copyLabel),
            BiltyPaper.forwardingNote =>
              _forwardingNote(consignment, company, logo),
            BiltyPaper.deliveryChallan =>
              _deliveryChallan(consignment, company, logo, signature),
          },
        ),
      );
    }

    return document.save();
  }

  // ==========================
  // Lorry Receipt (bilty)
  // ==========================

  List<pw.Widget> _lorryReceipt(
    ConsignmentModel c,
    CompanyModel? company,
    Uint8List? logo,
    Uint8List? signature,
    String copyLabel,
  ) {
    return [
      ...PdfPageKit.top(
        company,
        logo,
        _style,
        'LORRY RECEIPT (CONSIGNMENT NOTE)  -  $copyLabel',
      ),
      _partiesRow(c),
      pw.SizedBox(height: 5),
      _vehicleRow(c),
      pw.SizedBox(height: 5),
      _itemsTable(c),
      pw.SizedBox(height: 5),
      _freightRow(c),
      pw.SizedBox(height: 5),
      _declaredValueBand(c),
      pw.SizedBox(height: 5),
      _eWayBillNote(),
      if (c.notes.trim().isNotEmpty) ...[
        pw.SizedBox(height: 5),
        PdfPageKit.box(
          'REMARKS',
          _style,
          pw.Text(c.notes.trim(), style: const pw.TextStyle(fontSize: 7.5)),
        ),
      ],
      pw.SizedBox(height: 5),
      _lrTerms(c),
      if (c.isDelivered) ...[
        pw.SizedBox(height: 5),
        _deliveryBand(c),
      ],
      pw.SizedBox(height: 14),
      PdfPageKit.signatures(
        company,
        signature,
        _style,
        otherParties: const ['Consignor (Signature)', 'Driver (Signature)'],
      ),
    ];
  }

  pw.Widget _partiesRow(ConsignmentModel c) {
    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(
            border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('CONSIGNMENT', _style),
            PdfPageKit.gridRow('LR No.', c.lrNo, _style, bold: true),
            PdfPageKit.gridRow('Date', PdfPageKit.date(c.lrDate), _style, bold: true),
            PdfPageKit.gridRow('From', c.fromPlace.isEmpty ? '-' : c.fromPlace, _style),
            PdfPageKit.gridRow('To', c.toPlace.isEmpty ? '-' : c.toPlace, _style),
            PdfPageKit.gridRow('Status', c.status.label, _style, isLast: true),
          ],
        ),
      ),
      PdfPageKit.box(
        'CONSIGNOR (FROM)',
        _style,
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.kv('Name', c.consignorName, _style),
            if (c.consignorPhone.trim().isNotEmpty)
              PdfPageKit.kv('Mobile', c.consignorPhone, _style),
            if (c.consignorAddress.trim().isNotEmpty)
              PdfPageKit.kv('Address', c.consignorAddress, _style),
            if (c.consignorGst.trim().isNotEmpty)
              PdfPageKit.kv('GST No.', c.consignorGst, _style),
          ],
        ),
      ),
      PdfPageKit.box(
        'CONSIGNEE (TO)',
        _style,
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.kv('Name', c.consigneeName.isEmpty ? '-' : c.consigneeName,
                _style),
            if (c.consigneePhone.trim().isNotEmpty)
              PdfPageKit.kv('Mobile', c.consigneePhone, _style),
            if (c.consigneeAddress.trim().isNotEmpty)
              PdfPageKit.kv('Address', c.consigneeAddress, _style),
            if (c.consigneeGst.trim().isNotEmpty)
              PdfPageKit.kv('GST No.', c.consigneeGst, _style),
          ],
        ),
      ),
    ]);
  }

  pw.Widget _vehicleRow(ConsignmentModel c) {
    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(
            border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('VEHICLE & DRIVER', _style),
            PdfPageKit.gridRow('Vehicle No.',
                c.vehicleNumber.isEmpty ? '-' : c.vehicleNumber, _style, bold: true),
            PdfPageKit.gridRow(
                'Driver', c.driverName.isEmpty ? '-' : c.driverName, _style),
            PdfPageKit.gridRow(
                'Driver Mobile', c.driverPhone.isEmpty ? '-' : c.driverPhone, _style),
            PdfPageKit.gridRow('Licence No.',
                c.driverLicence.isEmpty ? '-' : c.driverLicence, _style, isLast: true),
          ],
        ),
      ),
      pw.Container(
        decoration: pw.BoxDecoration(
            border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('LOAD', _style),
            PdfPageKit.gridRow('Packages', '${c.totalPackages}', _style, bold: true),
            PdfPageKit.gridRow(
                'Weight', c.weight.isEmpty ? 'Not weighed' : c.weight, _style),
            PdfPageKit.gridRow('Risk', c.riskBasis.label, _style),
            PdfPageKit.gridRow(
              'Insurance',
              c.insured
                  ? [c.insurer, c.policyNo].where((s) => s.trim().isNotEmpty).join(' / ')
                  : 'Not insured by us',
              _style,
              isLast: true,
            ),
          ],
        ),
      ),
    ]);
  }

  pw.Widget _itemsTable(ConsignmentModel c) {
    if (c.items.isEmpty) {
      return PdfPageKit.box(
        'DESCRIPTION OF GOODS (SAID TO CONTAIN)',
        _style,
        pw.Text(
          c.goodsDescription.trim().isEmpty
              ? 'Household goods, packed by the consignor.'
              : c.goodsDescription.trim(),
          style: const pw.TextStyle(fontSize: 8),
        ),
      );
    }

    final rows = <List<String>>[];
    for (var i = 0; i < c.items.length; i++) {
      final item = c.items[i];
      rows.add([
        '${i + 1}',
        item.itemName,
        PdfPageKit.qty(item.quantity),
        item.unit,
        [item.marks, item.conditionNote]
            .where((s) => s.trim().isNotEmpty)
            .join(' / '),
      ]);
    }

    return PdfPageKit.table(
      const ['Sr.', 'Description of Goods (said to contain)', 'Qty', 'Unit', 'Marks / Condition'],
      rows,
      _style,
      columnWidths: const {
        0: pw.FixedColumnWidth(22),
        1: pw.FlexColumnWidth(5),
        2: pw.FixedColumnWidth(42),
        3: pw.FixedColumnWidth(42),
        4: pw.FlexColumnWidth(3),
      },
      aligns: const [
        pw.TextAlign.center,
        pw.TextAlign.left,
        pw.TextAlign.right,
        pw.TextAlign.center,
        pw.TextAlign.left,
      ],
      totals: [
        '',
        'Total packages',
        '${c.totalPackages}',
        '',
        '',
      ],
    );
  }

  pw.Widget _freightRow(ConsignmentModel c) {
    pw.Widget line(String label, String value, {bool bold = false}) =>
        PdfPageKit.gridRow(label, value, _style, bold: bold);

    return PdfBoxRow.equal(gap: 4, [
      pw.Container(
        decoration: pw.BoxDecoration(
            border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('FREIGHT', _style),
            line('Basis', c.freightBasis.label, bold: true),
            line('Freight', PdfPageKit.money(c.freightAmount)),
            if (c.otherCharges > 0.004)
              line('Other charges', PdfPageKit.money(c.otherCharges)),
            if (c.advancePaid > 0.004)
              line('Advance paid', PdfPageKit.money(c.advancePaid)),
            PdfPageKit.gridRow(
              c.freightBasis == FreightBasis.paid ? 'Paid' : 'Balance to pay',
              PdfPageKit.money(
                  c.freightBasis == FreightBasis.paid ? c.freightTotal : c.freightBalance),
              _style,
              bold: true,
              isLast: true,
            ),
          ],
        ),
      ),
      pw.Container(
        decoration: pw.BoxDecoration(
            border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        alignment: pw.Alignment.center,
        padding: const pw.EdgeInsets.all(8),
        child: pw.Text(
          c.freightBasis == FreightBasis.toBeBilled
              ? 'Freight will be charged on the storage bill.'
              : '${c.freightBasis.label}: '
                  '${AmountInWords.convert(c.freightBasis == FreightBasis.paid ? c.freightTotal : c.freightBalance)}',
          textAlign: pw.TextAlign.center,
          style: pw.TextStyle(
            fontSize: 8.5,
            fontWeight: pw.FontWeight.bold,
            color: _style.primary,
          ),
        ),
      ),
    ]);
  }

  pw.Widget _declaredValueBand(ConsignmentModel c) {
    return pw.Container(
      width: double.infinity,
      decoration: pw.BoxDecoration(
          border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
      padding: const pw.EdgeInsets.all(6),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Expanded(
            child: pw.Text(
              c.declaredValue > 0.004
                  ? 'Value declared by the consignor. The carrier\'s liability is '
                      'limited to this declared value.'
                  : 'The consignor has not declared a value for these goods.',
              style: const pw.TextStyle(fontSize: 7.5),
            ),
          ),
          pw.SizedBox(width: 10),
          pw.Text(
            c.declaredValue > 0.004
                ? 'DECLARED VALUE: ${PdfPageKit.money(c.declaredValue)}'
                : 'DECLARED VALUE: NOT DECLARED',
            style: pw.TextStyle(
              fontSize: 9,
              fontWeight: pw.FontWeight.bold,
              color: _style.primary,
            ),
          ),
        ],
      ),
    );
  }

  /// Used household effects are exempt from the e-way bill, and the
  /// paper says so - it is the one thing a checkpost argument turns on,
  /// and customers are often charged for a bill they do not need.
  pw.Widget _eWayBillNote() {
    return pw.Container(
      width: double.infinity,
      decoration: pw.BoxDecoration(
          border: pw.Border.all(color: PdfPageKit.black, width: 0.5)),
      padding: const pw.EdgeInsets.all(5),
      child: pw.Text(
        'USED PERSONAL AND HOUSEHOLD EFFECTS - no e-way bill is required for '
        'these goods (Annexure to Rule 138(14), CGST Rules 2017). This '
        'consignment is not a sale of goods.',
        style: const pw.TextStyle(fontSize: 7),
      ),
    );
  }

  pw.Widget _lrTerms(ConsignmentModel c) {
    final terms = c.terms.trim().isNotEmpty
        ? c.terms.trim()
        : [
            'Goods are accepted on the basis of the count and description '
                'declared by the consignor; the contents of packed items have '
                'not been checked.',
            'Goods travel at ${c.riskBasis == RiskBasis.carrier ? "the carrier's risk as agreed" : "the owner's risk"} '
                'and are not insured by the carrier unless stated above.',
            'Delivery will be given to the consignee named above, or to a '
                'person authorised by them in writing, after freight and other '
                'charges are paid.',
            'Any claim for loss or damage must be made in writing, and the '
                'consignee should note any shortage or damage on this receipt '
                'at the time of delivery.',
          ].join('\n');

    return PdfPageKit.terms('Terms :-', terms, _style);
  }

  pw.Widget _deliveryBand(ConsignmentModel c) {
    return PdfPageKit.box(
      'DELIVERY',
      _style,
      pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          PdfPageKit.kv('Delivered on', PdfPageKit.date(c.deliveredOn), _style),
          PdfPageKit.kv('Received by', c.receivedBy, _style),
          if (c.deliveryRemarks.trim().isNotEmpty)
            PdfPageKit.kv('Remarks', c.deliveryRemarks.trim(), _style),
        ],
      ),
    );
  }

  // ==========================
  // Goods Forwarding Note
  // ==========================

  List<pw.Widget> _forwardingNote(
    ConsignmentModel c,
    CompanyModel? company,
    Uint8List? logo,
  ) {
    final carrier = (company?.companyName ?? '').trim().isEmpty
        ? 'the carrier'
        : company!.companyName.trim();

    final paragraphs = <String>[
      'I, ${c.consignorName}, am handing over the goods listed below to '
          '$carrier for carriage by road from '
          '${c.fromPlace.isEmpty ? '__________' : c.fromPlace} to '
          '${c.toPlace.isEmpty ? '__________' : c.toPlace}, to be delivered to '
          '${c.consigneeName.isEmpty ? '__________' : c.consigneeName}.',
      c.declaredValue > 0.004
          ? 'I declare the value of these goods to be '
              '${PdfPageKit.money(c.declaredValue)} '
              '(${AmountInWords.convert(c.declaredValue)}).'
          : 'I have been asked to declare the value of these goods and have '
              'chosen not to do so. I understand that this limits what I can '
              'claim if the goods are lost or damaged.',
      'I declare that the consignment contains no dangerous, hazardous, '
          'inflammable, explosive, perishable or illegal goods, and no cash, '
          'jewellery or important documents.',
      'The particulars given here are correct and complete, and I shall make '
          'good any loss the carrier suffers because of any particular that is '
          'wrong or missing.',
    ];

    return [
      ...PdfPageKit.top(company, logo, _style, 'GOODS FORWARDING NOTE'),
      _noteHeader(c),
      pw.SizedBox(height: 10),
      for (final text in paragraphs)
        pw.Padding(
          padding: const pw.EdgeInsets.only(bottom: 7),
          child: pw.Text(
            text,
            textAlign: pw.TextAlign.justify,
            style: const pw.TextStyle(fontSize: 9, lineSpacing: 1.6),
          ),
        ),
      pw.SizedBox(height: 4),
      _itemsTable(c),
      pw.SizedBox(height: 6),
      _declaredValueBand(c),
      pw.SizedBox(height: 24),
      pw.Row(
        children: [
          pw.Expanded(
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Container(
                    width: double.infinity, height: 0.6, color: PdfPageKit.black),
                pw.SizedBox(height: 3),
                pw.Text('Signature of ${c.consignorName}',
                    style: pw.TextStyle(
                        fontSize: 7.5, fontWeight: pw.FontWeight.bold)),
                pw.Text('Mobile: ${c.consignorPhone}',
                    style: const pw.TextStyle(fontSize: 6.5)),
              ],
            ),
          ),
          pw.SizedBox(width: 18),
          pw.Expanded(
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Container(
                    width: double.infinity, height: 0.6, color: PdfPageKit.black),
                pw.SizedBox(height: 3),
                pw.Text('Received by (for $carrier)',
                    style: pw.TextStyle(
                        fontSize: 7.5, fontWeight: pw.FontWeight.bold)),
                pw.Text('Date and time',
                    style: const pw.TextStyle(fontSize: 6.5)),
              ],
            ),
          ),
        ],
      ),
    ];
  }

  pw.Widget _noteHeader(ConsignmentModel c) {
    return PdfBoxRow.equal(gap: 4, [
      PdfPageKit.box(
        'CONSIGNOR',
        _style,
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.kv('Name', c.consignorName, _style),
            if (c.consignorPhone.trim().isNotEmpty)
              PdfPageKit.kv('Mobile', c.consignorPhone, _style),
            if (c.consignorAddress.trim().isNotEmpty)
              PdfPageKit.kv('Address', c.consignorAddress, _style),
          ],
        ),
      ),
      pw.Container(
        decoration: pw.BoxDecoration(
            border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            PdfPageKit.boxHead('AGAINST', _style),
            PdfPageKit.gridRow('LR No.', c.lrNo, _style, bold: true),
            PdfPageKit.gridRow('Date', PdfPageKit.date(c.lrDate), _style),
            PdfPageKit.gridRow('Vehicle No.',
                c.vehicleNumber.isEmpty ? '-' : c.vehicleNumber, _style),
            PdfPageKit.gridRow('Packages', '${c.totalPackages}', _style, isLast: true),
          ],
        ),
      ),
    ]);
  }

  // ==========================
  // Delivery Challan
  // ==========================

  List<pw.Widget> _deliveryChallan(
    ConsignmentModel c,
    CompanyModel? company,
    Uint8List? logo,
    Uint8List? signature,
  ) {
    return [
      ...PdfPageKit.top(company, logo, _style, 'DELIVERY CHALLAN'),
      PdfBoxRow.equal(gap: 4, [
        pw.Container(
          decoration: pw.BoxDecoration(
              border: pw.Border.all(color: PdfPageKit.black, width: 0.7)),
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              PdfPageKit.boxHead('CHALLAN', _style),
              PdfPageKit.gridRow(
                  'Challan No.', c.challanNo.isEmpty ? '-' : c.challanNo, _style,
                  bold: true),
              PdfPageKit.gridRow(
                'Date',
                PdfPageKit.date(c.challanDate.isEmpty ? c.lrDate : c.challanDate),
                _style,
                bold: true,
              ),
              PdfPageKit.gridRow('Against LR', c.lrNo, _style),
              PdfPageKit.gridRow('Vehicle No.',
                  c.vehicleNumber.isEmpty ? '-' : c.vehicleNumber, _style,
                  isLast: true),
            ],
          ),
        ),
        PdfPageKit.box(
          'FROM (CONSIGNOR)',
          _style,
          pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              PdfPageKit.kv('Name', c.consignorName, _style),
              if (c.consignorAddress.trim().isNotEmpty)
                PdfPageKit.kv('Address', c.consignorAddress, _style),
              PdfPageKit.kv('GST No.',
                  c.consignorGst.trim().isEmpty ? 'Unregistered' : c.consignorGst,
                  _style),
              PdfPageKit.kv('Place of despatch',
                  c.fromPlace.isEmpty ? '-' : c.fromPlace, _style),
            ],
          ),
        ),
        PdfPageKit.box(
          'TO (CONSIGNEE)',
          _style,
          pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              PdfPageKit.kv(
                  'Name', c.consigneeName.isEmpty ? '-' : c.consigneeName, _style),
              if (c.consigneeAddress.trim().isNotEmpty)
                PdfPageKit.kv('Address', c.consigneeAddress, _style),
              PdfPageKit.kv('GST No.',
                  c.consigneeGst.trim().isEmpty ? 'Unregistered' : c.consigneeGst,
                  _style),
              PdfPageKit.kv('Place of supply',
                  c.toPlace.isEmpty ? '-' : c.toPlace, _style),
            ],
          ),
        ),
      ]),
      pw.SizedBox(height: 5),
      _itemsTable(c),
      pw.SizedBox(height: 5),
      _declaredValueBand(c),
      pw.SizedBox(height: 5),
      pw.Container(
        width: double.infinity,
        decoration: pw.BoxDecoration(
            border: pw.Border.all(color: PdfPageKit.black, width: 0.5)),
        padding: const pw.EdgeInsets.all(6),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Text(
              'Issued under Rule 55 of the CGST Rules 2017. These goods are '
              'NOT being supplied or sold: they are the customer\'s own '
              'household goods being moved '
              '${c.bookingNo.trim().isEmpty ? 'by road' : 'to or from storage against Storage Receipt ${c.bookingNo}'}. '
              'The value shown is the value declared for transport, not a '
              'taxable supply value.',
              style: const pw.TextStyle(fontSize: 7),
            ),
            pw.SizedBox(height: 3),
            pw.Text(
              'USED PERSONAL AND HOUSEHOLD EFFECTS - no e-way bill is required '
              '(Annexure to Rule 138(14), CGST Rules 2017).',
              style: pw.TextStyle(fontSize: 7, fontWeight: pw.FontWeight.bold),
            ),
          ],
        ),
      ),
      pw.SizedBox(height: 16),
      PdfPageKit.signatures(
        company,
        signature,
        _style,
        otherParties: const ['Received the goods (Signature)'],
      ),
    ];
  }
}
