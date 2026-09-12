import 'package:intl/intl.dart';

import '../../../core/utils/id_generator.dart';
import '../../storage_booking/models/booking_item_model.dart';
import '../../storage_booking/models/storage_status.dart';
import '../models/goods_vocabulary.dart';
import '../models/spoken_numbers.dart';
import '../models/voice_entry_draft.dart';

/// Turns one spoken sentence into the fields of a storage entry.
///
/// This runs entirely on the phone. There is no model call, no API key
/// and no network: it is a vocabulary and a set of anchors, which is
/// enough because a godown entry is always the same handful of facts
/// said in one of a few ways.
///
///     "Rajesh Kumar, 9876500001, das October se, ek almari do palang
///      teen carton, mahine ka teen hazaar, paanch hazaar advance"
///
/// What it cannot work out, it leaves alone - the operator types it.
class VoiceEntryParser {
  final DateTime today;
  final String bookingId;

  VoiceEntryParser({DateTime? today, String? bookingId})
      : today = today ?? DateTime.now(),
        bookingId = bookingId ?? '';

  static final _money = NumberFormat.decimalPattern('en_IN');
  static final _dateOut = DateFormat('dd MMM yyyy');

  // Words that end a customer's name, because they start some other fact.
  static const _rentWords = {
    'kiraya', 'kiraaya', 'kiray', 'kiraye', 'rent', 'bhada', 'bhade',
    'mahina', 'mahine', 'maheena', 'month', 'monthly', 'permonth',
    'किराया', 'किराये', 'भाड़ा', 'महीना', 'महीने',
  };
  static const _dailyWords = {
    'din', 'dinka', 'daily', 'day', 'perday', 'roz', 'rozana', 'दिन', 'रोज',
  };
  static const _perBoxWords = {
    'perbox', 'pratibox', 'petiket', 'prati', 'perpiece', 'perpetti',
  };
  static const _depositWords = {
    'advance', 'edvans', 'adwans', 'jama', 'peshgi', 'baayana', 'bayana',
    'deposit', 'security', 'एडवांस', 'जमा', 'सिक्योरिटी', 'पेशगी',
  };
  static const _valueWords = {
    'value', 'keemat', 'kimat', 'kimmat', 'declared', 'cost', 'worth',
    'कीमत', 'मूल्य',
  };
  static const _phoneWords = {
    'mobile', 'mobail', 'number', 'no', 'phone', 'fon', 'contact',
    'मोबाइल', 'नंबर', 'फोन',
  };
  static const _nameWords = {'naam', 'name', 'नाम'};
  static const _beforeNameWords = {
    'customer', 'grahak', 'party', 'shri', 'sri', 'mr', 'mrs', 'ms',
    'madam', 'sahab', 'ji', 'ग्राहक', 'श्री',
  };
  static const _cityWords = {'shehar', 'sheher', 'city', 'शहर'};
  static const _vehicleWords = {
    'gaadi', 'gadi', 'vehicle', 'truck', 'tempo', 'lorry', 'canter',
    'गाड़ी', 'गाडी', 'ट्रक',
  };
  static const _pincodeWords = {'pincode', 'pin', 'पिनकोड'};
  static const _noiseWords = {
    'rupaye', 'rupay', 'rupee', 'rupees', 'rs', 'ka', 'ki', 'ke', 'se',
    'ko', 'hai', 'hain', 'aur', 'and', 'ok', 'okay', 'please',
    'रुपये', 'रुपए', 'का', 'की', 'के', 'से', 'है', 'हैं', 'और',
  };

