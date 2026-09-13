import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/features/quotation/screens/quotation_form_screen.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

/// Opening a quotation gave a blank screen whose back arrow did nothing:
/// build() composed a preview from a draft that _load() had not created
/// yet, so the first frame threw LateInitializationError and the app bar
/// never appeared. It bit whenever _load() awaits before assigning the
/// draft - which is every existing quotation, since that one reads from
/// the database first. The screen has to build before its data arrives.
void main() {
  late Database db;

  setUp(() async {
    db = await openTestDatabase();
  });

  tearDown(() async {
    await db.close();
  });

  /// [editQuotationId] set is the path that crashed: _load() awaits the
  /// database before it can assign the draft.
  Widget host({String? editQuotationId}) => MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => QuotationFormScreen(editQuotationId: editQuotationId),
                ),
              ),
              child: const Text('OPEN'),
            ),
          ),
        ),
      );

  testWidgets('the first frame shows the app bar instead of throwing',
      (tester) async {
    await tester.pumpWidget(host(editQuotationId: 'quotation-1'));
    await tester.tap(find.text('OPEN'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    // _load() awaits the database, which no amount of pumping advances:
    // this is the screen exactly as it is before its draft exists, and
    // it used to throw LateInitializationError here.
    expect(tester.takeException(), isNull);
    expect(find.text('Edit Quotation'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('its back arrow works while the draft is still loading',
      (tester) async {
    await tester.pumpWidget(host(editQuotationId: 'quotation-1'));
    await tester.tap(find.text('OPEN'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    final back = find.byTooltip('Back');
    expect(back, findsOneWidget);

    await tester.tap(back);
    await tester.pumpAndSettle();

    expect(find.text('OPEN'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a new quotation still opens and totals up', (tester) async {
    await tester.pumpWidget(host());
    await tester.tap(find.text('OPEN'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    for (var i = 0; i < 40; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump();
      if (find.byType(CircularProgressIndicator).evaluate().isEmpty) break;
    }

    expect(tester.takeException(), isNull);
    expect(find.text('New Quotation'), findsOneWidget);
    expect(find.text('Total'), findsOneWidget);
    expect(find.text('Save quotation'), findsOneWidget);
  });
}
