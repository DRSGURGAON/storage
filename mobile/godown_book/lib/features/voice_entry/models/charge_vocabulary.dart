/// The charges a packer-and-mover or a godown actually names out loud,
/// and the wording that should appear on the bill or the quotation.
///
/// The operator says "mazdoori paanch sau"; the bill line reads
/// *Labour - Rs 500*.
class ChargeVocabulary {
  const ChargeVocabulary._();

  static const phrases = <String, String>{
    'gas cutting': 'Gas Cutting',
    'car carrier': 'Car Carrier',
    'godown rent': 'Storage Charge',
    'storage charge': 'Storage Charge',
    'late fee': 'Late Fee',
    'entry charge': 'Entry Charge',
    'toll tax': 'Toll & Tax',
    'octroi tax': 'Toll & Tax',
    'service charge': 'Service Charge',
    'transit insurance': 'Insurance',
  };

  static const words = <String, String>{
    'storage': 'Storage Charge',
    'kiraya': 'Storage Charge',
    'godam': 'Storage Charge',
    'भंडारण': 'Storage Charge',
    'labour': 'Labour',
    'labor': 'Labour',
    'mazdoori': 'Labour',
    'majdoori': 'Labour',
    'hamali': 'Labour',
    'palledari': 'Labour',
    'coolie': 'Labour',
    'मजदूरी': 'Labour',
    'transport': 'Transport',
    'freight': 'Transport',
    'cartage': 'Transport',
    'dhulai': 'Transport',
    'bhada': 'Transport',
    'ट्रांसपोर्ट': 'Transport',
    'ढुलाई': 'Transport',
    'packing': 'Packing',
    'paiking': 'Packing',
    'packaging': 'Packing',
    'पैकिंग': 'Packing',
    'unpacking': 'Unpacking',
    'loading': 'Loading',
    'chadhai': 'Loading',
    'चढ़ाई': 'Loading',
    'unloading': 'Unloading',
    'utrai': 'Unloading',
    'utarai': 'Unloading',
    'उतराई': 'Unloading',
    'handling': 'Handling',
    'insurance': 'Insurance',
    'bima': 'Insurance',
    'बीमा': 'Insurance',
    'penalty': 'Late Fee',
    'jurmana': 'Late Fee',
    'जुर्माना': 'Late Fee',
    'toll': 'Toll & Tax',
    'octroi': 'Toll & Tax',
    'demurrage': 'Demurrage',
    'crane': 'Crane',
    'dismantling': 'Dismantling',
    'refixing': 'Refixing',
  };

  static String? lookup(String word) => words[word];

  static String? lookupPhrase(String first, String second) =>
      phrases['$first $second'];
}
