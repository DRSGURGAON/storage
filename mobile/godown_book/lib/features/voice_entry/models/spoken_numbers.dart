/// Numbers the way a godown owner actually says them - "sadhe teen
/// hazaar", "pandrah sau", "dedh lakh" - written both in Hinglish and in
/// Devanagari, because Android's speech recogniser returns Devanagari on
/// the hi-IN locale and Latin letters on en-IN.
///
/// Nothing here talks to a server. The whole point is that an operator
/// standing inside a godown with no signal can still speak an entry.
class SpokenNumbers {
  const SpokenNumbers._();

  /// Every whole number a person is likely to speak in one breath, 0-100.
  /// Several spellings map to the same value because no two phones
  /// transliterate Hindi the same way.
  static const units = <String, double>{
    'zero': 0, 'shunya': 0, 'sifar': 0, 'शून्य': 0,
    'ek': 1, 'one': 1, 'एक': 1,
    'do': 2, 'two': 2, 'दो': 2,
    'teen': 3, 'tin': 3, 'three': 3, 'तीन': 3,
    'char': 4, 'chaar': 4, 'four': 4, 'चार': 4,
    'panch': 5, 'paanch': 5, 'panj': 5, 'five': 5, 'पांच': 5, 'पाँच': 5,
    'chah': 6, 'chhah': 6, 'chhe': 6, 'che': 6, 'six': 6, 'छह': 6, 'छै': 6,
    'saat': 7, 'sat': 7, 'seven': 7, 'सात': 7,
    'aath': 8, 'ath': 8, 'eight': 8, 'आठ': 8,
    'nau': 9, 'nao': 9, 'nine': 9, 'नौ': 9,
    'das': 10, 'dus': 10, 'ten': 10, 'दस': 10,
    'gyarah': 11, 'gyara': 11, 'eleven': 11, 'ग्यारह': 11,
    'barah': 12, 'baarah': 12, 'bara': 12, 'twelve': 12, 'बारह': 12,
    'terah': 13, 'tera': 13, 'thirteen': 13, 'तेरह': 13,
    'chaudah': 14, 'chaudha': 14, 'fourteen': 14, 'चौदह': 14,
    'pandrah': 15, 'pandra': 15, 'fifteen': 15, 'पंद्रह': 15, 'पन्द्रह': 15,
    'solah': 16, 'sola': 16, 'sixteen': 16, 'सोलह': 16,
    'satrah': 17, 'satra': 17, 'seventeen': 17, 'सत्रह': 17,
    'atharah': 18, 'athara': 18, 'eighteen': 18, 'अठारह': 18,
    'unnis': 19, 'unees': 19, 'nineteen': 19, 'उन्नीस': 19,
    'bees': 20, 'bis': 20, 'twenty': 20, 'बीस': 20,
    'ikkis': 21, 'ikees': 21, 'इक्कीस': 21,
    'bais': 22, 'baees': 22, 'बाईस': 22,
    'teis': 23, 'teees': 23, 'तेईस': 23,
    'chaubis': 24, 'chaubees': 24, 'चौबीस': 24,
    'pachchis': 25, 'pachees': 25, 'pachis': 25, 'पच्चीस': 25,
    'chhabbis': 26, 'chabbis': 26, 'छब्बीस': 26,
    'sattais': 27, 'सत्ताईस': 27,
    'atthais': 28, 'अट्ठाईस': 28,
    'untis': 29, 'unatis': 29, 'उनतीस': 29,
    'tees': 30, 'tis': 30, 'thirty': 30, 'तीस': 30,
    'ikattis': 31, 'इकतीस': 31,
    'battis': 32, 'बत्तीस': 32,
    'taintis': 33, 'तैंतीस': 33,
    'chauntis': 34, 'चौंतीस': 34,
    'paintis': 35, 'पैंतीस': 35,
    'chhattis': 36, 'छत्तीस': 36,
    'saintis': 37, 'सैंतीस': 37,
    'adhtis': 38, 'artis': 38, 'अड़तीस': 38,
    'untalis': 39, 'उनतालीस': 39,
    'chalis': 40, 'chalees': 40, 'forty': 40, 'चालीस': 40,
    'iktalis': 41, 'इकतालीस': 41,
    'bayalis': 42, 'बयालीस': 42,
    'taintalis': 43, 'तैंतालीस': 43,
    'chavalis': 44, 'चवालीस': 44,
    'paintalis': 45, 'पैंतालीस': 45,
    'chhiyalis': 46, 'छियालीस': 46,
    'saintalis': 47, 'सैंतालीस': 47,
    'adtalis': 48, 'अड़तालीस': 48,
    'unchas': 49, 'उनचास': 49,
    'pachas': 50, 'pachaas': 50, 'pachhas': 50, 'fifty': 50, 'पचास': 50,
    'ikyavan': 51, 'इक्यावन': 51,
    'bavan': 52, 'बावन': 52,
    'tirpan': 53, 'तिरपन': 53,
    'chauvan': 54, 'चौवन': 54,
    'pachpan': 55, 'पचपन': 55,
    'chhappan': 56, 'छप्पन': 56,
    'sattavan': 57, 'सत्तावन': 57,
    'atthavan': 58, 'अट्ठावन': 58,
    'unsath': 59, 'उनसठ': 59,
    'saath': 60, 'sath': 60, 'sixty': 60, 'साठ': 60,
    'ikasath': 61, 'इकसठ': 61,
    'basath': 62, 'बासठ': 62,
    'tirsath': 63, 'तिरसठ': 63,
    'chausath': 64, 'चौंसठ': 64,
    'painsath': 65, 'पैंसठ': 65,
    'chhiyasath': 66, 'छियासठ': 66,
    'sarsath': 67, 'सड़सठ': 67,
    'arsath': 68, 'अड़सठ': 68,
    'unhattar': 69, 'उनहत्तर': 69,
    'sattar': 70, 'seventy': 70, 'सत्तर': 70,
    'ikhattar': 71, 'इकहत्तर': 71,
    'bahattar': 72, 'बहत्तर': 72,
    'tihattar': 73, 'तिहत्तर': 73,
    'chauhattar': 74, 'चौहत्तर': 74,
    'pachhattar': 75, 'पचहत्तर': 75,
    'chhihattar': 76, 'छिहत्तर': 76,
    'satattar': 77, 'सतहत्तर': 77,
    'athhattar': 78, 'अठहत्तर': 78,
    'unyasi': 79, 'उन्यासी': 79,
    'assi': 80, 'eighty': 80, 'अस्सी': 80,
    'ikyasi': 81, 'इक्यासी': 81,
    'bayasi': 82, 'बयासी': 82,
    'tirasi': 83, 'तिरासी': 83,
    'chaurasi': 84, 'चौरासी': 84,
    'pachasi': 85, 'पचासी': 85,
    'chhiyasi': 86, 'छियासी': 86,
    'satasi': 87, 'सतासी': 87,
    'athasi': 88, 'अठासी': 88,
    'navasi': 89, 'नवासी': 89,
    'nabbe': 90, 'ninety': 90, 'नब्बे': 90,
    'ikyanve': 91, 'इक्यानवे': 91,
    'banve': 92, 'बानवे': 92,
    'tiranve': 93, 'तिरानवे': 93,
    'chauranve': 94, 'चौरानवे': 94,
    'panchanve': 95, 'पंचानवे': 95,
    'chhiyanve': 96, 'छियानवे': 96,
    'satanve': 97, 'सत्तानवे': 97,
    'atthanve': 98, 'अट्ठानवे': 98,
    'ninyanve': 99, 'निन्यानवे': 99,
    // Halves people say as one word.
    'adha': 0.5, 'aadha': 0.5, 'half': 0.5, 'आधा': 0.5,
    'dedh': 1.5, 'derh': 1.5, 'डेढ़': 1.5, 'डेढ': 1.5,
    'dhai': 2.5, 'ढाई': 2.5,
    'pauna': 0.75, 'पौना': 0.75,
  };

