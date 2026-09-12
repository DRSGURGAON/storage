import '../models/spoken_numbers.dart';

/// One spoken sentence, broken into words, with the readers every form
/// needs: numbers the Indian way, a mobile number, a date, a name, a
/// lorry number, an amount that follows a keyword.
///
/// A reader claims the words it used, so two fields on the same form can
/// never read the same number twice. All of it runs on the phone.
class SpokenText {
  final String transcript;
  final List<String> words;
  final List<bool> _used;

  SpokenText(String transcript)
      : transcript = transcript.trim(),
        words = tokenise(transcript),
        _used = List<bool>.filled(tokenise(transcript).length, false);

  bool get isEmpty => words.isEmpty;

  bool isUsed(int index) =>
      index < 0 || index >= _used.length || _used[index];

  void claim(int start, int end) {
    for (var i = start; i < end && i < _used.length; i++) {
      if (i >= 0) _used[i] = true;
    }
  }

  /// Words that are neither a fact nor a field name - they sit between
  /// the two and mean nothing on their own.
  static const noise = {
    'rupaye', 'rupay', 'rupee', 'rupees', 'rs', 'ka', 'ki', 'ke', 'se',
    'ko', 'hai', 'hain', 'aur', 'and', 'ok', 'okay', 'please', 'liye',
    'tak', 'wala', 'wale', 'total', 'kul', 'ne', 'par', 'mein', 'me',
    'रुपये', 'रुपए', 'का', 'की', 'के', 'से', 'है', 'हैं', 'और', 'तक',
    'ने', 'में', 'पर',
  };

  static const todayWords = {'aaj', 'today', 'आज'};
  static const dateWords = {'tareekh', 'tarikh', 'tarik', 'date', 'तारीख'};
  static const nameWords = {'naam', 'name', 'नाम'};
  static const beforeNameWords = {
    'customer', 'grahak', 'party', 'shri', 'sri', 'mr', 'mrs', 'ms',
    'madam', 'sahab', 'ji', 'ग्राहक', 'श्री',
  };
  static const phoneWords = {
    'mobile', 'mobail', 'number', 'no', 'phone', 'fon', 'contact',
    'मोबाइल', 'नंबर', 'फोन',
  };
  static const pincodeWords = {'pincode', 'pin', 'पिनकोड'};
  static const vehicleWords = {
    'gaadi', 'gadi', 'vehicle', 'truck', 'tempo', 'lorry', 'canter',
    'गाड़ी', 'गाडी', 'ट्रक',
  };

  static const months = <String, int>{
    'january': 1, 'jan': 1, 'janvari': 1, 'जनवरी': 1,
    'february': 2, 'feb': 2, 'farvari': 2, 'फरवरी': 2,
    'march': 3, 'mar': 3, 'मार्च': 3,
    'april': 4, 'apr': 4, 'aprail': 4, 'अप्रैल': 4,
    'may': 5, 'mai': 5, 'मई': 5,
    'june': 6, 'jun': 6, 'joon': 6, 'जून': 6,
    'july': 7, 'jul': 7, 'julai': 7, 'जुलाई': 7,
    'august': 8, 'aug': 8, 'agast': 8, 'अगस्त': 8,
    'september': 9, 'sep': 9, 'sept': 9, 'sitambar': 9, 'सितंबर': 9,
    'october': 10, 'oct': 10, 'aktoobar': 10, 'अक्टूबर': 10,
    'november': 11, 'nov': 11, 'navambar': 11, 'नवंबर': 11,
    'december': 12, 'dec': 12, 'disambar': 12, 'दिसंबर': 12,
  };

  // ---------------------------------------------------------------- words

  /// Lower-cases, turns Devanagari digits into ASCII ones and drops the
  /// punctuation a recogniser sprinkles in.
  static List<String> tokenise(String transcript) {
    final buffer = StringBuffer();
    for (final rune in transcript.trim().toLowerCase().runes) {
      if (rune >= 0x0966 && rune <= 0x096F) {
        buffer.write(rune - 0x0966);
        continue;
      }
      final ch = String.fromCharCode(rune);
      if (RegExp(r'[a-z0-9ऀ-ॿ.,%]').hasMatch(ch)) {
        buffer.write(ch);
      } else {
        buffer.write(' ');
      }
    }
    return buffer
        .toString()
        .split(RegExp(r'\s+'))
        .map((w) => w.replaceAll(RegExp(r'^[.,]+|[.,]+$'), ''))
        .where((w) => w.isNotEmpty)
        .toList();
  }

