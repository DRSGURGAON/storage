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
    'If rent remains unpaid for 90 days after a written notice, the '
        'godown reserves the right to dispose of the goods to recover '
        'its dues.',
    'Any dispute is subject to the jurisdiction of the courts at the '
        'place where the godown is located.',
  ];

  static const String footer =
      'This is a computer-generated document.  '
      'SAVE PAPER - SAVE TREES | BE DIGITAL - GO GREEN';
}
