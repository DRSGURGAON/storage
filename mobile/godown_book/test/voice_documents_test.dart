import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/features/billing/models/payment_model.dart';
import 'package:godown_book/features/voice_entry/services/voice_bill_parser.dart';
import 'package:godown_book/features/voice_entry/services/voice_payment_parser.dart';
import 'package:godown_book/features/voice_entry/services/voice_quotation_parser.dart';

/// The bill, the payment receipt and the quotation can all be spoken.
/// None of this touches a microphone, a network or a model, so every
/// case here runs the same code the phone runs.
void main() {
  final today = DateTime(2026, 9, 12);

  group('payment', () {
    final parser = VoicePaymentParser(today: today);

    test('cash taken today', () {
      final draft = parser.parse('Rajesh Kumar se paanch hazaar cash mile aaj');
      expect(draft.payerName, 'Rajesh Kumar');
      expect(draft.amount, 5000);
      expect(draft.mode, PaymentMode.cash);
      expect(draft.paymentDate, DateTime(2026, 9, 12));
    });

    test('UPI with a reference', () {
      final draft =
          parser.parse('Suresh ne das hazaar UPI se diye reference 445566');
      expect(draft.payerName, 'Suresh');
      expect(draft.amount, 10000);
      expect(draft.mode, PaymentMode.upi);
      expect(draft.reference, '445566');
    });

    test('an advance is not an ordinary payment', () {
      final draft = parser.parse('Kavita se do hazaar advance liya');
      expect(draft.amount, 2000);
      expect(draft.type, PaymentType.advance);
    });

    test('a deposit going back out', () {
      final draft =
          parser.parse('security deposit paanch hazaar wapas kar diya');
      expect(draft.amount, 5000);
      expect(draft.type, PaymentType.depositRefund);
    });

    test('a deposit coming in', () {
      final draft = parser.parse('Mohan se das hazaar security deposit liya');
      expect(draft.amount, 10000);
      expect(draft.type, PaymentType.securityDeposit);
      expect(draft.payerName, 'Mohan');
    });

    test('a mobile number is not read as the amount', () {
      final draft = parser.parse('Anil 9876500001 se teen hazaar cash');
      expect(draft.payerPhone, '9876500001');
      expect(draft.amount, 3000);
    });

    test('nothing understood fills nothing', () {
      final draft = parser.parse('haan theek hai');
      expect(draft.amount, isNull);
      expect(draft.mode, isNull);
    });
  });

  group('bill', () {
    final parser = VoiceBillParser(today: today);

    test('a period, two charges and the GST', () {
      final draft = parser.parse(
        'Rajesh Kumar ek October se atharah October tak storage teen hazaar '
        'mazdoori paanch sau GST atharah percent',
      );

      expect(draft.customerName, 'Rajesh Kumar');
      expect(draft.periodFrom, DateTime(2026, 10, 1));
      expect(draft.periodTo, DateTime(2026, 10, 18));
      expect(draft.gstPercent, 18);
      expect(
        draft.charges.map((c) => '${c.name} ${c.amount.toInt()}'),
        containsAll(['Storage Charge 3000', 'Labour 500']),
      );
    });

    test('the dates come back in order however they were said', () {
      final draft =
          parser.parse('atharah October se ek October tak packing do hazaar');
      expect(draft.periodFrom, DateTime(2026, 10, 1));
      expect(draft.periodTo, DateTime(2026, 10, 18));
    });

    test('a discount is kept apart from the charges', () {
      final draft = parser.parse(
          'transport paanch hazaar discount paanch sau');
      expect(draft.discount, 500);
      expect(draft.charges.single.name, 'Transport');
      expect(draft.charges.single.amount, 5000);
    });

    test('the same head said twice is one line', () {
      final draft = parser.parse('labour do hazaar aur mazdoori ek hazaar');
      expect(draft.charges, hasLength(1));
      expect(draft.charges.single.amount, 3000);
    });
  });

  group('quotation', () {
    final parser = VoiceQuotationParser(today: today);

    test('a whole move priced in one breath', () {
      final draft = parser.parse(
        'Anil Sharma 9812345678 Gurgaon se Jaipur packing das hazaar '
        'transport pandrah hazaar teen mahine storage GST atharah percent',
      );

      expect(draft.customerName, 'Anil Sharma');
      expect(draft.customerPhone, '9812345678');
      expect(draft.fromCity, 'Gurgaon');
      expect(draft.toCity, 'Jaipur');
      expect(draft.storageMonths, 3);
      expect(draft.gstPercent, 18);
      expect(
        draft.services.map((s) => '${s.name} ${s.amount.toInt()}'),
        containsAll(['Packing 10000', 'Transport 15000']),
      );
    });

    test('the move date', () {
      final draft =
          parser.parse('Delhi se Mumbai shifting das October ko loading '
              'do hazaar');
      expect(draft.fromCity, 'Delhi');
      expect(draft.toCity, 'Mumbai');
      expect(draft.moveDate, DateTime(2026, 10, 10));
      expect(draft.services.single.name, 'Loading');
    });

    test('a route is not invented out of an ordinary sentence', () {
      final draft = parser.parse('packing das hazaar');
      expect(draft.fromCity, isNull);
      expect(draft.toCity, isNull);
      expect(draft.services.single.amount, 10000);
    });

    test('the review list names what it heard', () {
      final draft = parser.parse('Delhi se Jaipur transport das hazaar');
      expect(draft.fields.map((f) => f.label),
          containsAll(['Moving from', 'Moving to', 'Services']));
    });
  });
}
