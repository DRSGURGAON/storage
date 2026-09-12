import '../models/charge_vocabulary.dart';
import '../models/spoken_charge.dart';
import 'spoken_text.dart';

/// Pulls the named charges out of a sentence - "packing das hazaar,
/// transport pandrah hazaar, loading do hazaar" - for a bill or a
/// quotation. Shared so both read the same words the same way.
class ChargeReader {
  const ChargeReader._();

  /// Whether a word names a charge - used by the quotation parser so a
  /// charge head is never mistaken for a town on the route.
  static bool isChargeWord(String word) =>
      ChargeVocabulary.lookup(word) != null;

  static List<SpokenCharge> read(SpokenText said) {
    final words = said.words;
    final found = <SpokenCharge>[];

    for (var i = 0; i < words.length; i++) {
      if (said.isUsed(i)) continue;

      String? name;
      var span = 1;
      if (i + 1 < words.length && !said.isUsed(i + 1)) {
        name = ChargeVocabulary.lookupPhrase(words[i], words[i + 1]);
        if (name != null) span = 2;
      }
      name ??= ChargeVocabulary.lookup(words[i]);
      if (name == null) continue;

      // "packing das hazaar" reads forwards, "das hazaar packing" back.
      final amount = said.numberNear(i + span - 1, reach: 4, minimum: 1);
      if (amount == null) continue;

      said.claim(amount.start, amount.end);
      said.claim(i, i + span);
      found.add(SpokenCharge(name, amount.value));
    }

    // The same head said twice is one line.
    final merged = <String, double>{};
    for (final charge in found) {
      merged[charge.name] = (merged[charge.name] ?? 0) + charge.amount;
    }
    return [
      for (final entry in merged.entries) SpokenCharge(entry.key, entry.value),
    ];
  }
}
