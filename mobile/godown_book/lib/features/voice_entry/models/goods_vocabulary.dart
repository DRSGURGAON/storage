/// The things people actually keep in a household godown, in the words
/// they use for them - and the English name that should end up printed
/// on the inventory list.
///
/// The operator says "do palang aur ek godrej ki almari"; the receipt
/// has to read "Bed - 2" and "Almirah - 1".
class GoodsVocabulary {
  const GoodsVocabulary._();

  /// Two-word names are checked before single words, so "washing
  /// machine" never gets read as a machine of unknown kind.
  static const phrases = <String, GoodsTerm>{
    'washing machine': GoodsTerm('Washing Machine'),
    'silai machine': GoodsTerm('Sewing Machine'),
    'sewing machine': GoodsTerm('Sewing Machine'),
    'सिलाई मशीन': GoodsTerm('Sewing Machine'),
    'वाशिंग मशीन': GoodsTerm('Washing Machine'),
    'dressing table': GoodsTerm('Dressing Table'),
    'dining table': GoodsTerm('Dining Table'),
    'study table': GoodsTerm('Study Table'),
    'center table': GoodsTerm('Center Table'),
    'centre table': GoodsTerm('Center Table'),
    'double bed': GoodsTerm('Double Bed'),
    'single bed': GoodsTerm('Single Bed'),
    'sofa set': GoodsTerm('Sofa Set'),
    'gas chulha': GoodsTerm('Gas Stove'),
    'gas cylinder': GoodsTerm('Gas Cylinder'),
    'water purifier': GoodsTerm('Water Purifier'),
    'sewing box': GoodsTerm('Sewing Box'),
    'book shelf': GoodsTerm('Book Shelf'),
    'shoe rack': GoodsTerm('Shoe Rack'),
    'godrej almari': GoodsTerm('Steel Almirah'),
    'steel almari': GoodsTerm('Steel Almirah'),
  };

