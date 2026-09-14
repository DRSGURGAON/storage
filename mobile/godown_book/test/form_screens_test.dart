import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/app/theme/app_theme.dart';
import 'package:godown_book/features/billing/screens/bill_form_screen.dart';
import 'package:godown_book/features/billing/screens/payment_form_screen.dart';
import 'package:godown_book/features/quotation/screens/quotation_form_screen.dart';
import 'package:godown_book/features/storage_booking/screens/storage_booking_form_screen.dart';
import 'package:godown_book/shared/widgets/charge_line_row.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

/// The four forms an operator opens most, rendered with the real theme
/// against a real database. A build that throws shows up on a phone
/// as an empty screen with nothing to tap, so every one of these must
/// come up with its first control visible and its Save button in
/// place.
void main() {
  late Database db;

  setUp(() async {
    db = await openTestDatabase();
  });

  tearDown(() async {
    await db.close();
  });

  /// The forms read the database on open, and sqflite answers on a
  /// real thread, so the pump has to run with real async and then wait
  /// for the answer - the fake clock would leave every form loading.
  Future<void> pumpScreen(WidgetTester tester, Widget screen) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.5;
    addTearDown(tester.view.reset);
    await tester.runAsync(() async {
      await tester.pumpWidget(MaterialApp(theme: AppTheme.light(), home: screen));
      for (var i = 0; i < 20; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 100));
        await tester.pump();
        if (find.byType(CircularProgressIndicator).evaluate().isEmpty) break;
      }
    });
    expect(find.byType(CircularProgressIndicator), findsNothing,
        reason: 'still loading');
  }

  testWidgets('a new storage bill comes up with its form and save bar',
      (tester) async {
    await pumpScreen(tester, const BillFormScreen());
    expect(tester.takeException(), isNull);
    expect(find.text('Bol kar bhariye'), findsOneWidget);
    expect(find.text('Save bill'), findsOneWidget);
  });

  testWidgets('a new quotation comes up with its form and save bar',
      (tester) async {
    await pumpScreen(tester, const QuotationFormScreen());
    expect(tester.takeException(), isNull);
    expect(find.text('Bol kar bhariye'), findsOneWidget);
    expect(find.text('Save quotation'), findsOneWidget);

    // The amount is typed on the row itself, and the total follows.
    final amountBoxes = find.byType(ChargeLineRow);
    expect(amountBoxes, findsWidgets);
    await tester.enterText(
      find.descendant(of: amountBoxes.first, matching: find.byType(TextField)),
      '5000',
    );
    await tester.pump();
    expect(find.text('₹5000.00'), findsOneWidget);
  });

  testWidgets('a payment form comes up, and every chip has readable text',
      (tester) async {
    await pumpScreen(tester, const PaymentFormScreen());
    expect(tester.takeException(), isNull);
    expect(find.text('Received from *'), findsOneWidget);

    // The chip label must be painted in a real colour: with none set,
    // an unselected chip is white on white.
    final chipTheme = Theme.of(tester.element(find.byType(Scaffold))).chipTheme;
    expect(chipTheme.labelStyle?.color, isNotNull);
  });

  testWidgets('a new storage entry comes up', (tester) async {
    await pumpScreen(tester, const StorageBookingFormScreen());
    expect(tester.takeException(), isNull);
    expect(find.text('Bol kar bhariye'), findsOneWidget);
  });
}
