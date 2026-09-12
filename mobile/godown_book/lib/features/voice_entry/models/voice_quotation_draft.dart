import 'spoken_charge.dart';
import 'voice_reading.dart';

/// What one spoken sentence produced for a quotation.
class VoiceQuotationDraft implements VoiceReading {
  @override
  final String transcript;
  @override
  final List<VoiceField> fields;

  final String? customerName;
  final String? customerPhone;
  final String? fromCity;
  final String? toCity;
  final DateTime? moveDate;
  final double? storageMonths;
  final List<SpokenCharge> services;
  final double? discount;
  final double? gstPercent;

  const VoiceQuotationDraft({
    required this.transcript,
    this.customerName,
    this.customerPhone,
    this.fromCity,
    this.toCity,
    this.moveDate,
    this.storageMonths,
    this.services = const [],
    this.discount,
    this.gstPercent,
    this.fields = const [],
  });

  @override
  bool get isEmpty => fields.isEmpty;

  @override
  VoiceQuotationDraft keeping(Set<VoiceFieldKind> kinds) => VoiceQuotationDraft(
        transcript: transcript,
        customerName:
            kinds.contains(VoiceFieldKind.customerName) ? customerName : null,
        customerPhone:
            kinds.contains(VoiceFieldKind.customerPhone) ? customerPhone : null,
        fromCity: kinds.contains(VoiceFieldKind.fromCity) ? fromCity : null,
        toCity: kinds.contains(VoiceFieldKind.toCity) ? toCity : null,
        moveDate: kinds.contains(VoiceFieldKind.moveDate) ? moveDate : null,
        storageMonths: kinds.contains(VoiceFieldKind.storageMonths)
            ? storageMonths
            : null,
        services: kinds.contains(VoiceFieldKind.services) ? services : const [],
        discount: kinds.contains(VoiceFieldKind.discount) ? discount : null,
        gstPercent:
            kinds.contains(VoiceFieldKind.gstPercent) ? gstPercent : null,
        fields: fields.where((f) => kinds.contains(f.kind)).toList(),
      );
}