  /// Single words. [unit] is what the printed line should be counted in.
  static const words = <String, GoodsTerm>{
    'almari': GoodsTerm('Almirah'),
    'almirah': GoodsTerm('Almirah'),
    'almara': GoodsTerm('Almirah'),
    'cupboard': GoodsTerm('Almirah'),
    'wardrobe': GoodsTerm('Wardrobe'),
    'अलमारी': GoodsTerm('Almirah'),
    'godrej': GoodsTerm('Steel Almirah'),
    'गोदरेज': GoodsTerm('Steel Almirah'),
    'palang': GoodsTerm('Bed'),
    'bed': GoodsTerm('Bed'),
    'palanga': GoodsTerm('Bed'),
    'पलंग': GoodsTerm('Bed'),
    'diwan': GoodsTerm('Diwan'),
    'दीवान': GoodsTerm('Diwan'),
    'gadda': GoodsTerm('Mattress'),
    'gadde': GoodsTerm('Mattress'),
    'mattress': GoodsTerm('Mattress'),
    'गद्दा': GoodsTerm('Mattress'),
    'गद्दे': GoodsTerm('Mattress'),
    'rajai': GoodsTerm('Quilt'),
    'razai': GoodsTerm('Quilt'),
    'quilt': GoodsTerm('Quilt'),
    'रजाई': GoodsTerm('Quilt'),
    'sofa': GoodsTerm('Sofa'),
    'सोफा': GoodsTerm('Sofa'),
    'kursi': GoodsTerm('Chair'),
    'kursiyan': GoodsTerm('Chair'),
    'chair': GoodsTerm('Chair'),
    'कुर्सी': GoodsTerm('Chair'),
    'कुर्सियां': GoodsTerm('Chair'),
    'mez': GoodsTerm('Table'),
    'table': GoodsTerm('Table'),
    'मेज': GoodsTerm('Table'),
    'fridge': GoodsTerm('Refrigerator'),
    'refrigerator': GoodsTerm('Refrigerator'),
    'फ्रिज': GoodsTerm('Refrigerator'),
    'tv': GoodsTerm('Television'),
    'television': GoodsTerm('Television'),
    'टीवी': GoodsTerm('Television'),
    'ac': GoodsTerm('Air Conditioner'),
    'cooler': GoodsTerm('Cooler'),
    'कूलर': GoodsTerm('Cooler'),
    'pankha': GoodsTerm('Fan'),
    'fan': GoodsTerm('Fan'),
    'पंखा': GoodsTerm('Fan'),
    'geyser': GoodsTerm('Geyser'),
    'gizer': GoodsTerm('Geyser'),
    'microwave': GoodsTerm('Microwave'),
    'oven': GoodsTerm('Oven'),
    'inverter': GoodsTerm('Inverter'),
    'battery': GoodsTerm('Battery'),
    'computer': GoodsTerm('Computer'),
    'laptop': GoodsTerm('Laptop'),
    'printer': GoodsTerm('Printer'),
    'mandir': GoodsTerm('Temple Unit'),
    'मंदिर': GoodsTerm('Temple Unit'),
    'jhula': GoodsTerm('Swing'),
    'sandook': GoodsTerm('Trunk'),
    'trunk': GoodsTerm('Trunk'),
    'संदूक': GoodsTerm('Trunk'),
    'suitcase': GoodsTerm('Suitcase'),
    'attachi': GoodsTerm('Suitcase'),
    'cycle': GoodsTerm('Bicycle'),
    'साइकिल': GoodsTerm('Bicycle'),
    'scooter': GoodsTerm('Scooter'),
    'scooty': GoodsTerm('Scooter'),
    'bike': GoodsTerm('Motorcycle'),
    'motorcycle': GoodsTerm('Motorcycle'),
    'bartan': GoodsTerm('Utensils'),
    'crockery': GoodsTerm('Crockery'),
    'बर्तन': GoodsTerm('Utensils'),
    'carton': GoodsTerm('Carton', unit: 'Cartons'),
    'cartons': GoodsTerm('Carton', unit: 'Cartons'),
    'petti': GoodsTerm('Carton', unit: 'Cartons'),
    'peti': GoodsTerm('Carton', unit: 'Cartons'),
    'dabba': GoodsTerm('Carton', unit: 'Cartons'),
    'dabbe': GoodsTerm('Carton', unit: 'Cartons'),
    'box': GoodsTerm('Carton', unit: 'Cartons'),
    'boxes': GoodsTerm('Carton', unit: 'Cartons'),
    'कार्टन': GoodsTerm('Carton', unit: 'Cartons'),
    'पेटी': GoodsTerm('Carton', unit: 'Cartons'),
    'डिब्बा': GoodsTerm('Carton', unit: 'Cartons'),
    'bori': GoodsTerm('Bag', unit: 'Bags'),
    'boriyan': GoodsTerm('Bag', unit: 'Bags'),
    'bag': GoodsTerm('Bag', unit: 'Bags'),
    'bags': GoodsTerm('Bag', unit: 'Bags'),
    'kattha': GoodsTerm('Bag', unit: 'Bags'),
    'बोरी': GoodsTerm('Bag', unit: 'Bags'),
    'बोरियां': GoodsTerm('Bag', unit: 'Bags'),
    'bundle': GoodsTerm('Bundle', unit: 'Bundles'),
    'gattha': GoodsTerm('Bundle', unit: 'Bundles'),
    'बंडल': GoodsTerm('Bundle', unit: 'Bundles'),
    'drum': GoodsTerm('Drum', unit: 'Drums'),
    'ड्रम': GoodsTerm('Drum', unit: 'Drums'),
  };

  static GoodsTerm? lookup(String word) => words[word];

  static GoodsTerm? lookupPhrase(String first, String second) =>
      phrases['$first $second'];
}

class GoodsTerm {
  /// What gets printed on the inventory list.
  final String name;

  /// What it is counted in.
  final String unit;

  const GoodsTerm(this.name, {this.unit = 'Nos'});
}