  static const _months = <String, int>{
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

  static const _todayWords = {'aaj', 'today', 'आज'};

  /// Words that mean "this is a date", e.g. "pehli tareekh se".
  static const _dateWords = {'tareekh', 'tarikh', 'tarik', 'तारीख', 'date'};

  VoiceEntryDraft parse(String transcript) {
    final words = _tokenise(transcript);
    if (words.isEmpty) return VoiceEntryDraft(transcript: transcript.trim());

    // Tokens already claimed by a field, so two fields never read the
    // same number.
    final used = List<bool>.filled(words.length, false);
    final fields = <VoiceField>[];

    final vehicle = _readVehicle(words, used);
    final phone = _readPhone(words, used);
    final pincode = _readPincode(words, used);
    final date = _readDate(words, used);
    final items = _readItems(words, used);
    final rent = _readRent(words, used);
    final deposit = _readKeyedAmount(words, used, _depositWords);
    final value = _readKeyedAmount(words, used, _valueWords);
    final city = _readCity(words);
    final name = _readName(words, used);

    void add(VoiceFieldKind kind, String label, String display, String heard) {
      fields.add(VoiceField(
          kind: kind, label: label, display: display, heard: heard));
    }

    if (name != null) {
      add(VoiceFieldKind.customerName, 'Customer name', name, name);
    }
    if (phone != null) {
      add(VoiceFieldKind.customerPhone, 'Mobile', phone, phone);
    }
    if (city != null) add(VoiceFieldKind.customerCity, 'City', city, city);
    if (pincode != null) {
      add(VoiceFieldKind.customerPincode, 'Pincode', pincode, pincode);
    }
    if (date != null) {
      add(VoiceFieldKind.storageStart, 'Storage from', _dateOut.format(date),
          _dateOut.format(date));
    }
    if (items.isNotEmpty) {
      add(
        VoiceFieldKind.items,
        'Goods',
        items
            .map((i) => '${_qty(i.quantity)} ${i.itemName}')
            .join(',  '),
        '',
      );
    }
    if (rent != null) {
      add(VoiceFieldKind.rent, 'Rent',
          '${_rupees(rent.amount)} ${rent.basis.rateHint}', '');
    }
    if (deposit != null) {
      add(VoiceFieldKind.securityDeposit, 'Deposit / advance',
          _rupees(deposit), '');
    }
    if (value != null) {
      add(VoiceFieldKind.declaredValue, 'Declared value', _rupees(value), '');
    }
    if (vehicle != null) {
      add(VoiceFieldKind.vehicleNumber, 'Vehicle no.', vehicle, vehicle);
    }

    return VoiceEntryDraft(
      transcript: transcript.trim(),
      customerName: name,
      customerPhone: phone,
      customerCity: city,
      customerPincode: pincode,
      storageStart: date,
      items: items,
      rentRate: rent?.amount,
      rentBasis: rent?.basis,
      securityDeposit: deposit,
      declaredValue: value,
      vehicleNumber: vehicle,
      fields: fields,
    );
  }

  // ---------------------------------------------------------------- words

  /// Lower-cases, turns Devanagari digits into ASCII ones and drops the
  /// punctuation a recogniser sprinkles in, keeping one clean word list.
  static List<String> _tokenise(String transcript) {
    final buffer = StringBuffer();
    for (final rune in transcript.trim().toLowerCase().runes) {
      if (rune >= 0x0966 && rune <= 0x096F) {
        // Devanagari zero to nine.
        buffer.write(rune - 0x0966);
        continue;
      }
      final ch = String.fromCharCode(rune);
      if (RegExp(r'[a-z0-9ऀ-ॿ.,]').hasMatch(ch)) {
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

  // -------------------------------------------------------------- numbers

  /// Reads one number starting at [start], however it was said - in
  /// digits, in words, or with a "sadhe" in front of it.
  static SpokenNumber? readNumber(List<String> words, int start) {
    double total = 0;
    double chunk = 0;
    double? fraction;
    double? lastMultiplier;
    var seen = false;
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
        if (chunk == 0) chunkStart = i;
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
        if (multiplier >= 1000) {
          total += chunk * multiplier;
          chunk = 0;
        } else {
          chunk *= multiplier;
        }
        seen = true;
        i++;
        continue;
      }

      break;
    }

    if (!seen || i <= start) return null;
    return SpokenNumber(total + chunk, start, i);
  }

  /// The nearest number the operator has not already spent on another
  /// field - looking forward first, because "kiraya teen hazaar" is far
  /// more common than "teen hazaar kiraya".
  SpokenNumber? _nearestNumber(
    List<String> words,
    List<bool> used,
    int anchor, {
    int reach = 4,
    double minimum = 0,
  }) {
    for (var i = anchor + 1; i <= anchor + reach && i < words.length; i++) {
      if (used[i]) continue;
      final read = readNumber(words, i);
      if (read != null && read.value >= minimum) return read;
    }
    // Backwards, start from the far end so "paanch hazaar advance" reads
    // five thousand and not the thousand alone.
    for (var i = anchor - reach; i < anchor; i++) {
      if (i < 0 || used[i]) continue;
      final read = readNumber(words, i);
      if (read == null || read.value < minimum) continue;
      if (read.end >= anchor - 1) return read;
    }
    return null;
  }

  static void _claim(List<bool> used, int start, int end) {
    for (var i = start; i < end && i < used.length; i++) {
      used[i] = true;
    }
  }

  // ---------------------------------------------------------------- phone

  /// A mobile number, whether it arrived as "9876500001" or as ten
  /// spoken digits.
  String? _readPhone(List<String> words, List<bool> used) {
    for (var i = 0; i < words.length; i++) {
      if (used[i]) continue;
      final buffer = StringBuffer();
      for (var j = i; j < words.length; j++) {
        final word = words[j];
        final plain = word.replaceAll(',', '');
        if (RegExp(r'^\d+$').hasMatch(plain)) {
          buffer.write(plain);
        } else {
          final spoken = SpokenNumbers.units[word];
          if (spoken == null || spoken < 0 || spoken > 9 ||
              spoken != spoken.roundToDouble()) {
            break;
          }
          buffer.write(spoken.toInt());
        }

        // Check after every word, or the run swallows whatever number
        // was said next and no mobile number is ever found.
        final mobile = _asMobile(buffer.toString());
        if (mobile != null) {
          _claim(used, i, j + 1);
          return mobile;
        }
        if (buffer.length > 13) break;
      }
    }
    return null;
  }

  /// Ten digits, with or without the country code people read out.
  static String? _asMobile(String digits) {
    var value = digits;
    if (value.length == 12 && value.startsWith('91')) {
      value = value.substring(2);
    } else if (value.length == 11 && value.startsWith('0')) {
      value = value.substring(1);
    }
    if (value.length != 10) return null;
    return RegExp(r'^[6-9]').hasMatch(value) ? value : null;
  }

  String? _readPincode(List<String> words, List<bool> used) {
    for (var i = 0; i < words.length; i++) {
      if (!_pincodeWords.contains(words[i])) continue;
      for (var j = i + 1; j < words.length && j <= i + 3; j++) {
        if (used[j]) continue;
        final digits = words[j].replaceAll(',', '');
        if (RegExp(r'^\d{6}$').hasMatch(digits)) {
          _claim(used, j, j + 1);
          return digits;
        }
      }
    }
    return null;
  }

  // -------------------------------------------------------------- vehicle

  static final _vehiclePattern = RegExp(
      r'\b([a-z]{2})[ -]?(\d{1,2})[ -]?([a-z]{1,3})[ -]?(\d{4})\b');

  String? _readVehicle(List<String> words, List<bool> used) {
    final joined = words.join(' ');
    final match = _vehiclePattern.firstMatch(joined);
    if (match == null) return null;
    final plate =
        '${match[1]}${match[2]}${match[3]}${match[4]}'.toUpperCase();

    // Take the words the plate came from out of circulation.
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
        _claim(used, i, i + consumed.length);
        break;
      }
    }
    return plate;
  }

