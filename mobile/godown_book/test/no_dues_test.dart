import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/features/billing/repositories/billing_repository.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_booking_model.dart';
import 'package:godown_book/features/storage_booking/models/storage_status.dart';
import 'package:godown_book/features/storage_booking/services/no_dues_check.dart';
import 'package:godown_book/features/storage_booking/services/no_dues_pdf_service.dart';

/// A no-dues certificate that is not true is worse than none, so the
/// check that gates it is tested on its own.
void main() {
  const company = CompanyModel(
    companyId: 'company-test',
    companyName: 'Test Movers',
    address: 'GT Road',
    city: 'Karnal',
    state: 'Haryana',
    mobile1: '9999999999',
  );

  StorageBookingModel record(StorageStatus status) => StorageBookingModel(
        id: 'b1',
        bookingNo: 'SR/2026/0007',
        bookingDate: '2026-09-01T00:00:00',
        customerId: 'c1',
        customerName: 'Rajesh Kumar',
        customerPhone: '9876500001',
        storageStartDate: '2026-09-01T00:00:00',
        actualEndDate: '2026-11-30T00:00:00',
        securityDeposit: 5000,
        status: status,
        createdAt: '',
      );

  CustomerBalance balance({double billed = 10000, double received = 10000, double credited = 0}) =>
      CustomerBalance(
        customerId: 'c1',
        customerName: 'Rajesh Kumar',
        billed: billed,
        received: received,
        credited: credited,
      );

  test('is clear only when goods are out, bills paid and deposit settled', () {
    final clear = NoDuesCheck(
      booking: record(StorageStatus.released),
      balance: balance(),
      deposit: const DepositSummary(agreed: 5000, received: 5000, returned: 5000),
    );
    expect(clear.isClear, isTrue);

    final stillInside = NoDuesCheck(
      booking: record(StorageStatus.partiallyReleased),
      balance: balance(),
      deposit: const DepositSummary(),
    );
    expect(stillInside.blockers, ['Goods are still in the godown - release them first']);

    final owes = NoDuesCheck(
      booking: record(StorageStatus.released),
      balance: balance(received: 7500, credited: 500),
      deposit: const DepositSummary(received: 5000, adjusted: 2000),
    );
    expect(owes.blockers, [
      '₹2000 is still outstanding',
      'Security deposit of ₹3000 is still held - return or adjust it first',
    ]);

    final cancelled = NoDuesCheck(
      booking: record(StorageStatus.cancelled),
      balance: balance(billed: 0, received: 0),
      deposit: const DepositSummary(),
    );
    expect(cancelled.isClear, isFalse);
  });

  test('the certificate renders for each way the account was settled', () async {
    for (final deposit in const [
      DepositSummary(),
      DepositSummary(received: 5000, returned: 5000),
      DepositSummary(received: 5000, adjusted: 5000),
      DepositSummary(received: 5000, returned: 3000, adjusted: 2000),
    ]) {
      final bytes = await NoDuesPdfService.instance.build(
        record(StorageStatus.released),
        company,
        balance: balance(received: 9500, credited: 500),
        deposit: deposit,
        collectedOn: '2026-11-30T00:00:00',
      );
      expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
      expect(bytes.length, greaterThan(1000));
    }

    // Nothing billed at all is still a valid certificate.
    final bytes = await NoDuesPdfService.instance.build(
      record(StorageStatus.released),
      null,
      balance: balance(billed: 0, received: 0),
      deposit: const DepositSummary(),
    );
    expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
  });
}
