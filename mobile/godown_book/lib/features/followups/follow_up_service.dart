import '../billing/models/bill_model.dart';
import '../quotation/models/quotation_model.dart';
import '../storage_booking/models/storage_booking_model.dart';

/// Why a customer is on today's call list.
enum FollowUpReason { quotation, payment, storageEnd }

/// One customer to call today, and why.
class FollowUpCall {
  final FollowUpReason reason;
  final String customerName;
  final String phone;

  /// One line saying what the call is about.
  final String detail;

  /// The record to open: a quotation id, a customer id (payments) or a
  /// storage booking id.
  final String recordId;

  const FollowUpCall({
    required this.reason,
    required this.customerName,
    required this.phone,
    required this.detail,
    required this.recordId,
  });
}

/// The calls a godown owner should make - Bill N Bilty's "Call today",
/// for storage: quotations to follow up, overdue payments to chase, and
/// storage past its expected end to confirm (extend or release).
class FollowUps {
  FollowUps._();

  static DateTime _day(DateTime d) => DateTime(d.year, d.month, d.day);

  static DateTime? dateOf(String iso) {
    final d = DateTime.tryParse(iso);
    return d == null ? null : _day(d);
  }

  /// "Booked" / "Lost" close a follow-up; so does an empty date.
  static bool isOpen(QuotationModel q) =>
      q.followUpDate.isNotEmpty &&
      q.status != QuotationStatus.accepted &&
      q.status != QuotationStatus.declined;

  /// Quotation follow-ups due today or earlier, the oldest first.
  static List<QuotationModel> quotationsDue(
    List<QuotationModel> quotations,
    DateTime today,
  ) =>
      [
        for (final q in quotations)
          if (isOpen(q) && !(dateOf(q.followUpDate) ?? _day(today)).isAfter(_day(today))) q,
      ]..sort((a, b) => a.followUpDate.compareTo(b.followUpDate));

  /// Follow-ups planned for later, the soonest first.
  static List<QuotationModel> quotationsUpcoming(
    List<QuotationModel> quotations,
    DateTime today,
  ) =>
      [
        for (final q in quotations)
          if (isOpen(q) && (dateOf(q.followUpDate) ?? _day(today)).isAfter(_day(today))) q,
      ]..sort((a, b) => a.followUpDate.compareTo(b.followUpDate));

  /// Quotations whose follow-up has ended: booked or lost.
  static List<QuotationModel> quotationsClosed(
    List<QuotationModel> quotations,
  ) =>
      [
        for (final q in quotations)
          if (q.status == QuotationStatus.accepted ||
              q.status == QuotationStatus.declined)
            q,
      ]..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

  /// "Today", "Tomorrow", "3 days late", "In 4 days".
  static String dueLabel(String iso, DateTime today) {
    final date = dateOf(iso);
    if (date == null) return '';
    final days = date.difference(_day(today)).inDays;
    if (days == 0) return 'Today';
    if (days == 1) return 'Tomorrow';
    if (days == -1) return '1 day late';
    if (days < 0) return '${-days} days late';
    return 'In $days days';
  }

  /// Everyone to call today: quotation follow-ups first (a booking to
  /// win), then overdue payments (one call per customer, with the
  /// total), then storage past its expected end.
  static List<FollowUpCall> callsToday({
    required List<QuotationModel> quotations,
    required List<BillModel> overdueBills,
    required List<StorageBookingModel> pastExpectedEnd,
    required DateTime today,
    String Function(double)? money,
  }) {
    final rupees = money ?? (double v) => 'Rs. ${v.toStringAsFixed(0)}';
    final calls = <FollowUpCall>[
      for (final q in quotationsDue(quotations, today))
        FollowUpCall(
          reason: FollowUpReason.quotation,
          customerName: q.customerName,
          phone: q.customerPhone,
          detail: 'Quotation ${q.quotationNo} - ${dueLabel(q.followUpDate, today)}',
          recordId: q.id,
        ),
    ];

    final byCustomer = <String, List<BillModel>>{};
    for (final b in overdueBills) {
      final key = b.customerId.isNotEmpty ? b.customerId : b.customerName;
      byCustomer.putIfAbsent(key, () => []).add(b);
    }
    for (final entry in byCustomer.entries) {
      final bills = entry.value;
      final total = bills.fold<double>(0, (s, b) => s + b.balanceDue);
      calls.add(FollowUpCall(
        reason: FollowUpReason.payment,
        customerName: bills.first.customerName,
        phone: bills.first.customerPhone,
        detail: '${rupees(total)} overdue'
            '${bills.length > 1 ? ' on ${bills.length} bills' : ' - ${bills.first.billNo}'}',
        recordId: bills.first.customerId,
      ));
    }

    for (final b in pastExpectedEnd) {
      calls.add(FollowUpCall(
        reason: FollowUpReason.storageEnd,
        customerName: b.customerName,
        phone: b.customerPhone,
        detail: 'Storage ${b.bookingNo} is past its end date - extend or '
            'release?',
        recordId: b.id,
      ));
    }
    return calls;
  }
}
