import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/models/storage_status.dart';
import '../models/bill_model.dart';

/// One worked-out storage charge, with the words that explain it.
class StorageCharge {
  /// How many months, days or boxes were charged.
  final double quantity;

  /// What one of those costs.
  final double rate;

  final double amount;

  /// Plain-language explanation printed on the bill line, e.g.
  /// "01 Sep 2026 to 30 Sep 2026 - 1 month at Rs. 3500.00 per month".
  final String description;

  const StorageCharge({
    required this.quantity,
    required this.rate,
    required this.amount,
    required this.description,
  });
}

/// Works out what a customer owes for one storage period, under the
/// four ways an operator charges: a fixed amount per month, an amount
/// per day, an amount per box per month, or one flat agreed amount.
///
/// A started month counts as a full month, which is what the standard
/// terms say and what operators do; the description always spells out
/// what was counted, so a customer can check it.
class StorageChargeCalculator {
  StorageChargeCalculator._();

  /// Started months between [from] and [to], both inclusive. The first
  /// month begins on [from], the next one a calendar month later, and
  /// any month that has begun by [to] is counted.
  static int startedMonths(DateTime from, DateTime to) {
    if (to.isBefore(from)) return 0;

    var count = 0;
    var cursor = DateTime(from.year, from.month, from.day);
    while (!cursor.isAfter(to)) {
      count++;
      cursor = _addMonth(cursor);
    }
    return count;
  }

  /// Days between [from] and [to], both inclusive.
  static int days(DateTime from, DateTime to) {
    if (to.isBefore(from)) return 0;
    return DateTime(to.year, to.month, to.day)
            .difference(DateTime(from.year, from.month, from.day))
            .inDays +
        1;
  }

  /// The date one calendar month after [date], clamped to the end of
  /// the month when the day does not exist (31 Jan -> 28/29 Feb).
  static DateTime _addMonth(DateTime date) {
    final year = date.month == 12 ? date.year + 1 : date.year;
    final month = date.month == 12 ? 1 : date.month + 1;
    final lastDay = DateTime(year, month + 1, 0).day;
    return DateTime(year, month, date.day > lastDay ? lastDay : date.day);
  }

  static String _date(DateTime date) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${date.day.toString().padLeft(2, '0')} '
        '${months[date.month - 1]} ${date.year}';
  }

  /// "1 month", "2 months", "42 boxes" - the plural of the few units
  /// this calculator prints, spelled correctly.
  static String _plural(double value, String unit) {
    final rounded = value == value.roundToDouble()
        ? value.toStringAsFixed(0)
        : value.toStringAsFixed(2);
    if (value == 1) return '$rounded $unit';
    final plural = unit.endsWith('x') ? '${unit}es' : '${unit}s';
    return '$rounded $plural';
  }

  /// The storage charge for [booking] over [from]..[to].
  ///
  /// [boxes] overrides the number of boxes charged under the per-box
  /// model; by default the storage record's own package count (or its
  /// item quantities) is used.
  static StorageCharge compute(
    StorageBookingModel booking, {
    required DateTime from,
    required DateTime to,
    double? boxes,
  }) {
    final rate = booking.rentRate;
    final period = '${_date(from)} to ${_date(to)}';

    switch (booking.rentBasis) {
      case RentBasis.monthly:
        final months = startedMonths(from, to).toDouble();
        return StorageCharge(
          quantity: months,
          rate: rate,
          amount: months * rate,
          description: '$period - ${_plural(months, 'month')} at '
              'Rs. ${rate.toStringAsFixed(2)} per month',
        );

      case RentBasis.daily:
        final dayCount = days(from, to).toDouble();
        return StorageCharge(
          quantity: dayCount,
          rate: rate,
          amount: dayCount * rate,
          description: '$period - ${_plural(dayCount, 'day')} at '
              'Rs. ${rate.toStringAsFixed(2)} per day',
        );

      case RentBasis.perBoxMonthly:
        final months = startedMonths(from, to).toDouble();
        final count = boxes ??
            (booking.totalPackages > 0
                ? booking.totalPackages.toDouble()
                : booking.totalQuantity);
        final quantity = months * count;
        return StorageCharge(
          quantity: quantity,
          rate: rate,
          amount: quantity * rate,
          description: '$period - ${_plural(count, 'box')} for '
              '${_plural(months, 'month')} at Rs. ${rate.toStringAsFixed(2)} '
              'per box per month',
        );

      case RentBasis.custom:
        return StorageCharge(
          quantity: 1,
          rate: rate,
          amount: rate,
          description: '$period - agreed storage charge',
        );
    }
  }

  /// The storage line a bill starts with for [booking] over the period.
  static BillLineModel line(
    StorageBookingModel booking, {
    required String id,
    required DateTime from,
    required DateTime to,
    double? boxes,
  }) {
    final charge = compute(booking, from: from, to: to, boxes: boxes);
    return BillLineModel(
      id: id,
      chargeName: 'Storage Charge',
      description: charge.description,
      quantity: charge.quantity,
      rate: charge.rate,
      amount: charge.amount,
    );
  }

  /// Where the next bill for [booking] should start: the day after rent
  /// was last billed, or the day the goods came in.
  static DateTime nextPeriodStart(StorageBookingModel booking) {
    final billedUpto = DateTime.tryParse(booking.rentBilledUpto);
    if (billedUpto != null) {
      return DateTime(billedUpto.year, billedUpto.month, billedUpto.day)
          .add(const Duration(days: 1));
    }
    final start = DateTime.tryParse(booking.storageStartDate);
    return start == null
        ? DateTime.now()
        : DateTime(start.year, start.month, start.day);
  }
}
