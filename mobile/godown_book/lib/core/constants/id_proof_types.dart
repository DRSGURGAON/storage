/// The identity documents an Indian storage customer actually produces
/// at pickup, as a fixed list so nobody has to type "Aadhaar" twenty
/// times a day - and so the same words print on every receipt and
/// handover paper.
///
/// Two shapes exist in this app's own data. CustomerModel keeps the
/// type and the number in separate columns; StorageBookingModel and the
/// handover paper keep one free-text string ("Aadhaar 1234-5678-9012").
/// [parse] reads either - including whatever was typed before this list
/// existed - and [combine] writes the single-string form back.
class IdProofTypes {
  IdProofTypes._();

  static const String aadhaar = 'Aadhaar Card';
  static const String pan = 'PAN Card';
  static const String drivingLicence = 'Driving Licence';
  static const String voterId = 'Voter ID';
  static const String passport = 'Passport';
  static const String rationCard = 'Ration Card';

  /// Anything the list does not name. The parent screen then asks what
  /// it is, so nothing typed before this list existed is ever lost.
  static const String other = 'Other';

  static const List<String> values = [
    aadhaar,
    pan,
    drivingLicence,
    voterId,
    passport,
    rationCard,
    other,
  ];

  /// How each type has actually been written by hand in this app so
  /// far, so old records land on the right entry instead of "Other".
  static const Map<String, List<String>> _aliases = {
    aadhaar: ['aadhaar', 'aadhar', 'adhaar', 'adhar', 'uid'],
    pan: ['pan'],
    drivingLicence: ['driving licence', 'driving license', 'licence', 'license', 'dl'],
    voterId: ['voter id', 'voter', 'epic'],
    passport: ['passport'],
    rationCard: ['ration'],
  };

  /// Reads a stored `"<type> <number>"` string.
  ///
  /// "Aadhaar 1234-5678-9012" → (Aadhaar Card, '', '1234-5678-9012')
  /// "PANCARD ABCDE1234F"     → (PAN Card, '', 'ABCDE1234F')
  /// "Army ID 99213"          → (Other, 'Army ID', '99213')
  /// "1234-5678-9012"         → ('', '', '1234-5678-9012')
  static IdProof parse(String stored) {
    final s = stored.trim();
    if (s.isEmpty) return const IdProof();

    for (final entry in _aliases.entries) {
      for (final alias in entry.value) {
        // The name of the document, and the "card"/"no." people often
        // add after it - but NOT the separator or the number, because
        // a PAN number starts with letters of its own.
        final head = RegExp(
          '^${RegExp.escape(alias)}' r'(\s*(card|no\.?|number|#))?',
          caseSensitive: false,
        ).firstMatch(s);
        if (head == null) continue;
        // It has to be a whole word: "PAN ABCDE1234F" is a PAN card,
        // "Pandey" is somebody's name.
        if (head.end < s.length && RegExp('[A-Za-z]').hasMatch(s[head.end])) {
          continue;
        }
        final number =
            s.substring(head.end).replaceFirst(RegExp(r'^\s*[:\-]?\s*'), '').trim();
        return IdProof(type: entry.key, number: number);
      }
    }

    // Something else was typed. Keep the words as the type and the
    // digits as the number, rather than throwing either away.
    final split =
        RegExp(r'^([A-Za-z][A-Za-z .]*?)\s*[:\-]?\s*([0-9].*)$').firstMatch(s);
    if (split != null) {
      return IdProof(
        type: other,
        customType: split.group(1)!.trim(),
        number: split.group(2)!.trim(),
      );
    }
    // No letters at all: a number nobody said the type of.
    if (!RegExp('[A-Za-z]').hasMatch(s)) return IdProof(number: s);
    return IdProof(type: other, customType: s);
  }

  /// Writes the single-string form back. Empty when nothing was given.
  static String combine(String type, String number) {
    final t = type.trim();
    final n = number.trim();
    if (t.isEmpty) return n;
    if (n.isEmpty) return t;
    return '$t $n';
  }
}

/// One parsed identity document.
class IdProof {
  /// A value from [IdProofTypes.values], or '' when none was recorded.
  final String type;

  /// What the customer actually showed when [type] is
  /// [IdProofTypes.other] - e.g. "Army ID". Empty otherwise.
  final String customType;

  final String number;

  const IdProof({this.type = '', this.customType = '', this.number = ''});

  /// The type as it should print: the custom name when there is one.
  String get effectiveType =>
      type == IdProofTypes.other && customType.isNotEmpty ? customType : type;

  /// The single-string form, e.g. "Aadhaar Card 1234-5678-9012".
  String get combined => IdProofTypes.combine(effectiveType, number);
}
