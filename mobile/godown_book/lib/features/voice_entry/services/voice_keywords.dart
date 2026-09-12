/// The words an operator uses for each fact, in Hinglish, English and
/// Devanagari. Kept in one place because a bill, a payment and a
/// storage entry all listen for many of the same ones.
class VoiceKeywords {
  const VoiceKeywords._();

  static const rent = {
    'kiraya', 'kiraaya', 'kiray', 'kiraye', 'rent', 'bhada', 'bhade',
    'mahina', 'mahine', 'maheena', 'month', 'monthly', 'permonth',
    'किराया', 'किराये', 'भाड़ा', 'महीना', 'महीने',
  };
  static const daily = {
    'din', 'dinka', 'daily', 'day', 'perday', 'roz', 'rozana', 'दिन', 'रोज',
  };
  static const perBox = {
    'perbox', 'pratibox', 'prati', 'perpiece', 'perpetti',
  };
  static const advance = {
    'advance', 'edvans', 'adwans', 'jama', 'peshgi', 'baayana', 'bayana',
    'एडवांस', 'जमा', 'पेशगी',
  };
  static const security = {
    'deposit', 'security', 'sikyoriti', 'सिक्योरिटी', 'डिपॉजिट',
  };

  /// The storage form has one box for both, so it listens for either.
  static const deposit = {...advance, ...security};
  static const declaredValue = {
    'value', 'keemat', 'kimat', 'kimmat', 'declared', 'cost', 'worth',
    'कीमत', 'मूल्य',
  };
  static const city = {'shehar', 'sheher', 'city', 'शहर'};

  // ------------------------------------------------------------- payments

  static const received = {
    'mila', 'mile', 'aaya', 'aaye', 'received', 'liya', 'liye', 'diya',
    'payment', 'bhugtan', 'मिला', 'आया', 'लिया', 'भुगतान',
  };
  static const cash = {'cash', 'nakad', 'nagad', 'kaish', 'नकद', 'कैश'};
  static const upi = {
    'upi', 'gpay', 'googlepay', 'phonepe', 'paytm', 'bhim', 'online',
    'scan', 'qr', 'यूपीआई', 'ऑनलाइन',
  };
  static const bank = {
    'bank', 'neft', 'rtgs', 'imps', 'transfer', 'khaate', 'khate',
    'बैंक', 'ट्रांसफर',
  };
  static const cheque = {'cheque', 'check', 'chek', 'चेक'};
  static const card = {'card', 'swipe', 'debit', 'credit', 'कार्ड'};
  static const fullPayment = {'poora', 'pura', 'full', 'complete', 'पूरा'};
  static const partPayment = {
    'aadha', 'adha', 'part', 'partial', 'kuch', 'thoda', 'आधा', 'कुछ',
  };
  static const refund = {'wapas', 'refund', 'return', 'lauta', 'वापस'};
  static const referenceWords = {
    'reference', 'ref', 'utr', 'transaction', 'chequeno', 'txn', 'id',
    'रेफरेंस',
  };

  // ----------------------------------------------------------------- bill

  static const discount = {
    'discount', 'chhoot', 'chhut', 'kam', 'katauti', 'छूट', 'कटौती',
  };
  // Deliberately not "tax" - "toll tax" is a charge head, not a rate.
  static const gst = {'gst', 'jeeesti', 'जीएसटी'};
  static const percentWords = {'percent', 'pratishat', '%', 'प्रतिशत'};

  // ------------------------------------------------------------ quotation

  static const moveWords = {
    'shifting', 'shift', 'move', 'moving', 'nikalna', 'jaana', 'शिफ्टिंग',
  };
}
