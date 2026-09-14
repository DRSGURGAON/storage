/// Services Accounting Codes for the services a household-goods godown
/// bills. A tax invoice under Rule 46 of the CGST Rules, 2017 has to
/// carry the SAC of each service, and an operator should never have to
/// look one up: the charge's own name says which it is.
///
/// - 996729  Other storage and warehousing services (storage rent)
/// - 996719  Other cargo and baggage handling (loading, unloading,
///           shifting, handling)
/// - 998540  Packaging services of goods for others (packing)
/// - 996511  Road transport of goods, including household goods
/// - 997139  Other non-life insurance services (transit cover)
class SacCodes {
  SacCodes._();

  static const String storage = '996729';
  static const String handling = '996719';
  static const String packing = '998540';
  static const String transport = '996511';
  static const String insurance = '997139';

  /// The code a charge falls under, from its name. Anything the names
  /// below do not cover is treated as part of the storage service.
  static String forCharge(String chargeName) {
    final name = chargeName.toLowerCase();
    bool has(List<String> words) => words.any(name.contains);

    if (has(['insur'])) return insurance;
    if (has(['transport', 'freight', 'vehicle', 'truck', 'lorry', 'carriage'])) {
      return transport;
    }
    if (has(['pack', 'wrap', 'carton', 'material'])) return packing;
    if (has(['load', 'unload', 'handl', 'shift', 'labour', 'labor', 'lift'])) {
      return handling;
    }
    return storage;
  }

  /// GST state code - the first two digits of a GSTIN - when a GSTIN
  /// is available, else empty. Place of supply prints with it.
  static String stateCodeOf(String gstin) {
    final g = gstin.trim();
    if (g.length < 2) return '';
    final code = g.substring(0, 2);
    return int.tryParse(code) == null ? '' : code;
  }
}
