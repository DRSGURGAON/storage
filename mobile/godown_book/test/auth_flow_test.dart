import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:godown_book/core/auth/auth_scope.dart';
import 'package:godown_book/core/auth/auth_session.dart';
import 'package:godown_book/core/auth/auth_state_watcher.dart';
import 'package:godown_book/features/auth/login_screen.dart';
import 'package:godown_book/features/auth/otp_verification_screen.dart';
import 'package:godown_book/features/auth/phone_number_input.dart';
import 'package:godown_book/features/auth/services/firebase_phone_auth_service.dart';
import 'package:godown_book/features/auth/services/otp_auth_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A scripted stand-in for Firebase Phone Auth. It records what the
/// screens asked for and answers as told, so every state the screens
/// have to show can be reached on purpose.
class FakeOtpAuthService implements OtpAuthService {
  final List<({String mobile, int? resendToken})> sendCalls = [];
  final List<String> verifyCalls = [];

  /// What the next sendOtp does: a request, a failure, or a delay.
  Future<OtpRequest> Function(String mobile, int? token)? onSend;

  /// What verifyOtp does: true, false, or a throw.
  Future<bool> Function(String otp)? onVerify;

  /// The most recent request handed out, for late auto verification.
  OtpRequest? lastRequest;

  int _tokens = 100;

  FakeOtpAuthService() {
    onSend = (mobile, token) async {
      lastRequest = OtpRequest(verificationId: 'vid-${sendCalls.length}', resendToken: _tokens++);
      return lastRequest!;
    };
    onVerify = (otp) async => otp == '123456';
  }

  @override
  Future<OtpRequest> sendOtp(String mobileNumber, {int? resendToken}) {
    sendCalls.add((mobile: mobileNumber, resendToken: resendToken));
    return onSend!(mobileNumber, resendToken);
  }

  @override
  Future<bool> verifyOtp({required OtpRequest request, required String otp}) {
    verifyCalls.add(otp);
    return onVerify!(otp);
  }
}

