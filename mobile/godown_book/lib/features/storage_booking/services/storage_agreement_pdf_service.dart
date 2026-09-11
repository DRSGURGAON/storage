import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import '../../../core/constants/default_terms.dart';
import '../../../core/document_terms/document_terms_repository.dart';
import '../../../core/document_theme/document_theme.dart';
import '../../../core/document_theme/pdf_page_kit.dart';
import '../../../core/utils/amount_in_words.dart';
import '../../company/models/company_model.dart';
import '../models/storage_booking_model.dart';

/// The Household Goods Storage Agreement - a short agreement between
/// the storage operator and their customer for the goods on one storage
/// record: parties, schedule of goods and charges, and the terms both
/// sides sign. The wording comes from the company's own editable terms,
/// never from a claim this app makes about it.
class StorageAgreementPdfService {
  StorageAgreementPdfService._();

  static final StorageAgreementPdfService instance = StorageAgreementPdfService._();

  DocumentThemeStyle _style = DocumentThemeStyle.of(DocumentTheme.classic);
  String _customTerms = '';

  Future<Uint8List> build(
    StorageBookingModel booking,
    CompanyModel? company, {
    bool showWatermark = false,
    String watermarkText = '',
    double watermarkOpacity = 0.05,

    /// The customer's own signature, when they have signed from a
    /// link, and the note that prints under it.
    Uint8List? customerSignature,
    String customerSignatureNote = '',
  }) async {
    _style = DocumentThemeStyle.of(company?.documentTheme ?? DocumentTheme.classic);
    _customTerms = await DocumentTermsRepository.instance
        .getTerms(DocumentTermsType.storageAgreement);

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
        footer: (context) => PdfPageKit.footer(context, company, leftLabel: 'Storage Agreement'),
        build: (context) => [
          ...PdfPageKit.top(company, logo, _style, 'HOUSEHOLD GOODS STORAGE AGREEMENT'),
          _preamble(booking, company),
          pw.SizedBox(height: 8),
          _schedule(booking),
          pw.SizedBox(height: 8),
          _clauses(booking, company),
          pw.SizedBox(height: 8),
          _closing(booking),
          pw.SizedBox(height: 18),
          PdfPageKit.signatures(
            company,
            signature,
            _style,
            otherParties: const ['Customer (Second Party)', 'Witness'],
            partySignature: customerSignature,
            partyNote: customerSignatureNote,
          ),
        ],
      ),
    );

    return document.save();
  }

  pw.TextStyle get _body => const pw.TextStyle(fontSize: 8, lineSpacing: 1.6);

  pw.Widget _preamble(StorageBookingModel b, CompanyModel? company) {
    final companyName = (company?.companyName ?? '').trim();
    final companyAddress = [
      company?.address,
      company?.city,
      company?.state,
      company?.pincode,
    ].where((s) => (s ?? '').trim().isNotEmpty).join(', ');

    return pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Text(
          'This Storage Agreement is made on ${PdfPageKit.date(b.bookingDate)} '
          'against Storage Receipt No. ${b.bookingNo}',
          style: pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold, color: _style.primary),
        ),
        pw.SizedBox(height: 6),
        pw.RichText(
          text: pw.TextSpan(
            style: _body,
            children: [
              const pw.TextSpan(text: 'BETWEEN  '),
              pw.TextSpan(
                text: companyName.isEmpty ? 'the Operator' : companyName,
                style: pw.TextStyle(fontWeight: pw.FontWeight.bold),
              ),
              pw.TextSpan(
                text: companyAddress.isEmpty ? '' : ', $companyAddress',
              ),
              const pw.TextSpan(
                text: ' (hereinafter "the Operator" or "First Party")\n\nAND  ',
              ),
              pw.TextSpan(
                text: b.customerName,
                style: pw.TextStyle(fontWeight: pw.FontWeight.bold),
              ),
              pw.TextSpan(
                text: [
                  if (b.customerFullAddress.isNotEmpty) ', ${b.customerFullAddress}',
                  if (b.customerPhone.isNotEmpty) ', Mobile ${b.customerPhone}',
                  if (b.customerGst.isNotEmpty) ', GSTIN ${b.customerGst}',
                  if (b.customerIdProof.isNotEmpty) ', ID ${b.customerIdProof}',
                ].join(),
              ),
              const pw.TextSpan(
                text: ' (hereinafter "the Customer" or "Second Party").\n\n'
                    'The Customer has asked the Operator to store the household goods described in '
                    'the Schedule below, and the Operator has agreed to store them on the terms set '
                    'out in this Agreement.',
              ),
            ],
          ),
        ),
      ],
    );
  }

  pw.Widget _schedule(StorageBookingModel b) {
    final rent = b.rentRate > 0
        ? '${PdfPageKit.money(b.rentRate)} ${b.rentUnitLabel.trim().isEmpty ? b.rentBasis.label.toLowerCase() : b.rentUnitLabel.trim()}'
            ' (${AmountInWords.convert(b.rentRate)})'
        : 'As mutually agreed';

    final goods = b.items.isNotEmpty
        ? b.items
            .map((i) => '${i.itemName} - ${PdfPageKit.qty(i.quantity)} ${i.unit}'
                '${i.description.trim().isEmpty ? '' : ' (${i.description.trim()})'}')
            .join('; ')
        : b.goodsDescription.trim();

    final rows = <List<String>>[
      ['Goods deposited', goods.isEmpty ? '-' : goods],
      [
        'Total quantity',
        b.totalPackages > 0 ? '${b.totalPackages} packages' : '${PdfPageKit.qty(b.totalQuantity)} units',
      ],
      ['Storage location', b.locationName.trim().isEmpty ? 'As allotted by the Operator' : b.locationName],
      [
        'Storage period',
        'From ${PdfPageKit.date(b.storageStartDate)}'
            '${b.expectedEndDate.trim().isEmpty ? ', until the goods are withdrawn' : ' to ${PdfPageKit.date(b.expectedEndDate)} (extendable)'}',
      ],
      ['Storage rent', rent],
      if (b.areaSqft > 0) ['Area occupied', '${PdfPageKit.qty(b.areaSqft)} sq.ft'],
      ['Security deposit', b.securityDeposit > 0 ? '${PdfPageKit.money(b.securityDeposit)} (${AmountInWords.convert(b.securityDeposit)})' : 'Nil'],
      ['Declared value of goods', b.declaredValue > 0 ? PdfPageKit.money(b.declaredValue) : 'Not declared'],
      ['Insurance', b.insuranceNote.trim().isEmpty ? "At the Depositor's own risk" : b.insuranceNote.trim()],
    ];

    return pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Text('SCHEDULE', style: pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold, color: _style.primary)),
        pw.SizedBox(height: 4),
        pw.Table(
          border: pw.TableBorder.all(color: PdfPageKit.black, width: 0.5),
          columnWidths: const {0: pw.FlexColumnWidth(1.4), 1: pw.FlexColumnWidth(4)},
          children: [
            for (final row in rows)
              pw.TableRow(
                children: [
                  pw.Container(
                    color: _style.softFill,
                    padding: const pw.EdgeInsets.symmetric(horizontal: 5, vertical: 3),
                    child: pw.Text(row[0], style: pw.TextStyle(fontSize: 7.5, fontWeight: pw.FontWeight.bold)),
                  ),
                  pw.Padding(
                    padding: const pw.EdgeInsets.symmetric(horizontal: 5, vertical: 3),
                    child: pw.Text(row[1], style: const pw.TextStyle(fontSize: 7.5)),
                  ),
                ],
              ),
          ],
        ),
      ],
    );
  }

  pw.Widget _clauses(StorageBookingModel b, CompanyModel? company) {
    final terms = b.terms.trim().isNotEmpty
        ? b.terms.trim()
        : _customTerms.isNotEmpty
            ? _customTerms
            : (company?.defaultTerms.trim().isNotEmpty ?? false)
                ? company!.defaultTerms.trim()
                : DefaultStorageTerms.terms.join('\n');
    return PdfPageKit.terms('TERMS AND CONDITIONS', terms, _style);
  }

  pw.Widget _closing(StorageBookingModel b) {
    final open = b.status.isOpen;
    return pw.Text(
      'IN WITNESS WHEREOF both parties have signed this Agreement on the date first written above, '
      'having read and understood every clause. ${open ? 'This Agreement remains in force until all goods '
          'on this storage record are released and all dues are settled.' : 'All goods on this storage record have since been released.'}',
      style: _body,
    );
  }
}
