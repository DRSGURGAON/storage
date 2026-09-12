import 'package:flutter/material.dart';

import '../../core/document_theme/document_theme.dart';
import 'brand.dart';

/// The app's own look. It is one brand - navy, green, warm paper - and
/// it no longer follows the company's chosen DocumentTheme: that
/// setting styles the PDFs a customer receives, which is the company's
/// letterhead, while the screens the operator taps all day belong to
/// StorageBill Pro. [theme] is still accepted so nothing that builds
/// the ThemeData has to change; it is deliberately unused here.
class AppTheme {
  AppTheme._();

  static ThemeData light(DocumentTheme theme) => _build(Brightness.light);

  static ThemeData dark(DocumentTheme theme) => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final dark = brightness == Brightness.dark;

    final scheme = ColorScheme.fromSeed(
      seedColor: Brand.navy,
      brightness: brightness,
      primary: dark ? const Color(0xFF9FC3EA) : Brand.navy,
      onPrimary: dark ? Brand.navyDeep : Colors.white,
      secondary: Brand.green,
      onSecondary: Brand.greenInk,
      tertiary: Brand.amber,
      surface: dark ? const Color(0xFF10233A) : Brand.card,
      error: Brand.coralDeep,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: dark ? Brand.navyDeep : Brand.paper,

      appBarTheme: AppBarTheme(
        backgroundColor: dark ? Brand.navyDeep : Brand.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
        titleTextStyle: const TextStyle(
          color: Colors.white,
          fontSize: 17,
          fontWeight: FontWeight.w800,
        ),
      ),

      cardTheme: CardThemeData(
        color: dark ? const Color(0xFF13294A) : Brand.card,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: dark ? Brand.navyLine : Brand.line),
        ),
        margin: EdgeInsets.zero,
      ),

      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: dark ? Brand.navyLine : Brand.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: scheme.primary, width: 1.6),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),

      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(double.infinity, 52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(double.infinity, 52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(double.infinity, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          side: BorderSide(color: dark ? Brand.navyLine : Brand.line),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
        ),
      ),

      chipTheme: ChipThemeData(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        side: BorderSide(color: dark ? Brand.navyLine : Brand.line),
        labelStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
      ),

      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: Brand.green,
        foregroundColor: Brand.greenInk,
        extendedTextStyle: TextStyle(fontWeight: FontWeight.w800),
      ),

      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }
}
