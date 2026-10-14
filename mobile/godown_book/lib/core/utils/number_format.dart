/// Indian digit grouping with two decimals: 125000 -> "1,25,000.00",
/// -4500.5 -> "-4,500.50".
///
/// One formatter for every printed amount, so the Quotation and the Bill
/// show the same figure the same way (a quotation saying 500000.00 and
/// the bill made from it saying 5,00,000.00 reads as two different
/// numbers).
String formatMoney(double value) {
  final negative = value < 0;
  final parts = value.abs().toStringAsFixed(2).split('.');
  var whole = parts[0];

  if (whole.length > 3) {
    final lastThree = whole.substring(whole.length - 3);
    var rest = whole.substring(0, whole.length - 3);
    final groups = <String>[];

    while (rest.length > 2) {
      groups.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) groups.insert(0, rest);

    whole = '${groups.join(',')},$lastThree';
  }

  return '${negative ? '-' : ''}$whole.${parts[1]}';
}

/// A percentage without a pointless ".0": 3 -> "3", 2.5 -> "2.5",
/// 0.25 -> "0.25".
String formatRate(double rate) {
  final text = rate.toStringAsFixed(rate % 1 == 0 ? 0 : 2);
  return text.contains('.') ? text.replaceFirst(RegExp(r'0+$'), '') : text;
}

/// A rupee amount for screens: "₹ 1,25,000", with paise only when there
/// are any ("₹ 1,250.50").
String formatRupees(double value) {
  final money = formatMoney(value);
  return '₹ ${money.endsWith('.00') ? money.substring(0, money.length - 3) : money}';
}
