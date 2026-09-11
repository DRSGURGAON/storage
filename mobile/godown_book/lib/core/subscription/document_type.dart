/// Fixed set of document-type identifiers for free-copy tracking - a
/// plain string constant class (not an enum) so a new document type can
/// be added without a Dart enum migration touching every switch that
/// exhausts it. Every call site references these constants rather than
/// typing the string, so a typo can't silently create a second,
/// unrelated counter for what was meant to be the same document.
///
/// These are the documents a household-goods storage operator actually
/// hands to a customer. Codes are stored in the free-copy counters, so
/// never change an existing one.
class DocumentType {
  DocumentType._();

  static const quotation = 'quotation';
  static const storageAgreement = 'storage_agreement';
  static const storageReceipt = 'storage_receipt';
  static const itemList = 'item_list';
  static const bill = 'bill';
  static const moneyReceipt = 'money_receipt';
  static const statement = 'statement';
  static const releaseRecord = 'release_record';
  static const notice = 'notice';
  static const incidentReport = 'incident_report';
  static const authorityLetter = 'authority_letter';
  static const indemnityBond = 'indemnity_bond';
  static const letterHead = 'letter_head';

  /// Every type, in the order screens list them.
  static const List<String> all = [
    quotation,
    storageAgreement,
    storageReceipt,
    itemList,
    bill,
    moneyReceipt,
    statement,
    releaseRecord,
    notice,
    incidentReport,
    authorityLetter,
    indemnityBond,
    letterHead,
  ];

  static String label(String type) => switch (type) {
        quotation => 'Quotation',
        storageAgreement => 'Storage Agreement',
        storageReceipt => 'Storage Receipt',
        itemList => 'Goods List',
        bill => 'Storage Bill',
        moneyReceipt => 'Payment Receipt',
        statement => 'Customer Statement',
        releaseRecord => 'Release Record',
        notice => 'Notice Letter',
        incidentReport => 'Damage / Loss Report',
        authorityLetter => 'Authority Letter',
        indemnityBond => 'Indemnity Bond',
        letterHead => 'Letter Head',
        _ => type,
      };
}
