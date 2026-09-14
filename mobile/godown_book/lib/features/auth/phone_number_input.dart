/// Reads an Indian mobile number however somebody typed or pasted it
/// and gives back the ten digits, or null when it is not one.
///
/// Accepted shapes: `9876543210`, `+919876543210`, `919876543210`,
/// `09876543210`, with any spaces, dashes or brackets in between. The
/// number itself has to start with 6, 7, 8 or 9 - the ranges Indian
/// mobile numbers are issued in.
class PhoneNumberInput {
  PhoneNumberInput._();

  static final RegExp _tenDigits = RegExp(r'^[6-9]\d{9}$');

  static String? normalise(String raw) {
    var digits = raw.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.length == 12 && digits.startsWith('91')) {
      digits = digits.substring(2);
    } else if (digits.length == 11 && digits.startsWith('0')) {
      digits = digits.substring(1);
    }
    return _tenDigits.hasMatch(digits) ? digits : null;
  }

  /// The E.164 form Firebase is given.
  static String toE164(String tenDigits) => '+91$tenDigits';
}
