/// Indian financial year helpers. FY runs 1 April - 31 March.
class FinancialYear {
  FinancialYear._();

  /// Starting calendar year of the FY containing [date].
  /// 02-Aug-2026 -> 2026, 15-Feb-2026 -> 2025.
  static int startYear(DateTime date) =>
      date.month >= 4 ? date.year : date.year - 1;

  /// "2026-27"
  static String label(DateTime date) {
    final start = startYear(date);

    return '$start-${((start + 1) % 100).toString().padLeft(2, '0')}';
  }

  /// Document number in the format the business already uses on its
  /// printed documents, e.g. 2026/0028.
  static String documentNumber({
    required DateTime date,
    required int serial,
    int padding = 4,
  }) {
    return '${startYear(date)}/${serial.toString().padLeft(padding, '0')}';
  }
}
