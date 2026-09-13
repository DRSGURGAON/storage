import 'package:flutter/material.dart';

import 'brand.dart';

/// The app's own look. It is one brand - navy, green, warm paper - and
/// it does not follow the company's chosen DocumentTheme: that setting
/// styles the PDFs a customer receives, which is the company's
/// letterhead, while the screens the operator taps all day belong to
/// StorageBill Pro. There is no dark variant: the dashboard's map and
/// tiles are designed for paper, and a half-themed dark mode is worse
/// than none.
class AppTheme {
  AppTheme._();

  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: Brand.navy,
      primary: Brand.navy,
      onPrimary: Colors.white,
      secondary: Brand.green,
      onSecondary: Brand.greenInk,
      tertiary: Brand.amber,
      surface: Brand.card,
      error: Brand.coralDeep,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: Brand.paper,

      appBarTheme: const AppBarTheme(
        backgroundColor: Brand.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
        titleTextStyle: TextStyle(
          color: Colors.white,
          fontSize: 17,
          fontWeight: FontWeight.w800,
        ),
      ),

      cardTheme: CardThemeData(
        color: Brand.card,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: Brand.line),
        ),
        margin: EdgeInsets.zero,
      ),

      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Brand.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: scheme.primary, width: 1.6),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),

      // Buttons are tall, but never force a width: a button inside a Row
      // (the save bar under a bill) cannot be laid out at infinite width,
      // and the whole screen goes blank when one is asked to. A button
      // that is a list's child is stretched by the list anyway.
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, 52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(64, 52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          side: const BorderSide(color: Brand.line),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
        ),
      ),

      // A chip label needs its colour spelled out: left to the default it
      // paints white, which on a white chip is no label at all.
      chipTheme: ChipThemeData(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        side: const BorderSide(color: Brand.line),
        backgroundColor: Brand.card,
        selectedColor: Brand.navy,
        checkmarkColor: Colors.white,
        labelStyle: TextStyle(
          fontWeight: FontWeight.w700,
          fontSize: 13,
          color: WidgetStateColor.resolveWith((states) =>
              states.contains(WidgetState.selected) ? Colors.white : Brand.ink),
        ),
        secondaryLabelStyle: const TextStyle(
          fontWeight: FontWeight.w700,
          fontSize: 13,
          color: Colors.white,
        ),
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
