import '../models/spoken_charge.dart';
import '../models/voice_quotation_draft.dart';
import '../models/voice_reading.dart';
import 'charge_reader.dart';
import 'spoken_text.dart';
import 'voice_keywords.dart';

/// Turns one spoken sentence into a quotation.
///
///     "Anil Sharma, 9812345678, Gurgaon se Jaipur, packing das hazaar,
///      transport pandrah hazaar, teen mahine storage, GST atharah
///      percent"
class VoiceQuotationParser {
  final DateTime today;

  VoiceQuotationParser({DateTime? today}) : today = today ?? DateTime.now();

  static const _nameStops = {
    ...VoiceKeywords.discount,
    ...VoiceKeywords.gst,
    ...VoiceKeywords.percentWords,
    ...VoiceKeywords.rent,
    ...VoiceKeywords.moveWords,
    ...SpokenText.phoneWords,
    ...SpokenText.dateWords,
    ...SpokenText.todayWords,
  };

  /// The word that separates the two ends of a move: "Gurgaon se Jaipur".
  static const _routeSplit = {'se', 'से'};
  static const _routeEnd = {'tak', 'तक'};

  VoiceQuotationDraft parse(String transcript) {
    final said = SpokenText(transcript);
    if (said.isEmpty) return VoiceQuotationDraft(transcript: said.transcript);

    final phone = said.mobile();
    // The route is read before the name, or "Anil Sharma Gurgaon se
    // Jaipur" would hand three words to the name.
    final route = _route(said);
    final months = _storageMonths(said);
    final date = said.nextDate(today);
    final gst = said.percent(VoiceKeywords.gst);
    final discount = said.keyedAmount(VoiceKeywords.discount, minimum: 1);
    final services = ChargeReader.read(said);
    final name = said.name(stops: _nameStops);

    final fields = <VoiceField>[];
    void add(VoiceFieldKind kind, String label, String display) =>
        fields.add(VoiceField(kind: kind, label: label, display: display));

    if (name != null) add(VoiceFieldKind.customerName, 'Customer name', name);
    if (phone != null) add(VoiceFieldKind.customerPhone, 'Mobile', phone);
    if (route?.from != null) {
      add(VoiceFieldKind.fromCity, 'Moving from', route!.from!);
    }
    if (route?.to != null) {
      add(VoiceFieldKind.toCity, 'Moving to', route!.to!);
    }
    if (date != null) {
      add(VoiceFieldKind.moveDate, 'Move date', VoiceFormat.date(date));
    }
    if (months != null) {
      add(VoiceFieldKind.storageMonths, 'Storage',
          '${VoiceFormat.qty(months)} month${months == 1 ? '' : 's'}');
    }
    if (services.isNotEmpty) {
      add(VoiceFieldKind.services, 'Services', _serviceLine(services));
    }
    if (discount != null) {
      add(VoiceFieldKind.discount, 'Discount', VoiceFormat.rupees(discount));
    }
    if (gst != null) {
      add(VoiceFieldKind.gstPercent, 'GST', '${VoiceFormat.qty(gst)}%');
    }

    return VoiceQuotationDraft(
      transcript: said.transcript,
      customerName: name,
      customerPhone: phone,
      fromCity: route?.from,
      toCity: route?.to,
      moveDate: date,
      storageMonths: months,
      services: services,
      discount: discount,
      gstPercent: gst,
      fields: fields,
    );
  }

  /// "Gurgaon se Jaipur" - the town before the "se" and the one after.
  _Route? _route(SpokenText said) {
    final words = said.words;
    for (var i = 1; i < words.length - 1; i++) {
      if (!_routeSplit.contains(words[i]) || said.isUsed(i)) continue;

      final before = i - 1;
      final after = i + 1;
      if (said.isUsed(before) || said.isUsed(after)) continue;
      if (!_isPlace(said, before) || !_isPlace(said, after)) continue;

      var end = after + 1;
      if (end < words.length && _routeEnd.contains(words[end])) end++;

      said.claim(before, end);
      return _Route(
        SpokenText.titleCase(words[before]),
        SpokenText.titleCase(words[after]),
      );
    }
    return null;
  }

  static bool _isPlace(SpokenText said, int index) {
    final word = said.words[index];
    if (SpokenText.noise.contains(word)) return false;
    if (SpokenText.months.containsKey(word)) return false;
    if (_nameStops.contains(word)) return false;
    if (ChargeReader.isChargeWord(word)) return false;
    return RegExp(r'^[a-zऀ-ॿ]{3,}$').hasMatch(word);
  }

  /// "teen mahine storage" - a duration, not a rate, so it is read from
  /// the month word rather than from the word "storage".
  double? _storageMonths(SpokenText said) {
    final words = said.words;
    for (var i = 0; i < words.length; i++) {
      if (!VoiceKeywords.rent.contains(words[i]) || said.isUsed(i)) continue;
      final read = said.numberEndingAt(i, reach: 3);
      if (read == null || read.value < 1 || read.value > 60) continue;
      said.claim(read.start, read.end);
      said.claim(i, i + 1);
      return read.value;
    }
    return null;
  }

  static String _serviceLine(List<SpokenCharge> services) => services
      .map((s) => '${s.name} ${VoiceFormat.rupees(s.amount)}')
      .join(',  ');
}

class _Route {
  final String? from;
  final String? to;

  const _Route(this.from, this.to);
}
