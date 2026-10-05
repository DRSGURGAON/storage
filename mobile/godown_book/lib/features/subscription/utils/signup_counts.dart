import '../models/subscription_model.dart';

/// How many companies started using the app, and how recently.
///
/// A subscription document is created the first time a signed-in
/// install opens its company (SubscriptionRepository
/// .getOrCreateForCompany), so its createdAt is the closest thing the
/// app itself knows to "someone downloaded this and started". Play
/// Store install counts live in Play Console; an install that never
/// signs in leaves nothing here to count.
class SignupCounts {
  final int total;
  final int today;
  final int last7Days;
  final int last30Days;

  const SignupCounts({
    required this.total,
    required this.today,
    required this.last7Days,
    required this.last30Days,
  });

  factory SignupCounts.from(
    Iterable<SubscriptionModel> subscriptions, {
    DateTime? now,
  }) {
    final clock = now ?? DateTime.now();
    final startOfToday = DateTime(clock.year, clock.month, clock.day);
    final sevenDaysAgo = startOfToday.subtract(const Duration(days: 6));
    final thirtyDaysAgo = startOfToday.subtract(const Duration(days: 29));

    var total = 0, today = 0, week = 0, month = 0;
    for (final subscription in subscriptions) {
      total += 1;
      final joined = joinedOn(subscription);
      if (joined == null) continue;
      if (!joined.isBefore(startOfToday)) today += 1;
      if (!joined.isBefore(sevenDaysAgo)) week += 1;
      if (!joined.isBefore(thirtyDaysAgo)) month += 1;
    }

    return SignupCounts(
      total: total,
      today: today,
      last7Days: week,
      last30Days: month,
    );
  }

  /// Local date-time the company joined, or null when the record has
  /// no usable createdAt (a very old record) - such a company still
  /// counts in [total], just not in any recent window.
  static DateTime? joinedOn(SubscriptionModel subscription) {
    final parsed = DateTime.tryParse(subscription.createdAt);
    return parsed?.toLocal();
  }
}