  int? indexOfAny(Set<String> keys, {int from = 0}) {
    for (var i = from; i < words.length; i++) {
      if (keys.contains(words[i])) return i;
    }
    return null;
  }

  bool mentions(Set<String> keys) => indexOfAny(keys) != null;

  String? wordAfter(Set<String> keys) {
    final at = indexOfAny(keys);
    if (at == null) return null;
    for (var i = at + 1; i < words.length && i <= at + 2; i++) {
      final word = words[i];
      if (noise.contains(word)) continue;
      if (SpokenNumbers.isNumberWord(word)) return null;
      return titleCase(word);
    }
    return null;
  }

  // -------------------------------------------------------------- numbers

  /// Reads one number starting at [start], however it was said - in
  /// digits, in words, or with a "sadhe" in front of it.
  static SpokenNumber? readNumber(List<String> words, int start) {
    double total = 0;
    double chunk = 0;
    double? fraction;
    double? lastMultiplier;
    var seen = false;
    var pastThousand = false;
    var chunkMultiplied = false;
    var i = start;
    var chunkStart = start;

    while (i < words.length) {
      final word = words[i];

      final prefix = SpokenNumbers.fractionPrefixes[word];
      if (prefix != null && !seen) {
        fraction = prefix;
        i++;
        continue;
      }

      final digits = SpokenNumbers.digitsOnly(word);
      final unit = digits ?? SpokenNumbers.units[word];
      if (unit != null) {
        if (chunk == 0) {
          chunkStart = i;
          chunkMultiplied = false;
        }
        chunk += unit;
        if (fraction != null) {
          chunk += fraction;
          fraction = null;
        }
        seen = true;
        i++;
        continue;
      }

      final multiplier = SpokenNumbers.multipliers[word];
      if (multiplier != null) {
        // People count downwards - lakh, then hazaar, then sau. A
        // multiplier that repeats or grows belongs to the next number:
        // "teen hazaar paanch hazaar" is 3000 and then 5000, never 8000.
        if (lastMultiplier != null && multiplier >= lastMultiplier) {
          i = chunkStart;
          chunk = 0;
          break;
        }
        if (chunk == 0) {
          chunkStart = i;
          chunk = fraction == null ? 1 : 1 + fraction;
        }
        fraction = null;
        lastMultiplier = multiplier;
        chunkMultiplied = true;
        if (multiplier >= 1000) {
          total += chunk * multiplier;
          chunk = 0;
          pastThousand = true;
        } else {
          chunk *= multiplier;
        }
        seen = true;
        i++;
        continue;
      }

      break;
    }

    // "pandrah hazaar teen mahine" is fifteen thousand and then three
    // months - a bare small number after a thousand belongs to whatever
    // is being said next, not to this number. A chunk a multiplier did
    // pick up ("...paanch sau") is part of it and stays.
    if (pastThousand && chunk > 0 && !chunkMultiplied) {
      chunk = 0;
      i = chunkStart;
    }

    if (!seen || i <= start) return null;
    return SpokenNumber(total + chunk, start, i);
  }

  /// The nearest unclaimed number to [anchor] - forwards first, because
  /// "kiraya teen hazaar" is far more common than "teen hazaar kiraya".
  SpokenNumber? numberNear(int anchor, {int reach = 4, double minimum = 0}) {
    for (var i = anchor + 1; i <= anchor + reach && i < words.length; i++) {
      if (isUsed(i)) continue;
      final read = readNumber(words, i);
      if (read != null && read.value >= minimum) return read;
    }
    // Backwards from the far end, so "paanch hazaar advance" reads five
    // thousand and not the thousand alone.
    for (var i = anchor - reach; i < anchor; i++) {
      if (i < 0 || isUsed(i)) continue;
      final read = readNumber(words, i);
      if (read == null || read.value < minimum) continue;
      if (read.end >= anchor - 1) return read;
    }
    return null;
  }

  /// The number whose last word is the one just before [anchor] - what
  /// "teen mahine" means, and never the tail of a bigger number that
  /// happens to sit nearby.
  SpokenNumber? numberEndingAt(int anchor, {int reach = 3}) {
    for (var i = anchor - reach; i < anchor; i++) {
      if (i < 0 || isUsed(i)) continue;
      final read = readNumber(words, i);
      if (read != null && read.end == anchor) return read;
    }
    return null;
  }

