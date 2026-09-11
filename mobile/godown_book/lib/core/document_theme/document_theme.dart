import 'package:pdf/pdf.dart';

import 'document_header.dart';

/// The 7 document presentation themes a company can choose in Company
/// Settings - applied to EVERY generated PDF (Warehouse Receipt,
/// Inventory List, Storage Agreement, Delivery Order, Gate Pass, Rent
/// Bill, Money Receipt, Statement, Letter Head, Company Card), not one
/// this was originally named after. Purely visual - see
/// DocumentThemeStyle for what each one actually controls (colors,
/// section-header styling, table borders, header/footer emphasis). No
/// theme changes what data is printed or how totals are calculated -
/// every PDF service reads its own genuine print data regardless of
/// which theme is selected.
enum DocumentTheme {
  classic,
  corporateBlue,
  modern,
  minimal,
  premium,
  bold,
  elegant;

  String get code => switch (this) {
    DocumentTheme.classic => 'classic',
    DocumentTheme.corporateBlue => 'corporateBlue',
    DocumentTheme.modern => 'modern',
    DocumentTheme.minimal => 'minimal',
    DocumentTheme.premium => 'premium',
    DocumentTheme.bold => 'bold',
    DocumentTheme.elegant => 'elegant',
  };

  String get label => switch (this) {
    DocumentTheme.classic => 'Classic',
    DocumentTheme.corporateBlue => 'Corporate Blue',
    DocumentTheme.modern => 'Modern',
    DocumentTheme.minimal => 'Minimal',
    DocumentTheme.premium => 'Premium',
    DocumentTheme.bold => 'Bold',
    DocumentTheme.elegant => 'Elegant',
  };

  /// Unrecognised/missing codes fall back to Classic - "if no theme is
  /// selected, documents must still generate using Classic" applies both
  /// to a genuinely-unset value and to any value this enum doesn't
  /// recognise (e.g. data from a future version).
  static DocumentTheme fromCode(String? code) {
    for (final theme in DocumentTheme.values) {
      if (theme.code == code) return theme;
    }
    return DocumentTheme.classic;
  }
}

/// The actual style values one DocumentTheme resolves to - everything
/// each PDF service needs to render a page, gathered in one place so
/// the widget-building code in every PDF service only ever reads from
/// `style.xxx` instead of a hardcoded constant. This is what makes 7
/// themes possible without 7 copies of the PDF-building logic: the
/// widget tree/order/content is identical for every theme, only these
/// values differ.
class DocumentThemeStyle {
  /// Primary brand color - band fills, headings, the title banner.
  final PdfColor primary;

  /// Table/box border and divider color.
  final PdfColor line;

  /// Light fill used behind section headers and the ISO-certified band.
  final PdfColor softFill;

  /// Text color used on top of [primary] fills (the title banner,
  /// totals row) - white for a dark primary, dark for a light one.
  final PdfColor onPrimary;

  /// Whether section headers get an underline beneath the text (Classic/
  /// Corporate look) or not (cleaner Modern/Minimal look).
  final bool sectionHeadUnderline;

  /// Section header horizontal padding - tighter for Minimal, roomier
  /// for Premium/Elegant.
  final double sectionHeadPaddingH;

  /// Table/box border width - thin for Minimal, bolder for Bold.
  final double borderWidth;

  /// Font size used for the big title banner text.
  final double bannerFontSize;

  /// Whether the title banner is bold (most themes) or a lighter
  /// weight for a more refined look (Elegant).
  final bool bannerBold;

  /// How this theme draws title bands, the ISO strip and rules. This
  /// is the property that makes themes structurally different rather
  /// than merely recoloured - see HeaderStyle's own doc comment.
  final HeaderStyle headerStyle;

  /// Company name size in the letterhead - larger for bold/premium
  /// looks, restrained for minimal ones.
  final double companyNameSize;

  /// Letter spacing on the company name. Wider tracking reads as more
  /// formal/premium; zero is the plain default.
  final double companyNameSpacing;

  /// Letter spacing on the document title. Themes that use outlined or
  /// rule-based bands space the title out to compensate for having no
  /// solid fill behind it.
  final double titleSpacing;

  const DocumentThemeStyle({
    required this.primary,
    required this.line,
    required this.softFill,
    required this.onPrimary,
    required this.sectionHeadUnderline,
    required this.sectionHeadPaddingH,
    required this.borderWidth,
    required this.bannerFontSize,
    required this.bannerBold,
    required this.headerStyle,
    required this.companyNameSize,
    required this.companyNameSpacing,
    required this.titleSpacing,
  });

