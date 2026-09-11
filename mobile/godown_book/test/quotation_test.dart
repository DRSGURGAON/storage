import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/customer/customer_lookup_service.dart';
import 'package:godown_book/core/utils/financial_year.dart';
import 'package:godown_book/features/company/controllers/company_controller.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/customers/repositories/customer_repository.dart';
import 'package:godown_book/features/master/models/charge_head_model.dart';
import 'package:godown_book/features/quotation/models/quotation_model.dart';
import 'package:godown_book/features/quotation/repositories/quotation_repository.dart';
import 'package:godown_book/features/quotation/services/quotation_pdf_service.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

QuotationModel draft({
  String name = 'Rajesh Kumar',
  String phone = '9876500001',
  String state = 'Haryana',
  double discount = 0,
  double gst = 0,
  List<QuotationLineModel> lines = const [],
}) {
  return QuotationModel(
    id: '',
    quotationDate: DateTime.now().toIso8601String(),
    customerName: name,
    customerPhone: phone,
    customerCity: 'Karnal',
    customerState: state,
    fromCity: 'Karnal',
    toCity: 'Pune',
    storageMonths: 3,
    discountValue: discount,
    gstPercent: gst,
    lines: lines,
    createdAt: '',
  );
}

QuotationLineModel line(
  String name,
  double rate, {
  double qty = 1,
  ChargeMode mode = ChargeMode.amount,
  bool taxable = true,
}) =>
    QuotationLineModel(
      id: '',
      serviceName: name,
      mode: mode,
      quantity: qty,
      rate: rate,
      amount: mode == ChargeMode.amount ? qty * rate : 0,
      taxable: taxable,
    );

void main() {
  late Database db;
  final repo = QuotationRepository.instance;

  setUp(() async {
    db = await openTestDatabase();
    CustomerLookupService.instance.invalidate();
  });

  tearDown(() async {
    await db.close();
  });

  test('starts from the company service list', () async {
    final lines = await repo.defaultLines();
    expect(lines.length, 10);
    expect(lines.first.serviceName, 'Storage Rent');
    expect(lines.every((l) => l.chargeHeadId.isNotEmpty), isTrue);
  });

  test('numbers quotations per financial year and links the customer', () async {
    final fy = FinancialYear.startYear(DateTime.now());
    final a = await repo.save(draft(lines: [line('Packing', 4000)]));
    final b = await repo.save(draft(name: 'Sunita Devi', phone: '9876500002'));

    expect(a.quotationNo, 'QT/$fy/0001');
    expect(b.quotationNo, 'QT/$fy/0002');
    expect(a.customerId, isNotEmpty);
    expect((await CustomerRepository.instance.getAll()).length, 2);
  });

  test('totals only count priced lines, after discount and tax', () async {
    final q = await repo.save(draft(
      discount: 500,
      gst: 18,
      lines: [
        line('Packing', 4000),
        line('Transport', 12000),
        line('Loading', 0, mode: ChargeMode.included),
        line('Storage Rent', 3500, qty: 3),
        line('Insurance', 2000, taxable: false),
      ],
    ));

    // 4000 + 12000 + 10500 + 2000; the Included line adds nothing.
    expect(q.subtotal, 28500);
    // Taxable base excludes the non-taxable insurance line, then the discount.
    expect(q.taxableBase, 26000);
    expect(q.gstAmount, closeTo(4680, 0.001));
    expect(q.grandTotal, closeTo(32680, 0.001));
  });

  test('same state splits CGST/SGST, another state carries IGST', () async {
    await CompanyController.instance.saveCompany(const CompanyModel(
      companyName: 'Test Movers',
      address: 'GT Road',
      city: 'Karnal',
      state: 'Haryana',
      mobile1: '9999999999',
    ));

    final within = await repo.save(draft(gst: 18, lines: [line('Packing', 1000)]));
    expect(within.cgstAmount, closeTo(90, 0.001));
    expect(within.sgstAmount, closeTo(90, 0.001));
    expect(within.igstAmount, 0);

    final outside = await repo.save(
      draft(
        name: 'Out of state',
        phone: '9876500003',
        state: 'Maharashtra',
        gst: 18,
        lines: [line('Packing', 1000)],
      ),
    );
    expect(outside.igstAmount, closeTo(180, 0.001));
    expect(outside.cgstAmount, 0);
  });

  test('editing keeps the number and replaces the lines', () async {
    final saved = await repo.save(draft(lines: [line('Packing', 4000)]));
    final edited = await repo.save(saved.copyWith(
      lines: [line('Packing', 5000), line('Transport', 9000)],
    ));

    expect(edited.quotationNo, saved.quotationNo);
    expect(edited.subtotal, 14000);
    expect((await repo.getById(saved.id))!.lines.length, 2);
  });

  test('status changes and delete', () async {
    final saved = await repo.save(draft());
    expect(saved.status, QuotationStatus.draft);

    await repo.setStatus(saved.id, QuotationStatus.accepted);
    expect((await repo.getById(saved.id))!.status, QuotationStatus.accepted);

    await repo.delete(saved.id);
    expect(await repo.getAll(), isEmpty);
    final rows = await db.query('quotation_lines');
    expect(rows, isEmpty);
  });

  test('renders a quotation PDF', () async {
    final q = await repo.save(draft(
      gst: 18,
      lines: [line('Packing', 4000), line('Loading', 0, mode: ChargeMode.included)],
    ));

    const company = CompanyModel(
      companyId: 'company-test',
      companyName: 'Test Movers',
      address: 'GT Road',
      city: 'Karnal',
      state: 'Haryana',
      mobile1: '9999999999',
      upiId1: 'testmovers@upi',
    );

    final bytes = await QuotationPdfService.instance.build(q, company, showWatermark: true);
    expect(bytes.length, greaterThan(1000));
    expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
  });
}