  /// The amount that goes with a keyword - "advance paanch hazaar".
  double? keyedAmount(Set<String> keys, {double minimum = 10, int reach = 4}) {
    for (var i = 0; i < words.length; i++) {
      if (!keys.contains(words[i]) || isUsed(i)) continue;
      final amount = numberNear(i, reach: reach, minimum: minimum);
      if (amount == null) continue;
      claim(amount.start, amount.end);
      claim(i, i + 1);
      return amount.value;
    }
    return null;
  }

  /// The largest unclaimed number in the sentence - what an operator
  /// means when they say an amount without naming it.
  double? loneAmount({double minimum = 10}) {
    SpokenNumber? best;
    for (var i = 0; i < words.length; i++) {
      if (isUsed(i)) continue;
      final read = readNumber(words, i);
      if (read == null || read.value < minimum) continue;
      if (best == null || read.value > best.value) best = read;
    }
    if (best == null) return null;
    claim(best.start, best.end);
    return best.value;
  }

  /// A percentage - "aithara percent GST", "gst 18".
  double? percent(Set<String> keys, {double maximum = 100}) {
    for (var i = 0; i < words.length; i++) {
      if (!keys.contains(words[i]) || isUsed(i)) continue;
      final read = numberNear(i, reach: 3, minimum: 0);
      if (read == null || read.value > maximum) continue;
      claim(read.start, read.end);
      claim(i, i + 1);
      return read.value;
    }
    return null;
  }

  // ---------------------------------------------------------------- phone

  /// A mobile number, whether it arrived as "9876500001" or as ten
  /// spoken digits.
  String? mobile() {
    for (var i = 0; i < words.length; i++) {
      if (isUsed(i)) continue;
      final buffer = StringBuffer();
      for (var j = i; j < words.length; j++) {
        final word = words[j];
        final plain = word.replaceAll(',', '');
        if (RegExp(r'^\d+$').hasMatch(plain)) {
          buffer.write(plain);
        } else {
          final spoken = SpokenNumbers.units[word];
          if (spoken == null ||
              spoken < 0 ||
              spoken > 9 ||
              spoken != spoken.roundToDouble()) {
            break;
          }
          buffer.write(spoken.toInt());
        }

        // Check after every word, or the run swallows whatever number
        // was said next and no mobile number is ever found.
        final found = asMobile(buffer.toString());
        if (found != null) {
          claim(i, j + 1);
          return found;
        }
        if (buffer.length > 13) break;
      }
    }
    return null;
  }

  /// Ten digits, with or without the country code people read out.
  static String? asMobile(String digits) {
    var value = digits;
    if (value.length == 12 && value.startsWith('91')) {
      value = value.substring(2);
    } else if (value.length == 11 && value.startsWith('0')) {
      value = value.substring(1);
    }
    if (value.length != 10) return null;
    return RegExp(r'^[6-9]').hasMatch(value) ? value : null;
  }

  String? pincode() {
    for (var i = 0; i < words.length; i++) {
      if (!pincodeWords.contains(words[i])) continue;
      for (var j = i + 1; j < words.length && j <= i + 3; j++) {
        if (isUsed(j)) continue;
        final digits = words[j].replaceAll(',', '');
        if (RegExp(r'^\d{6}$').hasMatch(digits)) {
          claim(j, j + 1);
          return digits;
        }
      }
    }
    return null;
  }

  /// A cheque number, a UTR, a transaction id - a run of digits or a
  /// mixed code that follows a reference word.
  String? reference(Set<String> keys) {
    final at = indexOfAny(keys);
    if (at == null) return null;
    final buffer = StringBuffer();
    var start = -1;
    var end = at + 1;
    for (var i = at + 1; i < words.length && i <= at + 6; i++) {
      if (isUsed(i)) break;
      final word = words[i];
      if (noise.contains(word)) {
        if (buffer.isEmpty) continue;
        break;
      }
      final digits = RegExp(r'^\d+$').hasMatch(word)
          ? word
          : (SpokenNumbers.units[word] != null &&
                  SpokenNumbers.units[word]! >= 0 &&
                  SpokenNumbers.units[word]! <= 9 &&
                  SpokenNumbers.units[word]! ==
                      SpokenNumbers.units[word]!.roundToDouble())
              ? '${SpokenNumbers.units[word]!.toInt()}'
              : null;
      if (digits == null) break;
      if (start < 0) start = i;
      buffer.write(digits);
      end = i + 1;
    }
    if (buffer.length < 4) return null;
    claim(start, end);
    claim(at, at + 1);
    return buffer.toString();
  }

