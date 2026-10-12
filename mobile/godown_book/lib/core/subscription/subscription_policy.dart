import '../../features/subscription/models/subscription_model.dart';
import 'subscription_status.dart';

/// The rules for "does this company get full access right now" - pure
/// functions, no Firestore, no clock of their own, so every rule here can
/// be tested and nothing about it depends on where the data came from.
///
/// Three rules the stored `status` alone could never express:
///
///  1. EXPIRY IS ENFORCED. `status` stays ACTIVE in Firestore until
///     somebody changes it, and nothing automatically does - so a
///     subscription whose date had passed kept full access for ever.
///     Access now also requires that the expiry date has not passed.
///     Grace period: none. The expiry date is the LAST day of the
///     period; access ends when that day ends.
///
///  2. IT MUST BE YOUR SUBSCRIPTION. A subscription belongs to one
///     Firebase account (ownerUid). Another account signing in on the
///     same phone found the first account's cached ACTIVE record and
///     inherited it. A record whose owner is not the signed-in account
///     grants nothing.
///
///  3. OFFLINE TRUST HAS A LIMIT. When the record could not be confirmed
///     with the server (offline, or a cached copy) it is honoured only
///     for [maxOfflineDays] after the last time the app genuinely reached
///     the server - long enough for a few days in an area with no
///     signal, not for ever.
class SubscriptionPolicy {
  SubscriptionPolicy._();

  /// How long a record that was not freshly confirmed online is trusted.
  static const int maxOfflineDays = 30;

  /// The instant the subscription stops: the start of the day AFTER the
  /// expiry date (the expiry date itself is still a valid day). Null when
  /// there is no usable date.
  static DateTime? validUntil(String? expiryIso) {
    final expiry = DateTime.tryParse(expiryIso ?? '');
    if (expiry == null) return null;
    return DateTime(expiry.year, expiry.month, expiry.day + 1);
  }

  /// The status to act on: the stored one, except that ACTIVE and
  /// EXPIRING_SOON become EXPIRED once the expiry date has passed.
  static SubscriptionStatus effectiveStatus(
    SubscriptionModel subscription,
    DateTime now,
  ) {
    final status = subscription.status;

    if (status == SubscriptionStatus.active ||
        status == SubscriptionStatus.expiringSoon) {
      final end = validUntil(subscription.expiryDate);
      if (end != null && !now.isBefore(end)) {
        return SubscriptionStatus.expired;
      }
    }

    return status;
  }

  /// Does [subscription] grant full (non-demo) access?
  ///
  /// [live] - the record was just confirmed against the server.
  /// [sinceVerified] - how long ago the app last reached the server at
  /// all (null = unknown, e.g. a fresh install that has not been online
  /// yet; treated as "not yet checked", not as proof of cheating).
  static bool grantsAccess(
    SubscriptionModel subscription, {
    required DateTime now,
    required String currentUid,
    required bool live,
    Duration? sinceVerified,
  }) {
    if (currentUid.isEmpty) return false;

    // Rule 2 - someone else's subscription. A record with no owner at all
    // (older than the ownerUid field) is only trusted when it was just
    // read live, because only then has the server's own rules vouched
    // that this account may see it.
    if (subscription.ownerUid.isEmpty) {
      if (!live) return false;
    } else if (subscription.ownerUid != currentUid) {
      return false;
    }

    // Rule 3 - an unconfirmed record only counts for a limited time.
    if (!live &&
        sinceVerified != null &&
        sinceVerified > const Duration(days: maxOfflineDays)) {
      return false;
    }

    // Rule 1 - expiry.
    return effectiveStatus(subscription, now).grantsFullAccess;
  }
}
