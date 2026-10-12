import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/features/billing/models/bill_model.dart';
import 'package:godown_book/features/followups/follow_up_service.dart';
import 'package:godown_book/features/quotation/models/quotation_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';

QuotationModel _q(String id, String followUp,
        {QuotationStatus status = QuotationStatus.sent}) =>
    QuotationModel(
      id: id,
      quotationNo: 'QT/$id',
      quotationDate: '2026-10-01',
      customerName: 'Customer $id',
      customerPhone: '98765000$id',
      followUpDate: followUp,
      status: status,
      createdAt: '2026-10-01',
    );

void main() {
  final today = DateTime(2026, 10, 12, 15);
  final quotations = [
    _q('1', '2026-10-12'),
    _q('2', '2026-10-09'),
    _q('3', '2026-10-15'),
    _q('4', '2026-10-01', status: QuotationStatus.accepted),
    _q('5', ''),
  ];

  test('quotation follow-ups: due, upcoming and closed', () {
    expect(FollowUps.quotationsDue(quotations, today).map((q) => q.id),
        ['2', '1']);
    expect(FollowUps.quotationsUpcoming(quotations, today).map((q) => q.id),
        ['3']);
    expect(FollowUps.quotationsClosed(quotations).map((q) => q.id), ['4']);
  });

  test('due labels read like a person would say them', () {
    expect(FollowUps.dueLabel('2026-10-12', today), 'Today');
    expect(FollowUps.dueLabel('2026-10-13', today), 'Tomorrow');
    expect(FollowUps.dueLabel('2026-10-09', today), '3 days late');
    expect(FollowUps.dueLabel('2026-10-16', today), 'In 4 days');
  });

  test("today's calls: follow-ups, one call per customer owing, storage ending",
      () {
    final bills = [
      BillModel(
        id: 'b1', billNo: 'B-1', billDate: '2026-09-01', customerId: 'c1',
        customerName: 'Rajesh', customerPhone: '9876500001',
        createdAt: '2026-09-01',
        lines: const [BillLineModel(id: 'l1', chargeName: 'Rent', amount: 1000)],
      ),
      BillModel(
        id: 'b2', billNo: 'B-2', billDate: '2026-09-15', customerId: 'c1',
        customerName: 'Rajesh', customerPhone: '9876500001',
        createdAt: '2026-09-15',
        lines: const [BillLineModel(id: 'l2', chargeName: 'Rent', amount: 500)],
      ),
    ];
    final ending = [
      const StorageBookingModel(
        id: 's1', bookingNo: 'SB-1', bookingDate: '2026-08-01',
        customerName: 'Suman', customerPhone: '9876500002',
        storageStartDate: '2026-08-01', expectedEndDate: '2026-10-01',
        createdAt: '2026-08-01',
      ),
    ];

    final calls = FollowUps.callsToday(
      quotations: quotations,
      overdueBills: bills,
      pastExpectedEnd: ending,
      today: today,
    );

    expect(calls.map((c) => c.reason), [
      FollowUpReason.quotation,
      FollowUpReason.quotation,
      FollowUpReason.payment,
      FollowUpReason.storageEnd,
    ]);
    final payment = calls[2];
    expect(payment.customerName, 'Rajesh');
    expect(payment.detail, 'Rs. 1500 overdue on 2 bills');
  });
}