void main() {
  late FakeOtpAuthService auth;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    AuthScope.clear();
    auth = FakeOtpAuthService();
  });

  Widget app({String initial = '/login'}) {
    final router = GoRouter(
      initialLocation: initial,
      refreshListenable: AuthScope.listenable,
      routes: [
        GoRoute(path: '/login', builder: (c, s) => LoginScreen(authService: auth)),
        GoRoute(
          path: '/verify-otp',
          builder: (c, s) {
            final args = s.extra as Map<String, dynamic>;
            return OtpVerificationScreen(
              mobileNumber: args['mobileNumber'] as String,
              request: args['request'] as OtpRequest,
              authService: auth,
              resendCooldown: const Duration(seconds: 2),
            );
          },
        ),
        GoRoute(path: '/dashboard', builder: (c, s) => const Text('DASHBOARD')),
      ],
    );
    return ProviderScope(child: MaterialApp.router(routerConfig: router));
  }

  Future<void> enterNumberAndSend(WidgetTester tester, String number) async {
    await tester.enterText(find.byType(TextFormField), number);
    await tester.tap(find.text('Send OTP'));
    await tester.pump();
  }

  /// Lets any resend countdown finish and disposes the screen, so no
  /// timer is left pending when the test ends.
  Future<void> settle(WidgetTester tester) async {
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpWidget(const SizedBox());
  }

  group('phone number input', () {
    test('reads every common Indian shape as the same ten digits', () {
      for (final raw in [
        '9876543210',
        '+919876543210',
        '+91 98765 43210',
        '919876543210',
        '09876543210',
        '0 98765-43210',
        '(+91) 98765 43210',
      ]) {
        expect(PhoneNumberInput.normalise(raw), '9876543210', reason: raw);
      }
      expect(PhoneNumberInput.toE164('9876543210'), '+919876543210');
    });

    test('rejects what is not an Indian mobile number', () {
      for (final raw in ['12345', '1234567890', '98765432101', '', 'abc', '+1 415 555 0100']) {
        expect(PhoneNumberInput.normalise(raw), isNull, reason: raw);
      }
    });
  });

  group('Firebase error mapping', () {
    test('every code lands on a kind with a fixed plain message', () {
      const map = FirebasePhoneAuthService.mapFirebaseCode;
      expect(map('invalid-phone-number'), AuthFailureKind.invalidNumber);
      expect(map('invalid-verification-code'), AuthFailureKind.invalidCode);
      expect(map('session-expired'), AuthFailureKind.expiredCode);
      expect(map('too-many-requests'), AuthFailureKind.tooManyRequests);
      expect(map('quota-exceeded'), AuthFailureKind.tooManyRequests);
      expect(map('network-request-failed'), AuthFailureKind.network);
      expect(map('app-not-authorized'), AuthFailureKind.appNotAuthorised);
      expect(map('missing-client-identifier'), AuthFailureKind.appNotAuthorised);
      expect(map('web-context-cancelled'), AuthFailureKind.cancelled);
      expect(map('something-new'), AuthFailureKind.unknown);

      for (final kind in AuthFailureKind.values) {
        final message = AuthFailure(kind).message;
        expect(message, isNotEmpty);
        expect(message.toLowerCase(), isNot(contains('firebase')));
        expect(message, isNot(contains('[')));
      }
    });

    test('a failure nobody can act on names its code, the rest do not', () {
      // The two the user cannot fix are the two a support call is about,
      // so they carry the provider's own code.
      const blocked = AuthFailure(
        AuthFailureKind.appNotAuthorised,
        code: 'missing-client-identifier',
      );
      expect(blocked.message, contains('missing-client-identifier'));

      const strange = AuthFailure(
        AuthFailureKind.unknown,
        code: 'something-new',
      );
      expect(strange.message, contains('something-new'));

      // An everyday failure stays plain even when a code is present.
      const wrongOtp = AuthFailure(
        AuthFailureKind.invalidCode,
        code: 'invalid-verification-code',
      );
      expect(wrongOtp.message, isNot(contains('invalid-verification-code')));

      // And no code at all reads exactly as before.
      const plain = AuthFailure(AuthFailureKind.appNotAuthorised);
      expect(plain.message, isNot(contains('(')));
    });
  });

  group('login screen', () {
    testWidgets('an invalid number never reaches the service', (tester) async {
      await tester.pumpWidget(app());
      await enterNumberAndSend(tester, '12345');
      expect(find.text('Enter a valid 10-digit Indian mobile number'), findsOneWidget);
      expect(auth.sendCalls, isEmpty);
    });

    testWidgets('a pasted +91 number is sent as ten digits', (tester) async {
      await tester.pumpWidget(app());
      await enterNumberAndSend(tester, '+91 98765 43210');
      await tester.pumpAndSettle();
      expect(auth.sendCalls.single.mobile, '9876543210');
      expect(find.byType(OtpVerificationScreen), findsOneWidget);
      await settle(tester);
    });

    testWidgets('shows a loading state while the code is on its way', (tester) async {
      final gate = Completer<OtpRequest>();
      auth.onSend = (m, t) => gate.future;
      await tester.pumpWidget(app());
      await enterNumberAndSend(tester, '9876543210');
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      gate.complete(OtpRequest(verificationId: 'v', resendToken: 1));
      await tester.pumpAndSettle();
      expect(find.byType(OtpVerificationScreen), findsOneWidget);
      await settle(tester);
    });

    for (final (kind, expected) in [
      (AuthFailureKind.tooManyRequests, 'Too many attempts'),
      (AuthFailureKind.network, 'No internet connection'),
      (AuthFailureKind.appNotAuthorised, 'not set up for phone sign-in'),
      (AuthFailureKind.invalidNumber, 'does not look right'),
    ]) {
      testWidgets('$kind is told in plain words, not Firebase text', (tester) async {
        auth.onSend = (m, t) => throw AuthFailure(kind);
        await tester.pumpWidget(app());
        await enterNumberAndSend(tester, '9876543210');
        await tester.pump();
        expect(find.textContaining(expected), findsOneWidget);
        expect(find.textContaining('Exception'), findsNothing);
        expect(find.byType(LoginScreen), findsOneWidget);
      });
    }

    testWidgets('an unexpected exception is still a plain sentence', (tester) async {
      auth.onSend = (m, t) => throw StateError('FirebaseAuthException [internal-error]');
      await tester.pumpWidget(app());
      await enterNumberAndSend(tester, '9876543210');
      await tester.pump();
      expect(find.textContaining('Something went wrong'), findsOneWidget);
      expect(find.textContaining('internal-error'), findsNothing);
    });

    testWidgets('instant verification skips the OTP screen entirely', (tester) async {
      auth.onSend = (m, t) async => OtpRequest(verificationId: '', signedInImmediately: true);
      await tester.pumpWidget(app());
      await enterNumberAndSend(tester, '9876543210');
      await tester.pumpAndSettle();
      expect(find.text('DASHBOARD'), findsOneWidget);
      expect(AuthScope.isAuthenticated, isTrue);
    });

    testWidgets('has no password field and no password sign-in', (tester) async {
      await tester.pumpWidget(app());
      expect(find.textContaining('Password'), findsNothing);
      final source = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))
          .map((f) => f.readAsStringSync())
          .join();
      expect(source, isNot(contains('signInWithEmailAndPassword')));
      expect(source, isNot(contains('createUserWithEmailAndPassword')));
      expect(source, isNot(contains('obscureText: true')));
    });
  });

  group('OTP screen', () {
    Future<void> openOtp(WidgetTester tester) async {
      await tester.pumpWidget(app());
      await enterNumberAndSend(tester, '9876543210');
      await tester.pumpAndSettle();
      expect(find.byType(OtpVerificationScreen), findsOneWidget);
    }

    testWidgets('the sixth digit submits, once, and a right code signs in',
        (tester) async {
      await openOtp(tester);
      await tester.enterText(find.byType(TextField), '123456');
      await tester.pumpAndSettle();
      // No tap on Verify was needed; the sixth digit did it, once.
      expect(auth.verifyCalls, ['123456']);
      expect(find.text('DASHBOARD'), findsOneWidget);
      expect(AuthScope.isAuthenticated, isTrue);
    });

    testWidgets('a wrong code says so and lets the user try again', (tester) async {
      await openOtp(tester);
      await tester.enterText(find.byType(TextField), '000000');
      await tester.pumpAndSettle();
      expect(find.textContaining('Incorrect OTP'), findsOneWidget);
      expect(find.byType(OtpVerificationScreen), findsOneWidget);
      expect(AuthScope.isAuthenticated, isFalse);
      await settle(tester);
    });

    testWidgets('an expired code opens Resend at once', (tester) async {
      auth.onVerify = (otp) => throw const AuthFailure(AuthFailureKind.expiredCode);
      await openOtp(tester);
      expect(find.textContaining('Resend OTP in'), findsOneWidget);
      await tester.enterText(find.byType(TextField), '123456');
      await tester.pumpAndSettle();
      expect(find.textContaining('has expired'), findsOneWidget);
      expect(find.text('Resend OTP'), findsOneWidget);
      await settle(tester);
    });

    testWidgets('resend waits out the cooldown and reuses the resend token',
        (tester) async {
      await openOtp(tester);
      expect(find.text('Resend OTP'), findsNothing);
      await tester.pump(const Duration(seconds: 3));
      await tester.tap(find.text('Resend OTP'));
      await tester.pumpAndSettle();
      expect(auth.sendCalls, hasLength(2));
      // The first send had no token; the resend carries the one the
      // first request came back with.
      expect(auth.sendCalls[0].resendToken, isNull);
      expect(auth.sendCalls[1].resendToken, 100);
      expect(find.text('A new OTP has been sent.'), findsOneWidget);
      await settle(tester);
    });

    testWidgets('a network failure on resend is a plain sentence', (tester) async {
      await openOtp(tester);
      auth.onSend = (m, t) => throw const AuthFailure(AuthFailureKind.network);
      await tester.pump(const Duration(seconds: 3));
      await tester.tap(find.text('Resend OTP'));
      await tester.pumpAndSettle();
      expect(find.textContaining('No internet connection'), findsOneWidget);
      await settle(tester);
    });

    testWidgets('Change number goes back to the login screen', (tester) async {
      await openOtp(tester);
      await tester.tap(find.text('Change number'));
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.byType(OtpVerificationScreen), findsNothing);
    });

    testWidgets('a late auto verification signs in without typing', (tester) async {
      await openOtp(tester);
      auth.lastRequest!.reportAutoVerification(true);
      await tester.pumpAndSettle();
      expect(find.text('DASHBOARD'), findsOneWidget);
      expect(auth.verifyCalls, isEmpty);
      expect(AuthScope.isAuthenticated, isTrue);
    });

    testWidgets('a verify already in flight is not sent twice', (tester) async {
      final gate = Completer<bool>();
      auth.onVerify = (otp) => gate.future;
      await openOtp(tester);
      await tester.enterText(find.byType(TextField), '123456');
      await tester.pump();
      await tester.tap(find.text('Verify OTP'), warnIfMissed: false);
      await tester.pump();
      expect(auth.verifyCalls, hasLength(1));
      gate.complete(true);
      await tester.pumpAndSettle();
      expect(find.text('DASHBOARD'), findsOneWidget);
    });
  });

  group('session', () {
    test('a saved session is signed in after a restart', () async {
      SharedPreferences.setMockInitialValues({
        AuthSessionNotifier.authenticatedKey: true,
        AuthSessionNotifier.mobileKey: '9876543210',
        AuthSessionNotifier.uidKey: 'uid-1',
      });
      await AuthScope.loadFromDisk();
      expect(AuthScope.isAuthenticated, isTrue);

      final notifier = AuthSessionNotifier();
      await Future<void>.delayed(Duration.zero);
      expect(notifier.state.isAuthenticated, isTrue);
      expect(notifier.state.mobileNumber, '9876543210');
      expect(notifier.state.uid, 'uid-1');
      notifier.dispose();
    });

    test('sign-out clears the session and marks it deliberate', () async {
      SharedPreferences.setMockInitialValues({
        AuthSessionNotifier.authenticatedKey: true,
        AuthSessionNotifier.mobileKey: '9876543210',
      });
      await AuthScope.loadFromDisk();
      final notifier = AuthSessionNotifier();
      await Future<void>.delayed(Duration.zero);

      await notifier.signOut();

      expect(AuthScope.isAuthenticated, isFalse);
      expect(notifier.state.isAuthenticated, isFalse);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool(AuthSessionNotifier.authenticatedKey), isNull);
      expect(prefs.getString(AuthSessionNotifier.mobileKey), isNull);
      expect(prefs.getBool(AuthSessionNotifier.explicitSignOutKey), isTrue);
      notifier.dispose();
    });

    test('Firebase ending the session clears the local one', () async {
      SharedPreferences.setMockInitialValues({
        AuthSessionNotifier.authenticatedKey: true,
        AuthSessionNotifier.mobileKey: '9876543210',
        AuthSessionNotifier.uidKey: 'uid-1',
      });
      await AuthScope.loadFromDisk();
      final notifier = AuthSessionNotifier();
      await Future<void>.delayed(Duration.zero);
      expect(notifier.state.isAuthenticated, isTrue);

      await AuthStateWatcher.onUserChanged(false);

      expect(AuthScope.isAuthenticated, isFalse);
      expect(notifier.state.isAuthenticated, isFalse,
          reason: 'the provider follows AuthScope');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool(AuthSessionNotifier.authenticatedKey), isNull);
      expect(prefs.getString(AuthSessionNotifier.uidKey), isNull);
      notifier.dispose();
    });

    test('a deliberate sign-out, or nobody signed in, is left alone', () {
      expect(
        AuthStateWatcher.decide(
            firebaseUserPresent: false, locallyAuthenticated: true, explicitlySignedOut: true),
        AuthStateAction.nothing,
      );
      expect(
        AuthStateWatcher.decide(
            firebaseUserPresent: false, locallyAuthenticated: false, explicitlySignedOut: false),
        AuthStateAction.nothing,
      );
      expect(
        AuthStateWatcher.decide(
            firebaseUserPresent: true, locallyAuthenticated: true, explicitlySignedOut: false),
        AuthStateAction.nothing,
      );
      expect(
        AuthStateWatcher.decide(
            firebaseUserPresent: false, locallyAuthenticated: true, explicitlySignedOut: false),
        AuthStateAction.clearLocalSession,
      );
    });

    testWidgets('the router leaves the app the moment the session ends', (tester) async {
      SharedPreferences.setMockInitialValues({AuthSessionNotifier.authenticatedKey: true});
      await AuthScope.loadFromDisk();
      final router = GoRouter(
        initialLocation: '/dashboard',
        refreshListenable: AuthScope.listenable,
        redirect: (context, state) =>
            AuthScope.isAuthenticated || state.matchedLocation == '/login' ? null : '/login',
        routes: [
          GoRoute(path: '/login', builder: (c, s) => const Text('LOGIN')),
          GoRoute(path: '/dashboard', builder: (c, s) => const Text('DASHBOARD')),
        ],
      );
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      expect(find.text('DASHBOARD'), findsOneWidget);

      await AuthStateWatcher.onUserChanged(false);
      await tester.pumpAndSettle();
      expect(find.text('LOGIN'), findsOneWidget);
    });
  });
}
