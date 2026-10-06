import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/features/subscription/services/app_user_presence_service.dart';
import 'package:godown_book/features/subscription/utils/signup_counts.dart';

void main() {
  late FakeFirebaseFirestore cloud;

  setUp(() {
    cloud = FakeFirebaseFirestore();
    AppUserPresenceService.firestoreOverride = cloud;
  });

  tearDown(() => AppUserPresenceService.firestoreOverride = null);

  test('the first sign-in is kept; later launches move only last seen',
      () async {
    final service = AppUserPresenceService.instance;
    await service.record('uid-1', now: DateTime(2026, 10, 1, 9), appBuild: '66');
    await service.record('uid-1', now: DateTime(2026, 10, 6, 18), appBuild: '67');

    final data = (await cloud.collection('appUsers').doc('uid-1').get()).data()!;
    expect(data['firstSignInAt'], DateTime(2026, 10, 1, 9).toIso8601String());
    expect(data['lastSeenAt'], DateTime(2026, 10, 6, 18).toIso8601String());
    expect(data['appBuild'], '67');
    expect(data.keys.toSet(), {'uid', 'firstSignInAt', 'lastSeenAt', 'appBuild'});
  });

  test('every account that signed in is listed once', () async {
    final service = AppUserPresenceService.instance;
    await service.record('uid-1', now: DateTime(2026, 10, 6, 9));
    await service.record('uid-2', now: DateTime(2026, 9, 20, 9));
    await service.record('uid-1', now: DateTime(2026, 10, 6, 10));
    await service.record('  ');

    final users = await service.getAll();
    expect(users.map((u) => u.uid).toSet(), {'uid-1', 'uid-2'});

    final joined = SignupCounts.fromDates(
      users.map((u) => SignupCounts.parseDate(u.firstSignInAt)),
      now: DateTime(2026, 10, 6, 20),
    );
    expect(joined.total, 2);
    expect(joined.today, 1);
    expect(joined.last30Days, 2);
  });

  test('account deletion removes the record', () async {
    final service = AppUserPresenceService.instance;
    await service.record('uid-1');
    await service.deleteOwn('uid-1');
    expect((await cloud.collection('appUsers').doc('uid-1').get()).exists, isFalse);
  });
}