  /// The one place all 7 themes' actual values live - resolving a
  /// DocumentTheme to its style is a pure lookup, not a branch scattered
  /// through the PDF-building code.
  static DocumentThemeStyle of(DocumentTheme theme) {
    switch (theme) {
      case DocumentTheme.classic:
        // The original, already-shipped look - deliberately identical to
        // what every PDF service rendered before this feature existed,
        // so a company that never touches the new setting sees no change.
        return const DocumentThemeStyle(
          primary: PdfColor.fromInt(0xFF1F3864),
          line: PdfColor.fromInt(0xFF9AA5B1),
          softFill: PdfColor.fromInt(0xFFF2F4F7),
          onPrimary: PdfColors.white,
          sectionHeadUnderline: true,
          sectionHeadPaddingH: 6,
          borderWidth: 0.5,
          bannerFontSize: 13,
          bannerBold: true,
          headerStyle: HeaderStyle.filledBand,
          companyNameSize: 17.0,
          companyNameSpacing: 0.0,
          titleSpacing: 1.0,
        );

      case DocumentTheme.corporateBlue:
        return const DocumentThemeStyle(
          primary: PdfColor.fromInt(0xFF0B4F8A),
          line: PdfColor.fromInt(0xFF8FA9C2),
          softFill: PdfColor.fromInt(0xFFE8F1FA),
          onPrimary: PdfColors.white,
          sectionHeadUnderline: true,
          sectionHeadPaddingH: 6,
          borderWidth: 0.6,
          bannerFontSize: 13,
          bannerBold: true,
          headerStyle: HeaderStyle.accentBar,
          companyNameSize: 17.0,
          companyNameSpacing: 0.3,
          titleSpacing: 1.2,
        );

      case DocumentTheme.modern:
        return const DocumentThemeStyle(
          primary: PdfColor.fromInt(0xFF16A085),
          line: PdfColor.fromInt(0xFFB0BEC5),
          softFill: PdfColor.fromInt(0xFFEAF7F4),
          onPrimary: PdfColors.white,
          sectionHeadUnderline: false,
          sectionHeadPaddingH: 8,
          borderWidth: 0.4,
          bannerFontSize: 14,
          bannerBold: true,
          headerStyle: HeaderStyle.underlineRule,
          companyNameSize: 18.0,
          companyNameSpacing: 0.0,
          titleSpacing: 2.0,
        );

      case DocumentTheme.minimal:
        return const DocumentThemeStyle(
          primary: PdfColor.fromInt(0xFF37474F),
          line: PdfColor.fromInt(0xFFCFD8DC),
          softFill: PdfColor.fromInt(0xFFFAFAFA),
          onPrimary: PdfColors.white,
          sectionHeadUnderline: false,
          sectionHeadPaddingH: 4,
          borderWidth: 0.3,
          bannerFontSize: 12,
          bannerBold: false,
          headerStyle: HeaderStyle.hairline,
          companyNameSize: 15.0,
          companyNameSpacing: 0.5,
          titleSpacing: 3.0,
        );

      case DocumentTheme.premium:
        return const DocumentThemeStyle(
          primary: PdfColor.fromInt(0xFF7B5E22),
          line: PdfColor.fromInt(0xFFC9B688),
          softFill: PdfColor.fromInt(0xFFF7F1E3),
          onPrimary: PdfColors.white,
          sectionHeadUnderline: true,
          sectionHeadPaddingH: 8,
          borderWidth: 0.6,
          bannerFontSize: 14,
          bannerBold: true,
          headerStyle: HeaderStyle.doubleRule,
          companyNameSize: 17.5,
          companyNameSpacing: 1.0,
          titleSpacing: 3.5,
        );

      case DocumentTheme.bold:
        return const DocumentThemeStyle(
          primary: PdfColor.fromInt(0xFFB71C1C),
          line: PdfColor.fromInt(0xFF757575),
          softFill: PdfColor.fromInt(0xFFFBE9E7),
          onPrimary: PdfColors.white,
          sectionHeadUnderline: true,
          sectionHeadPaddingH: 6,
          borderWidth: 0.9,
          bannerFontSize: 15,
          bannerBold: true,
          headerStyle: HeaderStyle.heavyBand,
          companyNameSize: 19.0,
          companyNameSpacing: 0.0,
          titleSpacing: 1.5,
        );

      case DocumentTheme.elegant:
        return const DocumentThemeStyle(
          primary: PdfColor.fromInt(0xFF4A2E5C),
          line: PdfColor.fromInt(0xFFC4A9D6),
          softFill: PdfColor.fromInt(0xFFF5EEFA),
          onPrimary: PdfColors.white,
          sectionHeadUnderline: false,
          sectionHeadPaddingH: 8,
          borderWidth: 0.4,
          bannerFontSize: 13,
          bannerBold: false,
          headerStyle: HeaderStyle.outlinedBand,
          companyNameSize: 16.0,
          companyNameSpacing: 1.5,
          titleSpacing: 4.0,
        );
    }
  }
}
