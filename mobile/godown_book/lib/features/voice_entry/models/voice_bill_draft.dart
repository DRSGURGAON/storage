import 'spoken_charge.dart';
import 'voice_reading.dart';

/// What one spoken sentence produced for a storage bill.
class VoiceBillDraft implements VoiceReading {
  @override
  final String transcript;
  @override
  final List<VoiceField> fields;

  final String? customerName;
  final String? customerPhone;
  final DateTime? periodFrom;
  final DateTime? periodTo;
  final List<SpokenCharge> charges;
  final double? discount;
  final double? gstPercent;

  const VoiceBillDraft({
    required this.transcript,
    this.customerName,
    this.customerPhone,
    this.periodFrom,
    this.periodTo,
    this.charges = const [],
    this.discount,
    this.gstPercent,
    this.fields = const [],
  });

  @override
  bool get isEmpty => fields.isEmpty;

  @override
  VoiceBillDraft keeping(Set<VoiceFieldKind> kinds) => VoiceBillDraft(
        transcript: transcript,
        customerName:
            kinds.contains(VoiceFieldKind.customerName) ? customerName : null,
        customerPhone:
            kinds.contains(VoiceFieldKind.customerPhone) ? customerPhone : null,
        periodFrom:
            kinds.contains(VoiceFieldKind.periodFrom) ? periodFrom : null,
        periodTo: kinds.contains(VoiceFieldKind.periodTo) ? periodTo : null,
        charges: kinds.contains(VoiceFieldKind.charges) ? charges : const [],
        discount: kinds.contains(VoiceFieldKind.discount) ? discount : null,
        gstPercent:
            kinds.contains(VoiceFieldKind.gstPercent) ? gstPercent : null,
        fields: fields.where((f) => kinds.contains(f.kind)).toList(),
      );
}
