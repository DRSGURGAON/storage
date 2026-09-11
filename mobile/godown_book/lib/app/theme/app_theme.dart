import 'package:flutter/material.dart';

import '../../core/document_theme/document_theme.dart';

class AppTheme {
  AppTheme._();

  /// Builds the app's ThemeData from the company's own selected
  /// DocumentTheme - the same 7-theme setting that already styles
  /// every generated PDF. This is what makes the in-app UI (Dashboard
  /// gradient, app bars, buttons, FABs - anything that reads from the
  /// Material ColorScheme rather than a hardcoded hex) genuinely
  /// follow the company's chosen theme, not just their documents.
  ///
  /// PdfColor.toInt() -> Flutter Color(int) is a direct, lossless
  /// conversion (both use the same 0xAARRGGBB format, confirmed via
  /// the pdf package's own official API docs) - not an approximation.
  static ThemeData light(DocumentTheme theme) {
    final style = DocumentThemeStyle.of(theme);
    final seedColor = Color(style.primary.toInt());

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: ColorScheme.fromSeed(seedColor: seedColor),

      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
        enabledBorder: OutlineInputBorder(),
        focusedBorder: OutlineInputBorder(),
        contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(double.infinity, 52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
    );
  }

  /// Same seed color and component shapes as [light], just built for
  /// dark brightness - so switching modes doesn't also change the
  /// app's visual language.
  static ThemeData dark(DocumentTheme theme) {
    final style = DocumentThemeStyle.of(theme);
    final seedColor = Color(style.primary.toInt());

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: ColorScheme.fromSeed(
        seedColor: seedColor,
        brightness: Brightness.dark,
      ),

      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
        enabledBorder: OutlineInputBorder(),
        focusedBorder: OutlineInputBorder(),
        contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(double.infinity, 52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
    );
  }
}
