import '../models/spoken_charge.dart';
import '../models/voice_bill_draft.dart';
import '../models/voice_reading.dart';
import 'charge_reader.dart';
import 'spoken_text.dart';
import 'voice_keywords.dart';

/// Turns one spoken sentence into a storage bill.
///
///     "Rajesh Kumar, ek October se atharah October tak, storage teen
///      hazaar, mazdoori paanch sau, GST atharah percent"
class VoiceBillParser {
  final DateTime today;

  VoiceBillParser({DateTime? today}) : today = today ?? DateTime.now();

  static const _nameStops = {
    ...VoiceKeywords.discount,
    ...VoiceKeywords.gst,
    ...VoiceKeywords.percentWords,
    ...SpokenText.phoneWords,
    ...SpokenText.dateWords,
    ...SpokenText.todayWords,
  };

  VoiceBillDraft parse(String transcript) {
    final said = SpokenText(transcript);
    if (said.isEmpty) return VoiceBillDraft(transcript: said.transcript);

    final phone = said.mobile();
    // A bill period is two dates in the order they were said.
    final first = said.nextDate(today);
    final second = said.nextDate(today);
    final gst = said.percent(VoiceKeywords.gst);
    final discount = said.keyedAmount(VoiceKeywords.discount, minimum: 1);
    final charges = ChargeReader.read(said);
    final name = said.name(stops: _nameStops);

    DateTime? from = first;
    DateTime? to = second;
    if (from != null && to != null && to.isBefore(from)) {
      final swap = from;
      from = to;
      to = swap;
    }

    final fields = <VoiceField>[];
    void add(VoiceFieldKind kind, String label, String display) =>
        fields.add(VoiceField(kind: kind, label: label, display: display));

    if (name != null) add(VoiceFieldKind.customerName, 'Customer name', name);
    if (phone != null) add(VoiceFieldKind.customerPhone, 'Mobile', phone);
    if (from != null) {
      add(VoiceFieldKind.periodFrom, 'Period from', VoiceFormat.date(from));
    }
    if (to != null) {
      add(VoiceFieldKind.periodTo, 'Period to', VoiceFormat.date(to));
    }
    if (charges.isNotEmpty) {
      add(VoiceFieldKind.charges, 'Charges', _chargeLine(charges));
    }
    if (discount != null) {
      add(VoiceFieldKind.discount, 'Discount', VoiceFormat.rupees(discount));
    }
    if (gst != null) {
      add(VoiceFieldKind.gstPercent, 'GST', '${VoiceFormat.qty(gst)}%');
    }

    return VoiceBillDraft(
      transcript: said.transcript,
      customerName: name,
      customerPhone: phone,
      periodFrom: from,
      periodTo: to,
      charges: charges,
      discount: discount,
      gstPercent: gst,
      fields: fields,
    );
  }

  static String _chargeLine(List<SpokenCharge> charges) => charges
      .map((c) => '${c.name} ${VoiceFormat.rupees(c.amount)}')
      .join(',  ');
}
