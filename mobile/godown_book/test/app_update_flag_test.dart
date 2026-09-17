import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:godown_book/core/constants/feature_flags.dart';
import 'package:godown_book/core/update/app_update_banner.dart';

/// The app is distributed through Google Play. Play's own policy
/// requires an app installed from Play to update only through Play,
/// so the self-update mechanism (check GitHub, offer to install the
/// APK it finds) must ship switched off - see FeatureFlags'
/// own doc comment on selfUpdateCheckEnabled.
void main() {
  test('the self-update check ships disabled', () {
    expect(FeatureFlags.selfUpdateCheckEnabled, isFalse);
  });

  testWidgets('the banner never checks GitHub or appears while it is off',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: AppUpdateBanner())),
    );
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    expect(find.byType(AppUpdateBanner), findsOneWidget);
    expect(find.text('Build 999 is ready'), findsNothing);
    expect(find.byIcon(Icons.system_update_outlined), findsNothing);
  });
}