  // ----------------------------------------------------------------- date

  DateTime? _readDate(List<String> words, List<bool> used) {
    for (var i = 0; i < words.length; i++) {
      if (used[i]) continue;
      if (_todayWords.contains(words[i])) {
        _claim(used, i, i + 1);
        return DateTime(today.year, today.month, today.day);
      }
    }

    for (var i = 0; i < words.length; i++) {
      final month = _months[words[i]];
      if (month == null) continue;

      // "10 October" and "October 10" are both normal.
      SpokenNumber? day;
      if (i > 0 && !used[i - 1]) {
        final before = readNumber(words, i - 1);
        if (before != null && before.end == i) day = before;
      }
      day ??= (i + 1 < words.length && !used[i + 1])
          ? readNumber(words, i + 1)
          : null;
      if (day == null || day.value < 1 || day.value > 31) continue;

      var year = today.year;
      final after = day.end > i ? day.end : i + 1;
      if (after < words.length) {
        final maybeYear = SpokenNumbers.digitsOnly(words[after]);
        if (maybeYear != null && maybeYear >= 2000 && maybeYear <= 2100) {
          year = maybeYear.toInt();
          _claim(used, after, after + 1);
        }
      }

      _claim(used, day.start, day.end);
      _claim(used, i, i + 1);
      return DateTime(year, month, day.value.toInt());
    }

    // "pehli tareekh se" - a day of the current month.
    for (var i = 0; i < words.length; i++) {
      if (!_dateWords.contains(words[i])) continue;
      final day = _nearestNumber(words, used, i, reach: 2);
      if (day == null || day.value < 1 || day.value > 31) continue;
      _claim(used, day.start, day.end);
      _claim(used, i, i + 1);
      return DateTime(today.year, today.month, day.value.toInt());
    }

    return null;
  }

  // ---------------------------------------------------------------- goods

  List<BookingItemModel> _readItems(List<String> words, List<bool> used) {
    final items = <BookingItemModel>[];

    for (var i = 0; i < words.length; i++) {
      if (used[i]) continue;

      GoodsTerm? term;
      var span = 1;
      if (i + 1 < words.length && !used[i + 1]) {
        term = GoodsVocabulary.lookupPhrase(words[i], words[i + 1]);
        if (term != null) span = 2;
      }
      term ??= GoodsVocabulary.lookup(words[i]);
      if (term == null) continue;

      // "do palang" reads backwards; "carton 42" reads forwards.
      double quantity = 1;
      var claimedFrom = i;
      SpokenNumber? count;
      for (var back = i - 1; back >= 0 && back >= i - 3; back--) {
        if (used[back]) break;
        final read = readNumber(words, back);
        if (read != null && read.end >= i - 1) {
          count = read;
          break;
        }
        if (!_noiseWords.contains(words[back])) break;
      }
      count ??= (i + span < words.length && !used[i + span])
          ? readNumber(words, i + span)
          : null;

      if (count != null && count.value > 0) {
        quantity = count.value;
        if (count.start < claimedFrom) claimedFrom = count.start;
        _claim(used, count.start, count.end);
      }

      _claim(used, claimedFrom, i + span);
      items.add(BookingItemModel(
        id: IdGenerator.generateId(),
        bookingId: bookingId,
        sortOrder: items.length,
        itemName: term.name,
        quantity: quantity,
        unit: term.unit,
      ));
    }

    // The same thing said twice is one line with the counts added.
    final merged = <String, BookingItemModel>{};
    for (final item in items) {
      final key = '${item.itemName}|${item.unit}';
      final existing = merged[key];
      merged[key] = existing == null
          ? item
          : existing.copyWith(quantity: existing.quantity + item.quantity);
    }
    return merged.values.toList();
  }

