import '../../billing/models/payment_model.dart';
import 'voice_reading.dart';

/// What one spoken sentence produced for a payment receipt.
class VoicePaymentDraft implements VoiceReading {
  @override
  final String transcript;
  @override
  final List<VoiceField> fields;

  final String? payerName;
  final String? payerPhone;
  final double? amount;
  final PaymentMode? mode;
  final PaymentType? type;
  final DateTime? paymentDate;
  final String? reference;

  const VoicePaymentDraft({
    required this.transcript,
    this.payerName,
    this.payerPhone,
    this.amount,
    this.mode,
    this.type,
    this.paymentDate,
    this.reference,
    this.fields = const [],
  });

  @override
  bool get isEmpty => fields.isEmpty;

  @override
  VoicePaymentDraft keeping(Set<VoiceFieldKind> kinds) => VoicePaymentDraft(
        transcript: transcript,
        payerName:
            kinds.contains(VoiceFieldKind.customerName) ? payerName : null,
        payerPhone:
            kinds.contains(VoiceFieldKind.customerPhone) ? payerPhone : null,
        amount: kinds.contains(VoiceFieldKind.amount) ? amount : null,
        mode: kinds.contains(VoiceFieldKind.paymentMode) ? mode : null,
        type: kinds.contains(VoiceFieldKind.paymentType) ? type : null,
        paymentDate:
            kinds.contains(VoiceFieldKind.paymentDate) ? paymentDate : null,
        reference: kinds.contains(VoiceFieldKind.reference) ? reference : null,
        fields: fields.where((f) => kinds.contains(f.kind)).toList(),
      );
}