  /// Words that multiply whatever came before them.
  static const multipliers = <String, double>{
    'sau': 100, 'hundred': 100, 'सौ': 100,
    'hazar': 1000, 'hazaar': 1000, 'hajar': 1000, 'hajaar': 1000,
    'thousand': 1000, 'हजार': 1000, 'हज़ार': 1000,
    'lakh': 100000, 'lac': 100000, 'lakhs': 100000, 'लाख': 100000,
    'crore': 10000000, 'karod': 10000000, 'करोड़': 10000000, 'करोड': 10000000,
  };

  /// "sadhe teen hazaar" is 3500 - the prefix moves the number that
  /// follows it by a quarter or a half.
  static const fractionPrefixes = <String, double>{
    'sadhe': 0.5, 'saadhe': 0.5, 'साढ़े': 0.5, 'साढे': 0.5,
    'sava': 0.25, 'sawa': 0.25, 'सवा': 0.25,
    'paune': -0.25, 'पौने': -0.25,
  };

  static bool isNumberWord(String word) =>
      units.containsKey(word) ||
      multipliers.containsKey(word) ||
      fractionPrefixes.containsKey(word) ||
      digitsOnly(word) != null;

  /// The numeric value of a token that is already written in digits,
  /// tolerating the commas and the rupee sign a recogniser leaves behind.
  static double? digitsOnly(String word) {
    final cleaned = word.replaceAll(RegExp(r'[,₹]'), '');
    if (cleaned.isEmpty) return null;
    if (!RegExp(r'^\d+(\.\d+)?$').hasMatch(cleaned)) return null;
    return double.tryParse(cleaned);
  }
}

/// A number lifted out of a sentence, and where it ended so the caller
/// can carry on reading from there.
class SpokenNumber {
  final double value;
  final int start;
  final int end;

  const SpokenNumber(this.value, this.start, this.end);
}
