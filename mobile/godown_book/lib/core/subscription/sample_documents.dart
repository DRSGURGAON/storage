import 'dart:typed_data';

import '../../features/billing/models/bill_model.dart';
import '../../features/billing/models/payment_model.dart';
import '../../features/billing/repositories/billing_repository.dart';
import '../../features/billing/services/bill_pdf_service.dart';
import '../../features/billing/services/payment_receipt_pdf_service.dart';
import '../../features/billing/services/statement_pdf_service.dart';
import '../../features/company/models/company_model.dart';
import '../../features/consignment/models/consignment_model.dart';
import '../../features/consignment/services/consignment_pdf_service.dart';
import '../../features/customers/models/customer_model.dart';
import '../../features/incidents/models/incident_model.dart';
import '../../features/incidents/services/incident_pdf_service.dart';
import '../../features/notices/models/notice_model.dart';
import '../../features/notices/services/notice_pdf_service.dart';
import '../../features/quotation/models/quotation_model.dart';
import '../../features/quotation/services/quotation_pdf_service.dart';
import '../../features/release/models/goods_release_model.dart';
import '../../features/release/services/release_pdf_service.dart';
import '../../features/storage_booking/models/booking_item_model.dart';
import '../../features/storage_booking/models/storage_booking_model.dart';
import '../../features/storage_booking/models/storage_status.dart';
import '../../features/storage_booking/services/authority_letter_pdf_service.dart';
import '../../features/storage_booking/services/goods_list_pdf_service.dart';
import '../../features/storage_booking/services/storage_agreement_pdf_service.dart';
import '../../features/storage_booking/services/storage_receipt_pdf_service.dart';
import '../../features/master/models/charge_head_model.dart';
import 'document_type.dart';

/// Sample documents, so somebody can see exactly what they are paying
/// for before they pay.
///
/// Everything here is made up in memory and thrown away: no sample is
/// ever saved, no real customer, storage record, bill or payment is
/// touched, and no free copy is consumed. Every sample is marked SAMPLE
/// across the page, so one can never be passed off as a real document.
class SampleDocuments {
  SampleDocuments._();

  static const String watermark = 'SAMPLE';

  static final DateTime _from = DateTime(2026, 9, 1);
  static final DateTime _to = DateTime(2026, 9, 30);

  /// The letterhead a sample prints on - the real company when it is
  /// set up (so the sample looks like their own paper), a made-up firm
  /// otherwise.
  static CompanyModel company(CompanyModel? real) {
    if (real != null && real.isConfigured) return real;

    return const CompanyModel(
      companyId: 'sample',
      companyName: 'Your Firm Name',
      tagLine: 'Packers, Movers & Household Storage',
      address: 'Your godown address',
      city: 'Your City',
      state: 'Your State',
      pincode: '000000',
      mobile1: '90000 00000',
      email: 'you@example.com',
      upiId1: 'yourfirm@upi',
    );
  }

  static const CustomerModel _customer = CustomerModel(
    id: 'sample-customer',
    customerName: 'Rajesh Kumar (sample)',
    mobileNumber: '98XXXXXXXX',
    address: 'B-42, Sector 9',
    city: 'Karnal',
    state: 'Haryana',
    pincode: '132001',
    createdAt: '2026-09-01T00:00:00.000',
  );

  static StorageBookingModel get _booking => StorageBookingModel(
        id: 'sample-storage',
        bookingNo: 'SR/2026/0001',
        bookingDate: _from.toIso8601String(),
        customerId: _customer.id,
        customerName: _customer.customerName,
        customerPhone: _customer.mobileNumber,
        customerAddress: _customer.address,
        customerCity: _customer.city,
        customerState: _customer.state,
        customerPincode: _customer.pincode,
        customerIdProof: 'Aadhaar XXXX XXXX 1234',
        locationName: 'Hall A - Section 2',
        storageStartDate: _from.toIso8601String(),
        rentBasis: RentBasis.monthly,
        rentRate: 3500,
        securityDeposit: 5000,
        totalPackages: 42,
        goodsDescription: '2 BHK household goods, packed in cartons',
        declaredValue: 250000,
        vehicleNumber: 'HR05AB1234',
        driverName: 'Suresh',
        receivedBy: 'Godown staff',
        createdAt: _from.toIso8601String(),
        items: const [
          BookingItemModel(
            id: 's1',
            bookingId: 'sample-storage',
            itemName: 'Sofa set',
            description: '3 + 1 + 1, wrapped',
            quantity: 1,
            unit: 'Set',
            conditionNote: 'Good',
          ),
          BookingItemModel(
            id: 's2',
            bookingId: 'sample-storage',
            itemName: 'Double bed with mattress',
            quantity: 1,
            unit: 'Nos',
          ),
          BookingItemModel(
            id: 's3',
            bookingId: 'sample-storage',
            itemName: 'Refrigerator',
            quantity: 1,
            unit: 'Nos',
            conditionNote: 'Minor scratch on door',
          ),
          BookingItemModel(
            id: 's4',
            bookingId: 'sample-storage',
            itemName: 'Cartons (kitchen, clothes, books)',
            quantity: 39,
            unit: 'Nos',
            releasedQty: 4,
          ),
        ],
      );