  // -------------------------------------------------------------- vehicle

  static final _vehiclePattern = RegExp(
      r'\b([a-z]{2})[ -]?(\d{1,2})[ -]?([a-z]{1,3})[ -]?(\d{4})\b');

  String? vehicle() {
    final joined = words.join(' ');
    final match = _vehiclePattern.firstMatch(joined);
    if (match == null) return null;
    final plate = '${match[1]}${match[2]}${match[3]}${match[4]}'.toUpperCase();

    final consumed = match[0]!.split(' ').where((w) => w.isNotEmpty).toList();
    for (var i = 0; i + consumed.length <= words.length; i++) {
      var hit = true;
      for (var k = 0; k < consumed.length; k++) {
        if (words[i + k] != consumed[k]) {
          hit = false;
          break;
        }
      }
      if (hit) {
        claim(i, i + consumed.length);
        break;
      }
    }
    return plate;
  }

  // ----------------------------------------------------------------- date

  /// The next date in the sentence. Call it again for the one after -
  /// each call claims the words it used, so "1 October se 31 October
  /// tak" gives the two ends of a billing period.
  DateTime? nextDate(DateTime today) {
    for (var i = 0; i < words.length; i++) {
      if (isUsed(i)) continue;
      if (todayWords.contains(words[i])) {
        claim(i, i + 1);
        return DateTime(today.year, today.month, today.day);
      }
    }

    for (var i = 0; i < words.length; i++) {
      final month = months[words[i]];
      if (month == null || isUsed(i)) continue;

      // "10 October" and "October 10" are both normal.
      SpokenNumber? day;
      if (i > 0 && !isUsed(i - 1)) {
        final before = readNumber(words, i - 1);
        if (before != null && before.end == i) day = before;
      }
      day ??= (i + 1 < words.length && !isUsed(i + 1))
          ? readNumber(words, i + 1)
          : null;
      if (day == null || day.value < 1 || day.value > 31) continue;

      var year = today.year;
      final after = day.end > i ? day.end : i + 1;
      if (after < words.length && !isUsed(after)) {
        final maybeYear = SpokenNumbers.digitsOnly(words[after]);
        if (maybeYear != null && maybeYear >= 2000 && maybeYear <= 2100) {
          year = maybeYear.toInt();
          claim(after, after + 1);
        }
      }

      claim(day.start, day.end);
      claim(i, i + 1);
      return DateTime(year, month, day.value.toInt());
    }

    // "pehli tareekh se" - a day of the current month.
    for (var i = 0; i < words.length; i++) {
      if (!dateWords.contains(words[i]) || isUsed(i)) continue;
      final day = numberNear(i, reach: 2);
      if (day == null || day.value < 1 || day.value > 31) continue;
      claim(day.start, day.end);
      claim(i, i + 1);
      return DateTime(today.year, today.month, day.value.toInt());
    }

    return null;
  }

  // ----------------------------------------------------------------- name

  /// The name is either whatever follows "naam", or the words the
  /// sentence opens with before it turns into facts.
  String? name({required Set<String> stops}) {
    var start = 0;
    for (var i = 0; i < words.length; i++) {
      if (nameWords.contains(words[i])) {
        start = i + 1;
        break;
      }
    }

    final picked = <String>[];
    for (var i = start; i < words.length && picked.length < 4; i++) {
      final word = words[i];
      if (isUsed(i)) break;
      if (SpokenNumbers.isNumberWord(word)) break;
      if (stops.contains(word)) break;
      if (months.containsKey(word)) break;
      if (noise.contains(word) || beforeNameWords.contains(word)) {
        if (picked.isEmpty) continue;
        break;
      }
      if (!RegExp(r'^[a-zऀ-ॿ]+$').hasMatch(word)) break;
      picked.add(word);
      claim(i, i + 1);
    }

    if (picked.isEmpty) return null;
    return picked.map(titleCase).join(' ');
  }

  static String titleCase(String word) =>
      word.isEmpty ? word : word[0].toUpperCase() + word.substring(1);
}
