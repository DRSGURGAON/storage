import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/app/theme/app_theme.dart';
import 'package:godown_book/features/company/controllers/company_controller.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/dashboard/dashboard_screen.dart';
import 'package:godown_book/features/promo/repositories/promo_repository.dart';
import 'package:godown_book/features/subscription/repositories/subscription_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

/// Every register the app keeps is on the dashboard now. Nothing hides
/// behind a "More" sheet, because an owner hunting for last month's
/// bills should not have to find that sheet first.
void main() {
  late Database db;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    db = await openTestDatabase();
    SubscriptionRepository.firestoreOverride = FakeFirebaseFirestore();
    SubscriptionRepository.currentUidOverride = 'uid-test';
    PromoRepository.fetchOverride = () async => {'promos': const []};
    await CompanyController.instance.saveCompany(
      const CompanyModel(companyName: 'Defence Relocation Services', city: 'Gurgaon'),
    );
  });

  tearDown(() async {
    SubscriptionRepository.firestoreOverride = null;
    SubscriptionRepository.currentUidOverride = null;
    PromoRepository.fetchOverride = null;
    await db.close();
  });

  Future<void> pumpDashboard(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1170, 5200);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(ProviderScope(
      child: MaterialApp(theme: AppTheme.light(), home: const DashboardScreen()),
    ));

    for (var i = 0; i < 60; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump();
      if (find.byType(CircularProgressIndicator).evaluate().isEmpty) break;
    }
  }

  testWidgets('every document register is on the dashboard', (tester) async {
    await pumpDashboard(tester);

    expect(find.text('All documents'), findsNWidgets(2), reason: 'the section and its tile');
    for (final label in [
      'Storage records',
      'Bills',
      'Payments',
      'Quotations',
      'Bilty / LR',
      'Notices',
      'Damage reports',
      'Releases',
      'Reports',
    ]) {
      expect(find.text(label), findsOneWidget, reason: label);
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('the "More" sheet is gone', (tester) async {
    await pumpDashboard(tester);

    expect(find.text('More'), findsNothing);
    expect(find.byIcon(Icons.more_horiz), findsNothing);
  });

  testWidgets('the things you start most often are still first', (tester) async {
    await pumpDashboard(tester);

    expect(find.text('What do you want to do?'), findsOneWidget);
    for (final label in ['Storage', 'Bill', 'Payment', 'Quotation', 'Customer', 'Notice']) {
      expect(find.text(label), findsOneWidget, reason: label);
    }

    // Create actions above, registers below.
    final create = tester.getTopLeft(find.text('What do you want to do?')).dy;
    final registers = tester.getTopLeft(find.text('Storage records')).dy;
    expect(create, lessThan(registers));
  });
}
