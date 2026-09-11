import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;

import 'document_theme.dart';

/// How a theme renders its title bands and rules. This is what makes
/// the themes genuinely distinct documents rather than the same
/// document in a different colour - each variant changes the actual
/// shape of the header: whether bands are filled or outlined, whether
/// rules are hairlines or heavy bars, how much the title is spaced out.
enum HeaderStyle {
  /// Solid filled band, boxed ISO strip. The original look.
  filledBand,

  /// No fill - the title sits on a thick coloured rule beneath it.
  underlineRule,

  /// Hairline rules only, no fills anywhere. Maximum restraint.
  hairline,

  /// Filled band plus a vertical accent bar down the left edge.
  accentBar,

  /// Outlined (not filled) band with widely letter-spaced title.
  outlinedBand,

  /// Heavy filled band with thick borders throughout.
  heavyBand,

  /// Twin thin rules above and below a centred, lightly-weighted title.
  doubleRule,
}

/// Shared header rendering for every PDF in the app.
///
/// WHY THIS EXISTS: each of the 11 PDF services previously built its
/// own company header, so the same company appeared with different
/// alignment, different field grouping (GST sometimes on its own line,
/// sometimes with PAN) and different ordering depending on which
/// document you opened. This is one implementation, used everywhere.
class DocumentHeader {
  DocumentHeader._();

