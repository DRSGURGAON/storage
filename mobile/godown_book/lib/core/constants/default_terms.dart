/// Standard terms printed on a Warehouse Receipt / Storage Agreement
/// when the company has not set its own in Company Settings or under
/// Customise Documents.
class DefaultStorageTerms {
  DefaultStorageTerms._();

  static const List<String> terms = [
    'Goods are accepted for storage on the basis of the count and '
        'description declared by the depositor; contents of sealed or '
        'packed items have not been verified.',
    'Storage rent is payable monthly in advance. Part of a month is '
        'charged as a full month unless agreed otherwise in writing.',
    'Goods will be released only against this receipt, or to a person '
        'authorised in writing by the depositor, after all dues are '
        'cleared.',
    'The godown is not responsible for loss or damage caused by fire, '
        'flood, theft, pests, natural deterioration or any cause beyond '
        'its control. Depositors are advised to insure their goods.',
    'Hazardous, inflammable, perishable or illegal goods are not '
        'accepted. Cash, jewellery and important documents must not be '
        'stored.',
    'The godown has a lien on the goods for all amounts due to it, and '
        'may keep the goods until those amounts are paid in full.',
    'If rent remains unpaid for 90 days after a written notice giving a '
        'date by which it must be paid, the godown may sell the goods to '
        'a third party to recover its dues. Whatever is recovered over '
        'and above the dues and the costs of sale will be paid to the '
        'depositor, and any shortfall will remain payable by them.',
    'The godown\'s liability for any loss or damage is limited to the '
        'value declared by the depositor on this document, unless a '
        'higher cover has been agreed separately in writing.',
    'This is a contract for storage of goods only. No part of the '
        'godown is let out, and the depositor gets no possession of, or '
        'any interest in, the premises.',
    'Notices will be sent to the address, mobile number and email given '
        'by the depositor on this document, and will be treated as '
        'received. Any change must be informed in writing.',
    'Goods that are left uncollected, with the rent unpaid and the '
        'depositor not reachable after two written notices, will be '
        'treated as abandoned and dealt with as provided above.',
    'Any dispute is subject to the jurisdiction of the courts at the '
        'place where the godown is located.',
  ];

  /// What a quotation says when the company has set no terms of its own.
  static const List<String> quotationTerms = [
    'This quotation is valid till the date shown above; rates are '
        'subject to revision after that.',
    'Storage rent is payable monthly in advance. Part of a month is '
        'charged as a full month unless agreed otherwise in writing.',
    'Rates cover the services listed above only. Anything marked '
        'Excluded or N/A is not part of this price.',
    'Goods move and are stored at the owner\'s risk unless insurance is '
        'arranged separately and confirmed in writing.',
    'Cash, jewellery, important documents and hazardous, inflammable or '
        'perishable goods are not accepted.',
    'Loading, unloading and handling charges apply each time goods are '
        'taken into or out of storage, unless stated otherwise above.',
    'All dues must be cleared before goods are released.',
  ];

  static const String footer =
      'This is a computer-generated document.  '
      'SAVE PAPER - SAVE TREES | BE DIGITAL - GO GREEN';
}