  static QuotationModel get _quotation => QuotationModel(
        id: 'sample-quotation',
        quotationNo: 'QT/2026/0001',
        quotationDate: _from.toIso8601String(),
        validUpto: _from.add(const Duration(days: 15)).toIso8601String(),
        customerId: _customer.id,
        customerName: _customer.customerName,
        customerPhone: _customer.mobileNumber,
        customerAddress: _customer.address,
        customerCity: _customer.city,
        customerState: _customer.state,
        fromCity: 'Karnal',
        toCity: 'Pune',
        storageMonths: 3,
        storageNote: 'Rent Rs. 3,500 per month after the free first week',
        goodsDescription: '2 BHK household goods, approx 42 cartons',
        status: QuotationStatus.sent,
        gstPercent: 18,
        cgstAmount: 2070,
        sgstAmount: 2070,
        createdAt: _from.toIso8601String(),
        lines: const [
          QuotationLineModel(
            id: 'q1',
            serviceName: 'Packing',
            description: 'Material and labour',
            rate: 6000,
            amount: 6000,
          ),
          QuotationLineModel(
            id: 'q2',
            serviceName: 'Loading',
            mode: ChargeMode.included,
          ),
          QuotationLineModel(
            id: 'q3',
            serviceName: 'Transportation',
            description: 'Karnal to Pune, dedicated vehicle',
            rate: 12000,
            amount: 12000,
          ),
          QuotationLineModel(
            id: 'q4',
            serviceName: 'Storage Rent',
            description: '3 months at Rs. 3,500 per month',
            quantity: 3,
            rate: 3500,
            amount: 10500,
          ),
          QuotationLineModel(
            id: 'q5',
            serviceName: 'Unloading at delivery',
            mode: ChargeMode.excluded,
          ),
          QuotationLineModel(
            id: 'q6',
            serviceName: 'Insurance',
            description: 'Optional, at actuals',
            mode: ChargeMode.notApplicable,
            taxable: false,
          ),
        ],
      );

  static BillModel get _bill => BillModel(
        id: 'sample-bill',
        billNo: 'INV/2026/0001',
        billDate: _to.toIso8601String(),
        bookingId: 'sample-storage',
        bookingNo: 'SR/2026/0001',
        customerId: _customer.id,
        customerName: _customer.customerName,
        customerPhone: _customer.mobileNumber,
        customerAddress: _customer.address,
        customerCity: _customer.city,
        customerState: _customer.state,
        periodFrom: '2026-09-01',
        periodTo: '2026-09-30',
        dueDate: '2026-10-07',
        gstPercent: 18,
        cgstAmount: 360,
        sgstAmount: 360,
        amountPaid: 1000,
        status: BillStatus.partlyPaid,
        createdAt: _to.toIso8601String(),
        lines: const [
          BillLineModel(
            id: 'b1',
            chargeName: 'Storage Charge',
            description:
                '01 Sep 2026 to 30 Sep 2026 - 1 month at Rs. 3500.00 per month',
            rate: 3500,
            amount: 3500,
          ),
          BillLineModel(
            id: 'b2',
            chargeName: 'Handling',
            description: 'Shifting within the godown',
            rate: 500,
            amount: 500,
          ),
        ],
      );

  static PaymentModel get _payment => PaymentModel(
        id: 'sample-payment',
        receiptNo: 'MR/2026/0001',
        billId: 'sample-bill',
        customerId: _customer.id,
        payerName: _customer.customerName,
        payerPhone: _customer.mobileNumber,
        amount: 1000,
        mode: PaymentMode.upi,
        paymentType: PaymentType.partPayment,
        paymentDate: '2026-10-02T00:00:00.000',
        referenceNo: 'UPI 4231XXXX9087',
        createdAt: '2026-10-02T00:00:00.000',
      );

