import '../../billing/models/payment_model.dart';
import '../models/voice_payment_draft.dart';
import '../models/voice_reading.dart';
import 'spoken_text.dart';
import 'voice_keywords.dart';

/// Turns one spoken sentence into a payment receipt.
///
///     "Rajesh Kumar se paanch hazaar cash mile aaj"
///     "Suresh ne das hazaar UPI se diye, reference 445566"
class VoicePaymentParser {
  final DateTime today;

  VoicePaymentParser({DateTime? today}) : today = today ?? DateTime.now();

  static const _nameStops = {
    ...VoiceKeywords.received,
    ...VoiceKeywords.cash,
    ...VoiceKeywords.upi,
    ...VoiceKeywords.bank,
    ...VoiceKeywords.cheque,
    ...VoiceKeywords.card,
    ...VoiceKeywords.advance,
    ...VoiceKeywords.security,
    ...VoiceKeywords.refund,
    ...VoiceKeywords.fullPayment,
    ...VoiceKeywords.partPayment,
    ...VoiceKeywords.referenceWords,
    ...SpokenText.phoneWords,
    ...SpokenText.dateWords,
    ...SpokenText.todayWords,
  };

  VoicePaymentDraft parse(String transcript) {
    final said = SpokenText(transcript);
    if (said.isEmpty) return VoicePaymentDraft(transcript: said.transcript);

    // Order matters: the mobile number and the reference are digits
    // too, so they have to be taken off the table before the amount is
    // looked for.
    final phone = said.mobile();
    final reference = said.reference(VoiceKeywords.referenceWords);
    final date = said.nextDate(today);
    final mode = _mode(said);
    final type = _type(said);
    final amount =
        said.keyedAmount(VoiceKeywords.received) ?? said.loneAmount();
    final name = said.name(stops: _nameStops);

    final fields = <VoiceField>[];
    void add(VoiceFieldKind kind, String label, String display) =>
        fields.add(VoiceField(kind: kind, label: label, display: display));

    if (name != null) add(VoiceFieldKind.customerName, 'Received from', name);
    if (phone != null) add(VoiceFieldKind.customerPhone, 'Mobile', phone);
    if (amount != null) {
      add(VoiceFieldKind.amount, 'Amount received',
          VoiceFormat.rupees(amount));
    }
    if (mode != null) {
      add(VoiceFieldKind.paymentMode, 'How it was paid', mode.label);
    }
    if (type != null) {
      add(VoiceFieldKind.paymentType, 'What it is for', type.label);
    }
    if (date != null) {
      add(VoiceFieldKind.paymentDate, 'Payment date', VoiceFormat.date(date));
    }
    if (reference != null) {
      add(VoiceFieldKind.reference, 'Reference', reference);
    }

    return VoicePaymentDraft(
      transcript: said.transcript,
      payerName: name,
      payerPhone: phone,
      amount: amount,
      mode: mode,
      type: type,
      paymentDate: date,
      reference: reference,
      fields: fields,
    );
  }

  PaymentMode? _mode(SpokenText said) {
    if (said.mentions(VoiceKeywords.upi)) return PaymentMode.upi;
    if (said.mentions(VoiceKeywords.cheque)) return PaymentMode.cheque;
    if (said.mentions(VoiceKeywords.bank)) return PaymentMode.bankTransfer;
    if (said.mentions(VoiceKeywords.card)) return PaymentMode.card;
    if (said.mentions(VoiceKeywords.cash)) return PaymentMode.cash;
    return null;
  }

  /// Deposit money and ordinary payments are not the same thing on the
  /// ledger, so the words that separate them are worth listening for.
  PaymentType? _type(SpokenText said) {
    final security = said.mentions(VoiceKeywords.security);
    if (security && said.mentions(VoiceKeywords.refund)) {
      return PaymentType.depositRefund;
    }
    if (security) return PaymentType.securityDeposit;
    if (said.mentions(VoiceKeywords.advance)) return PaymentType.advance;
    if (said.mentions(VoiceKeywords.fullPayment)) {
      return PaymentType.fullPayment;
    }
    if (said.mentions(VoiceKeywords.partPayment)) {
      return PaymentType.partPayment;
    }
    return null;
  }
}
