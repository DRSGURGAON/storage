import '../../../core/utils/id_generator.dart';
import '../../storage_booking/models/booking_item_model.dart';
import '../../storage_booking/models/storage_status.dart';
import '../models/goods_vocabulary.dart';
import '../models/spoken_numbers.dart';
import '../models/voice_entry_draft.dart';
import '../models/voice_reading.dart';
import 'spoken_text.dart';
import 'voice_keywords.dart';

/// Turns one spoken sentence into the fields of a storage entry.
///
///     "Rajesh Kumar, 9876500001, das October se, ek almari do palang
///      teen carton, mahine ka teen hazaar, paanch hazaar advance"
///
/// This runs entirely on the phone - a vocabulary and a set of anchors,
/// not a model - which is what makes it free, offline and private. What
/// it cannot work out, it leaves alone for the operator to type.
class VoiceEntryParser {
  final DateTime today;
  final String bookingId;

  VoiceEntryParser({DateTime? today, String? bookingId})
      : today = today ?? DateTime.now(),
        bookingId = bookingId ?? '';

  static const _nameStops = {
    ...VoiceKeywords.rent,
    ...VoiceKeywords.daily,
    ...VoiceKeywords.perBox,
    ...VoiceKeywords.deposit,
    ...VoiceKeywords.declaredValue,
    ...SpokenText.phoneWords,
    ...VoiceKeywords.city,
    ...SpokenText.vehicleWords,
    ...SpokenText.pincodeWords,
    ...SpokenText.dateWords,
    ...SpokenText.todayWords,
  };

  VoiceEntryDraft parse(String transcript) {
    final said = SpokenText(transcript);
    if (said.isEmpty) return VoiceEntryDraft(transcript: said.transcript);

    final vehicle = said.vehicle();
    final phone = said.mobile();
    final pincode = said.pincode();
    final date = said.nextDate(today);
    final items = _readItems(said);
    final rent = _readRent(said);
    final deposit = said.keyedAmount(VoiceKeywords.deposit);
    final value = said.keyedAmount(VoiceKeywords.declaredValue);
    final city = said.wordAfter(VoiceKeywords.city);
    final name = said.name(stops: _nameStops);

    final fields = <VoiceField>[];
    void add(VoiceFieldKind kind, String label, String display) =>
        fields.add(VoiceField(kind: kind, label: label, display: display));

    if (name != null) add(VoiceFieldKind.customerName, 'Customer name', name);
    if (phone != null) add(VoiceFieldKind.customerPhone, 'Mobile', phone);
    if (city != null) add(VoiceFieldKind.customerCity, 'City', city);
    if (pincode != null) add(VoiceFieldKind.customerPincode, 'Pincode', pincode);
    if (date != null) {
      add(VoiceFieldKind.storageStart, 'Storage from', VoiceFormat.date(date));
    }
    if (items.isNotEmpty) {
      add(
        VoiceFieldKind.items,
        'Goods',
        items
            .map((i) => '${VoiceFormat.qty(i.quantity)} ${i.itemName}')
            .join(',  '),
      );
    }
    if (rent != null) {
      add(VoiceFieldKind.rent, 'Rent',
          '${VoiceFormat.rupees(rent.amount)} ${rent.basis.rateHint}');
    }
    if (deposit != null) {
      add(VoiceFieldKind.securityDeposit, 'Deposit / advance',
          VoiceFormat.rupees(deposit));
    }
    if (value != null) {
      add(VoiceFieldKind.declaredValue, 'Declared value',
          VoiceFormat.rupees(value));
    }
    if (vehicle != null) {
      add(VoiceFieldKind.vehicleNumber, 'Vehicle no.', vehicle);
    }

    return VoiceEntryDraft(
      transcript: said.transcript,
      customerName: name,
      customerPhone: phone,
      customerCity: city,
      customerPincode: pincode,
      storageStart: date,
      items: items,
      rentRate: rent?.amount,
      rentBasis: rent?.basis,
      securityDeposit: deposit,
      declaredValue: value,
      vehicleNumber: vehicle,
      fields: fields,
    );
  }

  // ---------------------------------------------------------------- goods

  List<BookingItemModel> _readItems(SpokenText said) {
    final words = said.words;
    final items = <BookingItemModel>[];

    for (var i = 0; i < words.length; i++) {
      if (said.isUsed(i)) continue;

      GoodsTerm? term;
      var span = 1;
      if (i + 1 < words.length && !said.isUsed(i + 1)) {
        term = GoodsVocabulary.lookupPhrase(words[i], words[i + 1]);
        if (term != null) span = 2;
      }
      term ??= GoodsVocabulary.lookup(words[i]);
      if (term == null) continue;

      // "do palang" reads backwards; "carton 42" reads forwards.
      double quantity = 1;
      var claimedFrom = i;
      SpokenNumber? count;
      for (var back = i - 1; back >= 0 && back >= i - 3; back--) {
        if (said.isUsed(back)) break;
        final read = SpokenText.readNumber(words, back);
        if (read != null && read.end >= i - 1) {
          count = read;
          break;
        }
        if (!SpokenText.noise.contains(words[back])) break;
      }
      count ??= (i + span < words.length && !said.isUsed(i + span))
          ? SpokenText.readNumber(words, i + span)
          : null;

      if (count != null && count.value > 0) {
        quantity = count.value;
        if (count.start < claimedFrom) claimedFrom = count.start;
        said.claim(count.start, count.end);
      }

      said.claim(claimedFrom, i + span);
      items.add(BookingItemModel(
        id: IdGenerator.generateId(),
        bookingId: bookingId,
        sortOrder: items.length,
        itemName: term.name,
        quantity: quantity,
        unit: term.unit,
      ));
    }

    // The same thing said twice is one line with the counts added.
    final merged = <String, BookingItemModel>{};
    for (final item in items) {
      final key = '${item.itemName}|${item.unit}';
      final existing = merged[key];
      merged[key] = existing == null
          ? item
          : existing.copyWith(quantity: existing.quantity + item.quantity);
    }
    return merged.values.toList();
  }

  // ----------------------------------------------------------------- rent

  _Rent? _readRent(SpokenText said) {
    final words = said.words;
    for (var i = 0; i < words.length; i++) {
      if (!VoiceKeywords.rent.contains(words[i]) &&
          !VoiceKeywords.daily.contains(words[i]) &&
          !VoiceKeywords.perBox.contains(words[i])) {
        continue;
      }

      // A rent word can also be a duration - "das mahine ke liye" is ten
      // months, not ten rupees - so anything under twenty is not a rate.
      final amount = said.numberNear(i, reach: 4, minimum: 20);
      if (amount == null) continue;
      said.claim(amount.start, amount.end);

      var basis = RentBasis.monthly;
      for (var j = i - 4; j <= i + 4; j++) {
        if (j < 0 || j >= words.length) continue;
        if (VoiceKeywords.daily.contains(words[j])) basis = RentBasis.daily;
        if (VoiceKeywords.perBox.contains(words[j])) {
          basis = RentBasis.perBoxMonthly;
        }
      }
      said.claim(i, i + 1);
      return _Rent(amount.value, basis);
    }
    return null;
  }
}

class _Rent {
  final double amount;
  final RentBasis basis;

  const _Rent(this.amount, this.basis);
}
