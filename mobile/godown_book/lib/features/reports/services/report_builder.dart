import '../../billing/models/bill_model.dart';
import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/models/storage_status.dart';

/// One storage record on the rent roll - what is in the godown right
/// now and what it earns.
class RentRollRow {
  final String bookingId;
  final String bookingNo;
  final String customerName;
  final String customerPhone;
  final String locationName;
  final String since;
  final RentBasis basis;
  final double rate;
  final String rateUnit;
  final double packagesLeft;
  final String billedUpto;

  /// What a month of this record is worth at the agreed rate - the
  /// figure the roll adds up. A daily rate is taken over 30 days, a
  /// per-box rate over the boxes still inside, and a fixed amount as
  /// itself.
  final double monthlyRent;

  const RentRollRow({
    required this.bookingId,
    required this.bookingNo,
    required this.customerName,
    required this.customerPhone,
    required this.locationName,
    required this.since,
    required this.basis,
    required this.rate,
    required this.rateUnit,
    required this.packagesLeft,
    required this.billedUpto,
    required this.monthlyRent,
  });

  /// Days the goods have been inside as on the report date.
  int daysInside(DateTime asOn) {
    final start = DateTime.tryParse(since);
    if (start == null) return 0;
    final days = asOn.difference(DateTime(start.year, start.month, start.day)).inDays;
    return days < 0 ? 0 : days;
  }
}

class RentRoll {
  final DateTime asOn;
  final List<RentRollRow> rows;

  const RentRoll({required this.asOn, required this.rows});

  int get count => rows.length;

  double get monthlyRent => rows.fold(0.0, (sum, r) => sum + r.monthlyRent);

  double get packagesLeft => rows.fold(0.0, (sum, r) => sum + r.packagesLeft);
}

/// How old an unpaid bill is, counted from its due date (or its bill
/// date when no due date was set).
enum AgeBucket {
  current,
  days31to60,
  days61to90,
  over90;

  String get label => switch (this) {
        AgeBucket.current => '0-30 days',
        AgeBucket.days31to60 => '31-60 days',
        AgeBucket.days61to90 => '61-90 days',
        AgeBucket.over90 => 'Over 90 days',
      };

  static AgeBucket forDays(int days) {
    if (days <= 30) return AgeBucket.current;
    if (days <= 60) return AgeBucket.days31to60;
    if (days <= 90) return AgeBucket.days61to90;
    return AgeBucket.over90;
  }
}

/// One customer's unpaid bills, spread across the age buckets.
class AgeingRow {
  final String customerId;
  final String customerName;
  final String customerPhone;
  final Map<AgeBucket, double> buckets;
  final int bills;
  final int oldestDays;

  const AgeingRow({
    required this.customerId,
    required this.customerName,
    required this.customerPhone,
    required this.buckets,
    required this.bills,
    required this.oldestDays,
  });

  double amountIn(AgeBucket bucket) => buckets[bucket] ?? 0;

  double get total => buckets.values.fold(0.0, (sum, v) => sum + v);
}

class AgeingReport {
  final DateTime asOn;
  final List<AgeingRow> rows;

  const AgeingReport({required this.asOn, required this.rows});

  double totalIn(AgeBucket bucket) =>
      rows.fold(0.0, (sum, r) => sum + r.amountIn(bucket));

  double get grandTotal => rows.fold(0.0, (sum, r) => sum + r.total);

  int get customers => rows.length;
}

/// Turns what the repositories already hold into the two reports an
/// operator asks for at month end. Pure functions over lists, so they
/// can be checked without a database.
class ReportBuilder {
  ReportBuilder._();

  static RentRoll rentRoll(List<StorageBookingModel> bookings, {DateTime? asOn}) {
    final date = asOn ?? DateTime.now();

    final rows = <RentRollRow>[];
    for (final b in bookings) {
      if (!b.status.isOpen) continue;

      final packages = b.items.isEmpty
          ? b.totalPackages.toDouble()
          : b.remainingQuantity;

      rows.add(RentRollRow(
        bookingId: b.id,
        bookingNo: b.bookingNo,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        locationName: b.locationName,
        since: b.storageStartDate,
        basis: b.rentBasis,
        rate: b.rentRate,
        rateUnit: b.rentUnitLabel.isEmpty ? b.rentBasis.rateHint : b.rentUnitLabel,
        packagesLeft: packages,
        billedUpto: b.rentBilledUpto,
        monthlyRent: _monthlyRent(b, packages),
      ));
    }

    rows.sort((a, b) {
      final byLocation = a.locationName.compareTo(b.locationName);
      if (byLocation != 0) return byLocation;
      return a.since.compareTo(b.since);
    });

    return RentRoll(asOn: date, rows: rows);
  }

  static double _monthlyRent(StorageBookingModel b, double packages) {
    if (b.rentRate <= 0) return 0;
    return switch (b.rentBasis) {
      RentBasis.monthly => b.rentRate,
      RentBasis.daily => b.rentRate * 30,
      RentBasis.perBoxMonthly => b.rentRate * packages,
      RentBasis.custom => b.rentRate,
    };
  }

  static AgeingReport agedOutstanding(List<BillModel> bills, {DateTime? asOn}) {
    final date = asOn ?? DateTime.now();
    final today = DateTime(date.year, date.month, date.day);

    final byCustomer = <String, List<BillModel>>{};
    for (final bill in bills) {
      if (bill.balanceDue <= 0.004) continue;
      final key = bill.customerId.isEmpty
          ? 'name:${bill.customerName.trim().toLowerCase()}'
          : bill.customerId;
      byCustomer.putIfAbsent(key, () => []).add(bill);
    }

    final rows = <AgeingRow>[];
    for (final entry in byCustomer.entries) {
      final buckets = <AgeBucket, double>{};
      var oldest = 0;
      for (final bill in entry.value) {
        final days = _ageInDays(bill, today);
        if (days > oldest) oldest = days;
        final bucket = AgeBucket.forDays(days);
        buckets[bucket] = (buckets[bucket] ?? 0) + bill.balanceDue;
      }
      final first = entry.value.first;
      rows.add(AgeingRow(
        customerId: first.customerId,
        customerName: first.customerName,
        customerPhone: first.customerPhone,
        buckets: buckets,
        bills: entry.value.length,
        oldestDays: oldest,
      ));
    }

    // The oldest debt first - that is who to call.
    rows.sort((a, b) {
      final byAge = b.oldestDays.compareTo(a.oldestDays);
      if (byAge != 0) return byAge;
      return b.total.compareTo(a.total);
    });

    return AgeingReport(asOn: date, rows: rows);
  }

  /// Days past due as on [today]; a bill not yet due counts as zero.
  static int _ageInDays(BillModel bill, DateTime today) {
    final anchor = DateTime.tryParse(bill.dueDate) ?? DateTime.tryParse(bill.billDate);
    if (anchor == null) return 0;
    final days =
        today.difference(DateTime(anchor.year, anchor.month, anchor.day)).inDays;
    return days < 0 ? 0 : days;
  }
}
