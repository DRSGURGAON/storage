import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/features/subscription/models/subscription_model.dart';
import 'package:godown_book/features/subscription/utils/signup_counts.dart';

void main() {
  final now = DateTime(2026, 10, 5, 18, 15);

  SubscriptionModel joined(String createdAt) => SubscriptionModel(
        id: createdAt,
        companyId: 'c-$createdAt',
        createdAt: createdAt,
        updatedAt: createdAt,
      );

  test('counts every company and buckets the recent ones', () {
    final counts = SignupCounts.from([
      joined(DateTime(2026, 10, 5, 9).toIso8601String()), // today
      joined(DateTime(2026, 10, 5, 0, 0).toIso8601String()), // today, midnight
      joined(DateTime(2026, 10, 4, 23, 59).toIso8601String()), // yesterday
      joined(DateTime(2026, 9, 29).toIso8601String()), // 6 days ago
      joined(DateTime(2026, 9, 28).toIso8601String()), // 7 days ago
      joined(DateTime(2026, 9, 6).toIso8601String()), // 29 days ago
      joined(DateTime(2026, 9, 5).toIso8601String()), // 30 days ago
    ], now: now);

    expect(counts.total, 7);
    expect(counts.today, 2);
    expect(counts.last7Days, 4);
    expect(counts.last30Days, 6);
  });

  test('a record with no usable date still counts in the total', () {
    final counts = SignupCounts.from([joined(''), joined('not a date')], now: now);

    expect(counts.total, 2);
    expect(counts.today, 0);
    expect(counts.last30Days, 0);
  });

  test('nothing yet reads as zeroes, not an error', () {
    final counts = SignupCounts.from(const [], now: now);

    expect(counts.total, 0);
    expect(counts.last7Days, 0);
  });
}
