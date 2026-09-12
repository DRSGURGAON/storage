import 'package:intl/intl.dart';

/// One thing the app believes it heard, and how to show it.
///
/// The operator sees these before anything touches a form, so a wrong
/// reading costs a tap, never a wrong document.
class VoiceField {
  final VoiceFieldKind kind;
  final String label;
  final String display;

  const VoiceField({
    required this.kind,
    required this.label,
    required this.display,
  });
}

/// Every box on every form the voice entry can fill. One list, so the
/// review sheet and the "keep only these" filter work the same way on
/// a storage entry, a bill, a payment and a quotation.
enum VoiceFieldKind {
  // Shared
  customerName,
  customerPhone,
  customerCity,
  customerPincode,

  // Storage entry
  storageStart,
  items,
  rent,
  securityDeposit,
  declaredValue,
  vehicleNumber,

  // Bill
  periodFrom,
  periodTo,
  charges,
  discount,
  gstPercent,

  // Payment
  amount,
  paymentMode,
  paymentType,
  paymentDate,
  reference,
  against,

  // Quotation
  fromCity,
  toCity,
  moveDate,
  storageMonths,
  services,
}

/// What one spoken sentence produced for one form.
abstract class VoiceReading {
  String get transcript;

  /// The review list, in the order it should be shown.
  List<VoiceField> get fields;

  /// The same reading with the rows the operator unticked dropped.
  VoiceReading keeping(Set<VoiceFieldKind> kinds);

  bool get isEmpty => fields.isEmpty;
}

/// Formatting shared by every review list, so ten thousand reads as
/// Rs 10,000 on the payment sheet exactly as it does on the bill.
class VoiceFormat {
  const VoiceFormat._();

  static final _money = NumberFormat.decimalPattern('en_IN');
  static final _date = DateFormat('dd MMM yyyy');

  static String rupees(double value) => value == value.roundToDouble()
      ? '${String.fromCharCode(0x20B9)}${_money.format(value.round())}'
      : '${String.fromCharCode(0x20B9)}${_money.format(value)}';

  static String date(DateTime value) => _date.format(value);

  static String qty(double value) =>
      value == value.roundToDouble() ? value.toStringAsFixed(0) : '$value';
}
