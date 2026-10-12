import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/security/trusted_clock.dart';
import 'package:godown_book/core/subscription/subscription_policy.dart';
import 'package:godown_book/core/subscription/subscription_status.dart';
import 'package:godown_book/features/subscription/models/subscription_model.dart';

SubscriptionModel _sub({
  SubscriptionStatus status = SubscriptionStatus.active,
  String expiry = '2026-12-31T00:00:00.000',
  String owner = 'uid-owner',
}) =>
    SubscriptionModel(
      id: 's',
      companyId: 'c',
      status: status,
      expiryDate: expiry,
      ownerUid: owner,
      createdAt: '',
      updatedAt: '',
    );

void main() {
  final today = DateTime(2026, 10, 12);

  group('SubscriptionPolicy', () {
    test('access runs through the whole of the expiry day, then stops', () {
      bool access(DateTime now) => SubscriptionPolicy.grantsAccess(
            _sub(expiry: '2026-10-12T00:00:00.000'),
            now: now,
            currentUid: 'uid-owner',
            live: true,
          );
      expect(access(DateTime(2026, 10, 12, 23, 59)), isTrue);
      expect(access(DateTime(2026, 10, 13)), isFalse);
    });

    test("another account's subscription grants nothing", () {
      expect(
        SubscriptionPolicy.grantsAccess(_sub(),
            now: today, currentUid: 'uid-someone-else', live: true),
        isFalse,
      );
      expect(
        SubscriptionPolicy.grantsAccess(_sub(),
            now: today, currentUid: '', live: true),
        isFalse,
      );
    });

    test('a record with no owner counts only when read live', () {
      final ownerless = _sub(owner: '');
      expect(
        SubscriptionPolicy.grantsAccess(ownerless,
            now: today, currentUid: 'uid-owner', live: true),
        isTrue,
      );
      expect(
        SubscriptionPolicy.grantsAccess(ownerless,
            now: today, currentUid: 'uid-owner', live: false),
        isFalse,
      );
    });

    test('an unconfirmed copy is trusted for 30 days only', () {
      bool access(int days) => SubscriptionPolicy.grantsAccess(
            _sub(),
            now: today,
            currentUid: 'uid-owner',
            live: false,
            sinceVerified: Duration(days: days),
          );
      expect(access(29), isTrue);
      expect(access(31), isFalse);
    });

    test('LIMITED never grants access', () {
      expect(
        SubscriptionPolicy.grantsAccess(
            _sub(status: SubscriptionStatus.limited),
            now: today,
            currentUid: 'uid-owner',
            live: true),
        isFalse,
      );
    });
  });

  group('TrustedClock', () {
    const anchor = ClockAnchor(serverMs: 1000000, elapsedMs: 500, boot: 7);

    test('same boot: server time plus the counter the user cannot change', () {
      expect(
        TrustedClock.computeNowMs(
          deviceNowMs: 1, // the phone's date set far back
          highWaterMs: 0,
          anchor: anchor,
          elapsedNowMs: 1500,
          bootNow: 7,
        ),
        1001000,
      );
    });

    test('after a reboot: the device clock, never earlier than seen before',
        () {
      expect(
        TrustedClock.computeNowMs(
          deviceNowMs: 10,
          highWaterMs: 999999,
          anchor: anchor,
          elapsedNowMs: 100,
          bootNow: 8,
        ),
        999999,
      );
    });
  });
}
