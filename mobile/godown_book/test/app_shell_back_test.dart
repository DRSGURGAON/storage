import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:godown_book/app/shell/app_shell.dart';

/// The phone's Back button used to close the app from anywhere in the
/// shell. Now it walks back to Home first, and asks before quitting.
void main() {
  late List<MethodCall> platformCalls;

  setUp(() {
    platformCalls = [];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
      platformCalls.add(call);
      return null;
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  bool exited() => platformCalls.any((c) => c.method == 'SystemNavigator.pop');

  Widget app() {
    final router = GoRouter(
      initialLocation: '/dashboard',
      routes: [
        StatefulShellRoute.indexedStack(
          builder: (context, state, navigationShell) =>
              AppShell(navigationShell: navigationShell),
          branches: [
            StatefulShellBranch(routes: [
              GoRoute(path: '/dashboard', builder: (c, s) => const Text('HOME')),
            ]),
            StatefulShellBranch(routes: [
              GoRoute(path: '/customers', builder: (c, s) => const Text('CUSTOMERS')),
            ]),
            StatefulShellBranch(routes: [
              GoRoute(path: '/documents', builder: (c, s) => const Text('DOCUMENTS')),
            ]),
          ],
        ),
        GoRoute(path: '/settings', builder: (c, s) => const Text('SETTINGS')),
      ],
    );
    return MaterialApp.router(routerConfig: router);
  }

  testWidgets('from another tab, Back returns to Home instead of quitting',
      (tester) async {
    await tester.pumpWidget(app());
    await tester.tap(find.text('Customers'));
    await tester.pumpAndSettle();
    expect(find.text('CUSTOMERS'), findsOneWidget);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(find.text('HOME'), findsOneWidget);
    expect(exited(), isFalse);
  });

  testWidgets('on Home, one Back press warns and the second one exits',
      (tester) async {
    await tester.pumpWidget(app());

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Press back again to exit'), findsOneWidget);
    expect(exited(), isFalse, reason: 'the first press must never close the app');

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(exited(), isTrue);
  });

  testWidgets('after the warning has passed, Back warns again rather than exiting',
      (tester) async {
    await tester.pumpWidget(app());

    await tester.binding.handlePopRoute();
    await tester.pump();
    expect(find.text('Press back again to exit'), findsOneWidget);

    // Long enough that the message has gone and the operator has
    // forgotten they pressed it. (It arms its own dismissal only once
    // it has finished sliding in, hence the two waits.)
    await tester.pump(const Duration(milliseconds: 750));
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(find.text('Press back again to exit'), findsNothing);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(exited(), isFalse);
    expect(find.text('Press back again to exit'), findsOneWidget);
  });

  testWidgets('a screen pushed over the shell still pops normally',
      (tester) async {
    await tester.pumpWidget(app());
    final BuildContext context = tester.element(find.text('HOME'));
    context.push('/settings');
    await tester.pumpAndSettle();
    expect(find.text('SETTINGS'), findsOneWidget);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(find.text('HOME'), findsOneWidget);
    expect(exited(), isFalse);
    expect(find.text('Press back again to exit'), findsNothing);
  });
}
