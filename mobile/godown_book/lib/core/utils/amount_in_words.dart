/// Converts an amount to words using the Indian numbering system
/// (thousand / lakh / crore), as required on Indian tax documents.
class AmountInWords {
  AmountInWords._();

  static const List<String> _ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];

  static const List<String> _tens = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ];

  static String _twoDigits(int value) {
    if (value < 20) return _ones[value];

    final tens = _tens[value ~/ 10];
    final ones = _ones[value % 10];

    return ones.isEmpty ? tens : '$tens $ones';
  }

  static String _threeDigits(int value) {
    final hundreds = value ~/ 100;
    final rest = value % 100;

    final parts = <String>[
      if (hundreds > 0) '${_ones[hundreds]} Hundred',
      if (rest > 0) _twoDigits(rest),
    ];

    return parts.join(' ');
  }

  /// Returns e.g. "One Lakh Three Thousand Five Hundred Rupees Only".
  /// Paise are included only when non-zero.
  static String convert(double amount, {String currency = 'Rupees'}) {
    if (amount < 0) return 'Minus ${convert(-amount, currency: currency)}';

    final rounded = (amount * 100).round();
    var rupees = rounded ~/ 100;
    final paise = rounded % 100;

    if (rupees == 0 && paise == 0) return 'Zero $currency Only';

    final parts = <String>[];

    final crore = rupees ~/ 10000000;
    rupees %= 10000000;

    final lakh = rupees ~/ 100000;
    rupees %= 100000;

    final thousand = rupees ~/ 1000;
    rupees %= 1000;

    if (crore > 0) parts.add('${_threeDigits(crore)} Crore');
    if (lakh > 0) parts.add('${_threeDigits(lakh)} Lakh');
    if (thousand > 0) parts.add('${_threeDigits(thousand)} Thousand');
    if (rupees > 0) parts.add(_threeDigits(rupees));

    final buffer = StringBuffer(parts.join(' '));

    if (paise > 0) {
      buffer.write(' $currency and ${_twoDigits(paise)} Paise Only');
    } else {
      buffer.write(' $currency Only');
    }

    return buffer.toString().replaceAll(RegExp(r'\s+'), ' ').trim();
  }
}
