import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/features/storage_booking/models/storage_status.dart';
import 'package:godown_book/features/voice_entry/services/voice_entry_parser.dart';

/// The voice entry has to work in a godown with no signal, so the whole
/// parser is plain Dart and every case below is exercised without a
/// microphone, a network call or a model.
void main() {
  final parser = VoiceEntryParser(today: DateTime(2026, 9, 12));

  group('numbers the way people say them', () {
    double? amount(String said) =>
        VoiceEntryParser(today: DateTime(2026, 9, 12))
            .parse('kiraya $said rupaye')
            .rentRate;

    test('plain words', () => expect(amount('teen hazaar'), 3000));
    test('digits', () => expect(amount('3000'), 3000));
    test('hundreds', () => expect(amount('pandrah sau'), 1500));
    test('a half in front', () => expect(amount('sadhe teen hazaar'), 3500));
    test('dedh is one and a half', () => expect(amount('dedh hazaar'), 1500));
    test('dhai is two and a half', () => expect(amount('dhai hazaar'), 2500));
    test('a quarter in front', () => expect(amount('sawa do hazaar'), 2250));
    test('a quarter short', () => expect(amount('paune do hazaar'), 1750));
    test('lakhs', () => expect(amount('ek lakh bees hazaar'), 120000));
    test('mixed', () => expect(amount('teen hazaar paanch sau'), 3500));
    test('Devanagari', () => expect(amount('तीन हजार'), 3000));
  });

  test('a whole entry said in one breath', () {
    final draft = parser.parse(
      'Rajesh Kumar 9876500001 das October se ek almari do palang '
      'teen carton mahine ka teen hazaar paanch hazaar advance',
    );

    expect(draft.customerName, 'Rajesh Kumar');
    expect(draft.customerPhone, '9876500001');
    expect(draft.storageStart, DateTime(2026, 10, 10));
    expect(draft.rentRate, 3000);
    expect(draft.rentBasis, RentBasis.monthly);
    expect(draft.securityDeposit, 5000);

    expect(draft.items.map((i) => '${i.itemName} x${i.quantity.toInt()}'), [
      'Almirah x1',
      'Bed x2',
      'Carton x3',
    ]);
    expect(draft.totalPackages, 6);
    expect(draft.items.last.unit, 'Cartons');
  });

  test('the same thing said in Hindi', () {
    final draft = parser.parse(
      'नाम सुनीता देवी मोबाइल 9812345678 दो अलमारी पांच पेटी '
      'किराया दो हजार महीने का',
    );

    expect(draft.customerName, 'सुनीता देवी');
    expect(draft.customerPhone, '9812345678');
    expect(draft.rentRate, 2000);
    expect(draft.rentBasis, RentBasis.monthly);
    expect(draft.items.map((i) => i.itemName), ['Almirah', 'Carton']);
    expect(draft.items.first.quantity, 2);
    expect(draft.items.last.quantity, 5);
  });

  test('a mobile number spoken digit by digit', () {
    final draft = parser.parse(
      'Suresh nau aath saat chhe paanch zero zero zero zero ek',
    );
    expect(draft.customerPhone, '9876500001');
    expect(draft.customerName, 'Suresh');
  });

  test('a daily rate is not read as a monthly one', () {
    final draft = parser.parse('Amit sau rupaye roz ka kiraya');
    expect(draft.rentRate, 100);
    expect(draft.rentBasis, RentBasis.daily);
  });

  test('a duration is not mistaken for a rent', () {
    final draft = parser.parse('Rakesh das mahine ke liye do carton');
    expect(draft.rentRate, isNull);
    expect(draft.items.single.quantity, 2);
  });

  test('the vehicle it came on', () {
    final draft = parser.parse('Mohan gaadi HR 26 AB 1234 char carton');
    expect(draft.vehicleNumber, 'HR26AB1234');
    expect(draft.items.single.quantity, 4);
    expect(draft.customerName, 'Mohan');
  });

  test('the declared value and the security deposit are kept apart', () {
    final draft = parser.parse(
      'Kavita do almari value do lakh security das hazaar',
    );
    expect(draft.declaredValue, 200000);
    expect(draft.securityDeposit, 10000);
  });

  test('the same item said twice becomes one line', () {
    final draft = parser.parse('do carton aur teen carton');
    expect(draft.items, hasLength(1));
    expect(draft.items.single.quantity, 5);
  });

  test('a two word item stays one item', () {
    final draft = parser.parse('ek washing machine do dressing table');
    expect(draft.items.map((i) => i.itemName),
        ['Washing Machine', 'Dressing Table']);
    expect(draft.items.last.quantity, 2);
  });

  test('aaj means today', () {
    final draft = parser.parse('Vinod aaj se do bori');
    expect(draft.storageStart, DateTime(2026, 9, 12));
  });

  test('a title in front of the name is dropped', () {
    final draft = parser.parse('customer ka naam Anil Sharma hai');
    expect(draft.customerName, 'Anil Sharma');
  });

  test('nothing understood leaves every field alone', () {
    final draft = parser.parse('hmm haan theek hai');
    expect(draft.isEmpty || draft.fields.length <= 1, isTrue);
    expect(draft.rentRate, isNull);
    expect(draft.items, isEmpty);
  });

  test('the review list names what it heard', () {
    final draft = parser.parse('Rajesh kiraya teen hazaar mahine ka');
    expect(draft.fields.map((f) => f.label),
        containsAll(['Customer name', 'Rent']));
    expect(draft.fields.firstWhere((f) => f.label == 'Rent').display,
        contains('3,000'));
  });
}