  static GoodsReleaseModel get _release => GoodsReleaseModel(
        id: 'sample-release',
        releaseNo: 'RL/2026/0001',
        releaseDate: '2026-10-06T00:00:00.000',
        bookingId: 'sample-storage',
        bookingNo: 'SR/2026/0001',
        customerName: _customer.customerName,
        customerPhone: _customer.mobileNumber,
        collectedByName: _customer.customerName,
        collectedByPhone: _customer.mobileNumber,
        collectedByIdProof: 'Aadhaar XXXX XXXX 1234',
        vehicleNumber: 'HR05AB1234',
        driverName: 'Suresh',
        gateOutTime: '11:20 AM',
        outstandingAtRelease: 3220,
        createdAt: '2026-10-06T00:00:00.000',
        items: const [
          ReleaseItemModel(
            id: 'r1',
            bookingItemId: 's4',
            itemName: 'Cartons (kitchen, clothes, books)',
            quantity: 4,
          ),
        ],
      );

  static List<StatementEntry> get _statement => const [
        StatementEntry(
          date: '2026-09-30T00:00:00.000',
          reference: 'INV/2026/0001',
          particulars: 'Storage bill for 01 Sep 2026 to 30 Sep 2026',
          debit: 4720,
          runningBalance: 4720,
        ),
        StatementEntry(
          date: '2026-10-02T00:00:00.000',
          reference: 'MR/2026/0001',
          particulars: 'Payment received (UPI)',
          credit: 1000,
          runningBalance: 3720,
        ),
        StatementEntry(
          date: '2026-10-31T00:00:00.000',
          reference: 'INV/2026/0002',
          particulars: 'Storage bill for 01 Oct 2026 to 31 Oct 2026',
          debit: 4130,
          runningBalance: 7850,
        ),
      ];

  static final NoticeModel _notice = NoticeModel(
    id: 'sample-notice',
    noticeNo: 'NT/2026/0001',
    noticeDate: DateTime(2026, 11, 5).toIso8601String(),
    kind: NoticeKind.finalNotice,
    customerName: _customer.customerName,
    customerPhone: _customer.mobileNumber,
    customerAddress:
        '${_customer.address}, ${_customer.city}, ${_customer.state}',
    bookingNo: 'SR/2026/0001',
    amountDue: 7850,
    dueAsOn: DateTime(2026, 11, 5).toIso8601String(),
    payByDate: DateTime(2026, 11, 20).toIso8601String(),
    createdAt: '',
  );

  static final IncidentModel _incident = IncidentModel(
    id: 'sample-incident',
    reportNo: 'DR/2026/0001',
    reportDate: DateTime(2026, 10, 12).toIso8601String(),
    kind: IncidentKind.water,
    bookingNo: 'SR/2026/0001',
    customerName: _customer.customerName,
    customerPhone: _customer.mobileNumber,
    happenedOn: DateTime(2026, 10, 11).toIso8601String(),
    place: 'Hall A - Section 2',
    goodsAffected: 'Two cartons of books, one mattress',
    whatHappened:
        'Rain came in through a gap in the roof sheet overnight. The bottom '
        'row of cartons on the north wall was found wet in the morning.',
    actionTaken:
        'Goods moved to a dry rack, cartons opened and aired, roof sheet '
        'repaired the same day. Photographs taken before moving anything.',
    estimatedLoss: 4000,
    customerInformed: true,
    reportedBy: 'Godown supervisor',
    createdAt: '',
  );

  static final ConsignmentModel _consignment = ConsignmentModel(
    id: 'sample-bilty',
    lrNo: 'LR/2026/0001',
    lrDate: DateTime(2026, 9, 1).toIso8601String(),
    challanNo: 'DC/2026/0001',
    challanDate: DateTime(2026, 9, 1).toIso8601String(),
    bookingNo: 'SR/2026/0001',
    consignorName: _customer.customerName,
    consignorPhone: _customer.mobileNumber,
    consignorAddress:
        '${_customer.address}, ${_customer.city}, ${_customer.state}',
    consigneeName: _customer.customerName,
    consigneePhone: _customer.mobileNumber,
    consigneeAddress: 'Flat 704, Green Residency, Pune, Maharashtra',
    fromPlace: 'Karnal',
    toPlace: 'Pune',
    vehicleNumber: 'HR 45 A 1234',
    driverName: 'Balwinder Singh',
    driverPhone: '90000 00002',
    driverLicence: 'HR-0620110012345',
    goodsDescription: 'Household goods of a 3 BHK house, packed by the sender',
    packages: 42,
    weight: '1.8 ton',
    declaredValue: 250000,
    freightBasis: FreightBasis.toPay,
    freightAmount: 24000,
    otherCharges: 2500,
    advancePaid: 5000,
    riskBasis: RiskBasis.owner,
    createdAt: '',
    items: const [
      ConsignmentItemModel(
          id: 'sample-c1', itemName: 'Sofa set', quantity: 1, unit: 'Set'),
      ConsignmentItemModel(
          id: 'sample-c2',
          itemName: 'Double bed with mattress',
          quantity: 1,
          conditionNote: 'Minor scratch on headboard'),
      ConsignmentItemModel(
          id: 'sample-c3', itemName: 'Refrigerator', quantity: 1),
      ConsignmentItemModel(
          id: 'sample-c4',
          itemName: 'Cartons (kitchen, clothes, books)',
          quantity: 39),
    ],
  );