  // ----------------------------------------------------------------- rent

  _Rent? _readRent(List<String> words, List<bool> used) {
    for (var i = 0; i < words.length; i++) {
      if (!_rentWords.contains(words[i]) &&
          !_dailyWords.contains(words[i]) &&
          !_perBoxWords.contains(words[i])) {
        continue;
      }

      // A rent word can also be a duration - "das mahine ke liye" is ten
      // months, not ten rupees - so anything under twenty is not a rate.
      final amount = _nearestNumber(words, used, i, reach: 4, minimum: 20);
      if (amount == null) continue;
      _claim(used, amount.start, amount.end);

      var basis = RentBasis.monthly;
      for (var j = i - 4; j <= i + 4; j++) {
        if (j < 0 || j >= words.length) continue;
        if (_dailyWords.contains(words[j])) basis = RentBasis.daily;
        if (_perBoxWords.contains(words[j])) basis = RentBasis.perBoxMonthly;
      }
      _claim(used, i, i + 1);
      return _Rent(amount.value, basis);
    }
    return null;
  }

  double? _readKeyedAmount(
      List<String> words, List<bool> used, Set<String> keys) {
    for (var i = 0; i < words.length; i++) {
      if (!keys.contains(words[i])) continue;
      final amount = _nearestNumber(words, used, i, reach: 4, minimum: 10);
      if (amount == null) continue;
      _claim(used, amount.start, amount.end);
      _claim(used, i, i + 1);
      return amount.value;
    }
    return null;
  }

  // ----------------------------------------------------------------- text

  String? _readCity(List<String> words) {
    for (var i = 0; i < words.length - 1; i++) {
      if (!_cityWords.contains(words[i])) continue;
      final next = words[i + 1];
      if (SpokenNumbers.isNumberWord(next) || _noiseWords.contains(next)) {
        continue;
      }
      return _titleCase(next);
    }
    return null;
  }

  /// The name is either whatever follows "naam", or the words the
  /// sentence opens with before it turns into facts.
  String? _readName(List<String> words, List<bool> used) {
    var start = 0;
    for (var i = 0; i < words.length; i++) {
      if (_nameWords.contains(words[i])) {
        start = i + 1;
        break;
      }
    }

    final picked = <String>[];
    for (var i = start; i < words.length && picked.length < 4; i++) {
      final word = words[i];
      if (used[i]) break;
      if (SpokenNumbers.isNumberWord(word)) break;
      if (GoodsVocabulary.lookup(word) != null) break;
      if (_rentWords.contains(word) ||
          _dailyWords.contains(word) ||
          _depositWords.contains(word) ||
          _valueWords.contains(word) ||
          _phoneWords.contains(word) ||
          _cityWords.contains(word) ||
          _vehicleWords.contains(word) ||
          _pincodeWords.contains(word) ||
          _dateWords.contains(word) ||
          _todayWords.contains(word) ||
          _months.containsKey(word)) {
        break;
      }
      if (_noiseWords.contains(word) || _beforeNameWords.contains(word)) {
        if (picked.isEmpty) continue;
        break;
      }
      if (!RegExp(r'^[a-zऀ-ॿ]+$').hasMatch(word)) break;
      picked.add(word);
      used[i] = true;
    }

    if (picked.isEmpty) return null;
    return picked.map(_titleCase).join(' ');
  }

  static String _titleCase(String word) => word.isEmpty
      ? word
      : word[0].toUpperCase() + word.substring(1);

  static String _qty(double value) =>
      value == value.roundToDouble() ? value.toStringAsFixed(0) : '$value';

  static String _rupees(double value) => value == value.roundToDouble()
      ? '${String.fromCharCode(0x20B9)}${_money.format(value.round())}'
      : '${String.fromCharCode(0x20B9)}${_money.format(value)}';
}

class _Rent {
  final double amount;
  final RentBasis basis;

  const _Rent(this.amount, this.basis);
}