  /// The standard company block: logo on the left, all company
  /// details right-aligned, statutory identifiers (GST/PAN) grouped on
  /// one line. [extraLeft] renders under the logo - used by Money
  /// Receipt for its branch label.
  static pw.Widget company({
    required DocumentThemeStyle style,
    String? companyName,
    String? tagLine,
    String? address,
    String? city,
    String? state,
    String? pincode,
    String? gstNumber,
    String? panNumber,
    String? mobile1,
    String? mobile2,
    String? tollFree,
    String? website,
    String? email,
    Uint8List? logo,
    pw.Widget? extraLeft,
  }) {
    final addressLine = <String>[
      if ((address ?? '').isNotEmpty) address!,
      if ((city ?? '').isNotEmpty) city!,
      if ((state ?? '').isNotEmpty) state!,
      if ((pincode ?? '').isNotEmpty) pincode!,
    ].join(', ');

    final gstPan = <String>[
      if ((gstNumber ?? '').isNotEmpty) 'GST No.: $gstNumber',
      if ((panNumber ?? '').isNotEmpty) 'PAN No.: $panNumber',
    ];

    final phones = <String>[
      if ((mobile1 ?? '').isNotEmpty) mobile1!,
      if ((mobile2 ?? '').isNotEmpty) mobile2!,
    ];

    final contactLine = <String>[
      if (phones.isNotEmpty) 'Phone: ${phones.join(', ')}',
      if ((tollFree ?? '').isNotEmpty) 'Toll Free: $tollFree',
    ];

    final webEmail = <String>[
      if ((website ?? '').isNotEmpty) 'Website: $website',
      if ((email ?? '').isNotEmpty) 'Email: $email',
    ];

    // The company name capped so it never dwarfs the logo (feedback:
    // "logo chota dikh rha h as compare to company name") - themes with
    // a larger configured size step down to this ceiling, smaller ones
    // keep their own value.
    final nameSize =
        style.companyNameSize > 13 ? 13.0 : style.companyNameSize;

    return pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.center,
      children: [
        if (logo != null || extraLeft != null) ...[
          pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              if (logo != null)
                // The logo in its own bordered box - a distinct frame,
                // separate from the details block, sized generously so
                // the mark reads at real letterhead scale. Still
                // BoxFit.contain, so the aspect ratio is never
                // distorted regardless of the uploaded image's shape.
                pw.Container(
                  width: 84,
                  height: 68,
                  alignment: pw.Alignment.center,
                  padding: const pw.EdgeInsets.all(4),
                  decoration: pw.BoxDecoration(
                    border: pw.Border.all(color: style.line, width: 0.7),
                    borderRadius: pw.BorderRadius.circular(4),
                  ),
                  child: pw.Image(pw.MemoryImage(logo), fit: pw.BoxFit.contain),
                ),
              if (extraLeft != null) ...[
                pw.SizedBox(height: 2),
                extraLeft,
              ],
            ],
          ),
          pw.SizedBox(width: 12),
        ],
        pw.Expanded(
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.end,
            children: [
              pw.Text(
                (companyName ?? '').toUpperCase(),
                style: pw.TextStyle(
                  fontSize: nameSize,
                  fontWeight: pw.FontWeight.bold,
                  color: style.primary,
                  letterSpacing: style.companyNameSpacing,
                ),
                textAlign: pw.TextAlign.right,
              ),
              if ((tagLine ?? '').isNotEmpty)
                pw.Text(
                  tagLine!,
                  style: pw.TextStyle(
                    fontSize: 8,
                    fontWeight: pw.FontWeight.bold,
                    color: style.primary,
                    decoration: style.sectionHeadUnderline
                        ? pw.TextDecoration.underline
                        : pw.TextDecoration.none,
                  ),
                  textAlign: pw.TextAlign.right,
                ),
              pw.SizedBox(height: 2),
              if (addressLine.isNotEmpty)
                _line(addressLine),
              if (gstPan.isNotEmpty)
                _line(gstPan.join('     '), bold: true),
              if (contactLine.isNotEmpty)
                _line(contactLine.join('    ')),
              if (webEmail.isNotEmpty)
                _line(webEmail.join('    ')),
            ],
          ),
        ),
      ],
    );
  }

  static pw.Widget _line(String text, {bool bold = false}) => pw.Text(
        text,
        style: pw.TextStyle(
          fontSize: 7.5,
          fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
        ),
        textAlign: pw.TextAlign.right,
      );

  /// "AN ISO CERTIFIED: ..." strip. Rendered only when the company has
  /// genuinely configured one - never a hardcoded claim.
  static pw.Widget isoBand(String iso, DocumentThemeStyle style) {
    final text = pw.Text(
      'AN ISO CERTIFIED: $iso',
      style: pw.TextStyle(
        fontSize: 8,
        fontWeight: pw.FontWeight.bold,
        color: style.headerStyle == HeaderStyle.heavyBand
            ? style.onPrimary
            : style.primary,
      ),
    );

    switch (style.headerStyle) {
      case HeaderStyle.hairline:
      case HeaderStyle.doubleRule:
        // No box at all - just the text between the rules the header
        // already draws.
        return pw.Container(
          width: double.infinity,
          alignment: pw.Alignment.center,
          padding: const pw.EdgeInsets.symmetric(vertical: 3),
          child: text,
        );

      case HeaderStyle.heavyBand:
        return pw.Container(
          width: double.infinity,
          alignment: pw.Alignment.center,
          padding: const pw.EdgeInsets.symmetric(vertical: 3),
          margin: const pw.EdgeInsets.only(top: 3),
          color: style.primary,
          child: text,
        );

      default:
        return pw.Container(
          width: double.infinity,
          alignment: pw.Alignment.center,
          padding: const pw.EdgeInsets.symmetric(vertical: 3),
          margin: const pw.EdgeInsets.only(top: 3),
          decoration: pw.BoxDecoration(
            color: style.headerStyle == HeaderStyle.accentBar
                ? style.softFill
                : null,
            border: pw.Border.all(color: style.line, width: style.borderWidth),
          ),
          child: text,
        );
    }
  }

  /// The document's own name band - "WAREHOUSE RECEIPT", "TAX INVOICE", etc. Each
  /// theme draws this differently: a filled bar, an outlined bar, a
  /// rule beneath plain text, or twin rules around it.
  static pw.Widget titleBand(String title, DocumentThemeStyle style) {
    final label = pw.Text(
      title,
      textAlign: pw.TextAlign.center,
      style: pw.TextStyle(
        // Capped one point below the company-name ceiling (13pt in
        // company() above) - since the name was capped, themes with a
        // 13-15pt banner made the document title ("MONEY RECEIPT"
        // etc.) read BIGGER than the company itself. The letterhead
        // stays the most prominent element on every document.
        fontSize: style.bannerFontSize > 12 ? 12 : style.bannerFontSize,
        fontWeight:
            style.bannerBold ? pw.FontWeight.bold : pw.FontWeight.normal,
        letterSpacing: style.titleSpacing,
        color: switch (style.headerStyle) {
          HeaderStyle.filledBand ||
          HeaderStyle.accentBar ||
          HeaderStyle.heavyBand =>
            style.onPrimary,
          _ => style.primary,
        },
      ),
    );

    switch (style.headerStyle) {
      case HeaderStyle.underlineRule:
        return pw.Container(
          width: double.infinity,
          margin: const pw.EdgeInsets.only(top: 6, bottom: 2),
          padding: const pw.EdgeInsets.only(bottom: 4),
          decoration: pw.BoxDecoration(
            border: pw.Border(
              bottom: pw.BorderSide(color: style.primary, width: 2.2),
            ),
          ),
          alignment: pw.Alignment.center,
          child: label,
        );

      case HeaderStyle.hairline:
        return pw.Container(
          width: double.infinity,
          margin: const pw.EdgeInsets.only(top: 6, bottom: 4),
          padding: const pw.EdgeInsets.symmetric(vertical: 3),
          decoration: pw.BoxDecoration(
            border: pw.Border(
              top: pw.BorderSide(color: style.line, width: 0.4),
              bottom: pw.BorderSide(color: style.line, width: 0.4),
            ),
          ),
          alignment: pw.Alignment.center,
          child: label,
        );

      case HeaderStyle.doubleRule:
        return pw.Column(
          children: [
            pw.SizedBox(height: 6),
            pw.Container(height: 1.2, color: style.primary),
            pw.SizedBox(height: 1.5),
            pw.Container(height: 0.4, color: style.primary),
            pw.Padding(
              padding: const pw.EdgeInsets.symmetric(vertical: 5),
              child: label,
            ),
            pw.Container(height: 0.4, color: style.primary),
            pw.SizedBox(height: 1.5),
            pw.Container(height: 1.2, color: style.primary),
            pw.SizedBox(height: 4),
          ],
        );

      case HeaderStyle.outlinedBand:
        return pw.Container(
          width: double.infinity,
          margin: const pw.EdgeInsets.only(top: 6, bottom: 4),
          padding: const pw.EdgeInsets.symmetric(vertical: 5),
          decoration: pw.BoxDecoration(
            border: pw.Border.all(color: style.primary, width: 1),
          ),
          alignment: pw.Alignment.center,
          child: label,
        );

      case HeaderStyle.accentBar:
        return pw.Container(
          width: double.infinity,
          margin: const pw.EdgeInsets.only(top: 6, bottom: 4),
          color: style.primary,
          child: pw.Row(
            children: [
              // The accent bar itself - a lighter block at the leading
              // edge, so the band reads as branded rather than a plain
              // rectangle.
              pw.Container(width: 6, height: 20, color: style.softFill),
              pw.Expanded(
                child: pw.Padding(
                  padding: const pw.EdgeInsets.symmetric(vertical: 5),
                  child: label,
                ),
              ),
              pw.SizedBox(width: 6),
            ],
          ),
        );

      case HeaderStyle.heavyBand:
        return pw.Container(
          width: double.infinity,
          margin: const pw.EdgeInsets.only(top: 6, bottom: 4),
          padding: const pw.EdgeInsets.symmetric(vertical: 7),
          decoration: pw.BoxDecoration(
            color: style.primary,
            border: pw.Border.all(color: style.primary, width: 2),
          ),
          alignment: pw.Alignment.center,
          child: label,
        );

      case HeaderStyle.filledBand:
        return pw.Container(
          width: double.infinity,
          margin: const pw.EdgeInsets.only(top: 6, bottom: 4),
          padding: const pw.EdgeInsets.symmetric(vertical: 5),
          color: style.primary,
          alignment: pw.Alignment.center,
          child: label,
        );
    }
  }
}