  /// True when a sample exists for [documentType].
  static bool has(String documentType) => const {
        DocumentType.quotation,
        DocumentType.storageAgreement,
        DocumentType.storageReceipt,
        DocumentType.itemList,
        DocumentType.bill,
        DocumentType.moneyReceipt,
        DocumentType.statement,
        DocumentType.releaseRecord,
        DocumentType.lorryReceipt,
        DocumentType.forwardingNote,
        DocumentType.deliveryChallan,
        DocumentType.notice,
        DocumentType.incidentReport,
        DocumentType.authorityLetter,
        DocumentType.indemnityBond,
      }.contains(documentType);

  /// Builds the sample for [documentType] on [real]'s letterhead.
  /// Nothing is read from or written to the database.
  static Future<Uint8List> build(String documentType, CompanyModel? real) {
    final letterhead = company(real);

    switch (documentType) {
      case DocumentType.quotation:
        return QuotationPdfService.instance.build(
          _quotation,
          letterhead,
          showWatermark: true,
          watermarkText: watermark,
          watermarkOpacity: 0.08,
        );
      case DocumentType.storageAgreement:
        return StorageAgreementPdfService.instance.build(
          _booking,
          letterhead,
          showWatermark: true,
          watermarkText: watermark,
          watermarkOpacity: 0.08,
        );
      case DocumentType.itemList:
        return GoodsListPdfService.instance.build(
          _booking,
          letterhead,
          showWatermark: true,
          watermarkText: watermark,
          watermarkOpacity: 0.08,
        );
      case DocumentType.bill:
        return BillPdfService.instance.build(
          _bill,
          letterhead,
          showWatermark: true,
          watermarkText: watermark,
          watermarkOpacity: 0.08,
          previousBalance: 0,
        );
      case DocumentType.moneyReceipt:
        return PaymentReceiptPdfService.instance.build(
          _payment,
          letterhead,
          bill: _bill,
          showWatermark: true,
          watermarkText: watermark,
          watermarkOpacity: 0.08,
          balanceAfter: 3720,
        );
      case DocumentType.statement:
        return StatementPdfService.instance.build(
          customer: _customer,
          entries: _statement,
          openingBalance: 0,
          company: letterhead,
          showWatermark: true,
          watermarkText: watermark,
          watermarkOpacity: 0.08,
        );
      case DocumentType.releaseRecord:
        return ReleasePdfService.instance.build(
          _release,
          letterhead,
          showWatermark: true,
          watermarkText: watermark,
          watermarkOpacity: 0.08,
          copies: const ['CUSTOMER COPY'],
        );
      case DocumentType.lorryReceipt:
      case DocumentType.forwardingNote:
      case DocumentType.deliveryChallan:
        return ConsignmentPdfService.instance.build(
          _consignment,
          letterhead,
          paper: switch (documentType) {
            DocumentType.forwardingNote => BiltyPaper.forwardingNote,
            DocumentType.deliveryChallan => BiltyPaper.deliveryChallan,
            _ => BiltyPaper.lorryReceipt,
          },
          copies: const ['CONSIGNOR COPY'],
          showWatermark: true,
          watermarkText: watermark,
          watermarkOpacity: 0.08,
        );
      case DocumentType.notice:
        return NoticePdfService.instance.build(
          _notice,
          letterhead,
          showWatermark: true,
          watermarkText: watermark,
          watermarkOpacity: 0.08,
        );
      case DocumentType.incidentReport:
        return IncidentPdfService.instance.build(
          _incident,
          letterhead,
          showWatermark: true,
          watermarkText: watermark,
          watermarkOpacity: 0.08,
        );
      case DocumentType.authorityLetter:
      case DocumentType.indemnityBond:
        return AuthorityLetterPdfService.instance.build(
          _booking,
          letterhead,
          paper: documentType == DocumentType.authorityLetter
              ? HandoverPaper.authority
              : HandoverPaper.indemnity,
          details: const HandoverDetails(
            personName: 'Suresh Kumar',
            personPhone: '90000 00001',
            personIdProof: 'Aadhaar XXXX 1234',
            relation: 'Brother',
          ),
          showWatermark: true,
          watermarkText: watermark,
          watermarkOpacity: 0.08,
        );
      case DocumentType.storageReceipt:
      default:
        return StorageReceiptPdfService.instance.build(
          _booking,
          letterhead,
          showWatermark: true,
          watermarkText: watermark,
          watermarkOpacity: 0.08,
          copies: const ['CUSTOMER COPY'],
        );
    }
  }
}
