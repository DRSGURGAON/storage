import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/widgets.dart' as pw;

/// The one font every generated document is set in.
///
/// The pdf package's built-in fonts are the fourteen PDF standard
/// fonts, which know Latin only: a customer name, address, goods list
/// or terms typed in Hindi came out as empty boxes. Noto Sans
/// Devanagari (SIL Open Font License, bundled under assets/fonts) covers
/// Devanagari and Latin in one face, so English, Hindi and mixed text
/// all print - and every document loads it from here, never each on
/// its own.
///
/// Loaded once from the asset bundle and cached. A build without the
/// asset bundle (a bare unit test) falls back to the standard fonts
/// rather than failing the document; [isLoaded] says which happened.
class PdfFonts {
  PdfFonts._();

  static const String regularAsset = 'assets/fonts/NotoSansDevanagari-Regular.ttf';
  static const String boldAsset = 'assets/fonts/NotoSansDevanagari-Bold.ttf';

  static pw.Font? _regular;
  static pw.Font? _bold;
  static Future<void>? _loading;

  static bool get isLoaded => _regular != null && _bold != null;

  /// Loads the fonts if they are not loaded yet. Safe to call from
  /// every document build; only the first call reads the assets.
  static Future<void> ensureLoaded() {
    if (isLoaded) return Future.value();
    return _loading ??= _load();
  }

  static Future<void> _load() async {
    try {
      final regular = await rootBundle.load(regularAsset);
      final bold = await rootBundle.load(boldAsset);
      _regular = pw.Font.ttf(regular);
      _bold = pw.Font.ttf(bold);
    } catch (error) {
      debugPrint('PDF fonts not loaded, using standard fonts: $error');
    } finally {
      _loading = null;
    }
  }

  /// The document theme: the bundled face for regular and bold text,
  /// the standard Helvetica faces kept as a fallback for any symbol the
  /// bundled face lacks. Null until [ensureLoaded] has succeeded, so a
  /// document made without it simply keeps the package default.
  static pw.ThemeData? get theme {
    final regular = _regular;
    final bold = _bold;
    if (regular == null || bold == null) return null;
    return pw.ThemeData.withFont(
      base: regular,
      bold: bold,
      italic: regular,
      boldItalic: bold,
      fontFallback: [pw.Font.helvetica(), pw.Font.helveticaBold()],
    );
  }

  /// A document set in the bundled font - what every PDF service
  /// starts from.
  static Future<pw.Document> document() async {
    await ensureLoaded();
    return pw.Document(theme: theme);
  }

  @visibleForTesting
  static void resetForTesting() {
    _regular = null;
    _bold = null;
    _loading = null;
  }
}
