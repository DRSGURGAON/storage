/// Standard terms printed on every document when the company has not
/// set its own in Company Settings or under Customise Documents.
///
/// These are written to the law the paper actually lives under:
///
/// - Storage is a bailment under the Indian Contract Act, 1872
///   (sections 148 to 171): the godown must take the care a prudent
///   person takes of their own goods (s.151), is not liable for loss
///   despite that care (s.152), and may keep the goods until its
///   charges are paid (s.170). A general lien over all of a customer's
///   goods, and a right to sell after notice, exist only by contract -
///   so the terms say so in plain words.
/// - A clause that takes away every remedy is an "unfair contract term"
///   under the Consumer Protection Act, 2019 (s.2(46)) and can be set
///   aside; the liability clause therefore limits, it does not exclude.
/// - Interest on late payment is a pre-estimate of loss under s.74 of
///   the Contract Act and has to be reasonable; the default is 18% a
///   year, simple, which the operator can edit.
/// - GST is charged on storage and warehousing under SAC 996729 at the
///   applicable rate, on the tax invoice, with the particulars Rule 46
///   of the CGST Rules, 2017 requires.
/// - Goods on a truck travel under the Carriage by Road Act, 2007 and
///   the Rules of 2011: the goods receipt is the carrier's document
///   (s.8), liability is set by ss.10-11, and a claim must be notified
///   within 180 days (s.16).
class DefaultStorageTerms {
  DefaultStorageTerms._();

  /// The storage receipt and the storage agreement.
  static const List<String> terms = [
    'The goods are accepted for storage as a bailment under the Indian '
        'Contract Act, 1872. They are received on the basis of the count '
        'and description declared by the depositor; the contents of sealed '
        'or packed items have not been verified.',
    'Storage rent is payable monthly in advance, on or before the date '
        'shown on each bill. Part of a month is charged as a full month '
        'unless agreed otherwise in writing. GST at the applicable rate is '
        'charged in addition to the rent where the godown is registered '
        'under GST.',
    'Rent not paid within 7 days of its due date carries simple interest '
        'at 18% per annum from the due date until payment.',
    'The security deposit, where taken, is held without interest, may be '
        'applied against any amount due, and the balance is refundable when '
        'the goods are collected and all dues are cleared.',
    'Goods will be released only against this receipt, or to a person '
        'authorised in writing by the depositor and identified by a valid '
        'photo ID, after all dues are cleared. Release is recorded on a '
        'signed release record.',
    'The godown will take the same care of the goods as a person of '
        'ordinary prudence takes of their own goods of the same kind. '
        'Subject to that, it is not responsible for loss or damage caused by '
        'fire, flood, earthquake, theft, riot, pests, natural deterioration, '
        'inherent defect, or any cause beyond its control. The depositor is '
        'advised to insure the goods; the godown does not insure them unless '
        'stated on this document.',
    'The godown\'s liability for any loss or damage, however arising, is '
        'limited to the lower of the actual loss and the value declared by '
        'the depositor on this document, unless a higher cover has been '
        'agreed separately in writing and charged for.',
    'Hazardous, inflammable, explosive, perishable, illegal or '
        'contraband goods, livestock, firearms and drugs are not accepted. '
        'Cash, jewellery, bullion, securities and important documents must '
        'not be stored, and the godown accepts no liability for them if '
        'they are.',
    'The godown has a lien on the goods for every amount due to it under '
        'this and any other storage record of the same depositor, and may '
        'retain the goods until those amounts, together with the costs of '
        'storage during retention, are paid in full.',
    'If rent remains unpaid for 90 days after a written notice giving a '
        'date by which it must be paid, sent to the address and mobile '
        'number given on this document, the godown may sell the goods by '
        'public auction or private sale to recover its dues. Whatever is '
        'recovered over and above the dues and the costs of sale will be '
        'paid to the depositor, and any shortfall will remain payable by '
        'them.',
    'Goods that are left uncollected, with the rent unpaid and the '
        'depositor not reachable after two written notices sent 30 days '
        'apart, will be treated as abandoned and dealt with as provided '
        'above.',
    'The depositor may inspect the goods during working hours on one '
        'working day\'s notice. Handling or repacking on such a visit is '
        'chargeable.',
    'This is a contract for the storage of goods only. No part of the '
        'godown is let out, the depositor gets no possession of, or any '
        'interest in, the premises, and nothing in this document creates a '
        'tenancy.',
    'This receipt is not a negotiable warehouse receipt under the '
        'Warehousing (Development and Regulation) Act, 2007, is not a '
        'document of title, and cannot be pledged or transferred by '
        'endorsement.',
    'A copy of the depositor\'s ID proof is kept only to verify identity '
        'at release and is not shared with anyone else. It is retained '
        'with this storage record for as long as the record is kept.',
    'Notices will be sent to the address, mobile number and email given '
        'by the depositor on this document, and will be treated as '
        'received. Any change must be informed in writing.',
    'Neither party is liable for delay or failure caused by events beyond '
        'its reasonable control, but rent continues to accrue while the '
        'goods remain in the godown.',
    'Any dispute will first be referred to the godown\'s proprietor for '
        'settlement within 30 days, failing which it is subject to the '
        'exclusive jurisdiction of the courts at the place where the godown '
        'is located. Nothing here takes away the depositor\'s rights under '
        'the Consumer Protection Act, 2019.',
  ];

  /// The storage receipt is one page the customer signs at the door, so
  /// it carries the terms that matter at the door, and says that the
  /// full terms are the agreement's. Every line here is a shortened
  /// clause of [terms], never a different one.
  static const List<String> storageReceiptTerms = [
    'Goods are accepted for storage as a bailment under the Indian '
        'Contract Act, 1872, on the count and description declared by the '
        'depositor; contents of packed items are not verified.',
    'Rent is payable monthly in advance; part of a month is a full month. '
        'GST at the applicable rate is extra where the godown is registered. '
        'Rent unpaid 7 days after its due date carries simple interest at '
        '18% per annum.',
    'Goods are released only against this receipt, or to a person '
        'authorised in writing and identified by a valid photo ID, after all '
        'dues are cleared.',
    'The godown takes the care a prudent person takes of their own goods '
        'and, subject to that, is not liable for loss by fire, flood, theft, '
        'pests, natural deterioration or any cause beyond its control. Goods '
        'are not insured by the godown; the depositor is advised to insure.',
    'Liability for any loss or damage is limited to the lower of the '
        'actual loss and the declared value on this receipt.',
    'Hazardous, inflammable, perishable or illegal goods are not accepted. '
        'Cash, jewellery, bullion and important documents must not be '
        'stored.',
    'The godown has a lien on the goods for all amounts due, and may sell '
        'them after 90 days\' written notice of unpaid rent to recover its '
        'dues, paying any surplus to the depositor.',
    'This is a contract for storage of goods only; it creates no tenancy. '
        'This receipt is not a negotiable warehouse receipt, not a document '
        'of title, and cannot be pledged or endorsed.',
    'Notices sent to the address and mobile number given here are treated '
        'as received. Disputes are subject to the courts where the godown is '
        'located, without prejudice to the Consumer Protection Act, 2019.',
    'The full terms are those of the Storage Agreement for this receipt '
        'number, which forms part of this receipt.',
  ];

  /// What a quotation says when the company has set no terms of its own.
  static const List<String> quotationTerms = [
    'This quotation is valid till the date shown above; rates are '
        'subject to revision after that, and on any change in the volume, '
        'route, date or scope quoted.',
    'This is a quotation, not a tax invoice. GST at the applicable rate '
        '(storage and warehousing SAC 996729; transport of used household '
        'goods SAC 996511; packing SAC 998540) is charged in addition '
        'unless shown as included above.',
    'Rates cover the services listed above only. Anything marked '
        'Excluded or N/A is not part of this price. Toll, parking, entry '
        'permits, society charges, octroi and any statutory levy are '
        'payable at actuals unless stated otherwise.',
    'Storage rent is payable monthly in advance. Part of a month is '
        'charged as a full month unless agreed otherwise in writing.',
    'Payment terms: 50% advance on confirmation, balance before the goods '
        'are released or delivered, unless stated otherwise above. Work '
        'starts on receipt of the advance.',
    'Goods move and are stored at the owner\'s risk. Transit or storage '
        'insurance is arranged only on request, at the declared value, and '
        'charged separately.',
    'Cash, jewellery, important documents and hazardous, inflammable, '
        'perishable or illegal goods are not accepted.',
    'Loading, unloading and handling charges apply each time goods are '
        'taken into or out of storage, unless stated otherwise above. '
        'Floor, lift and distance from the vehicle affect labour and are '
        'charged as quoted or at actuals.',
    'Cancellation less than 48 hours before the scheduled date is '
        'chargeable at 25% of the quoted amount, or the advance paid, '
        'whichever is lower.',
    'Any shortage or damage must be noted on the delivery paper at the '
        'time of delivery and claimed in writing within 7 days.',
    'All dues must be cleared before goods are released. Any dispute is '
        'subject to the jurisdiction of the courts at the place where the '
        'godown is located.',
  ];

  /// What a storage bill says when the company has set no terms.
  static const List<String> billTerms = [
    'Payment is due on or before the due date shown. Rent not paid '
        'within 7 days of the due date carries simple interest at 18% per '
        'annum from the due date until payment.',
    'GST, where charged, is on storage and warehousing services under SAC '
        '996729 at the rate shown. Tax is not payable on reverse charge.',
    'Pay by UPI or bank transfer to the account printed on this bill, '
        'quoting the bill number. A cheque is subject to realisation.',
    'The goods remain under the godown\'s lien until this bill and all '
        'earlier dues are paid in full, and will not be released before '
        'that.',
    'Any error in this bill must be reported within 7 days of its date; '
        'after that it is treated as accepted. Errors and omissions '
        'excepted.',
    'Subject to the jurisdiction of the courts at the place where the '
        'godown is located.',
  ];

  /// What a payment receipt says when the company has set no terms.
  static const List<String> receiptTerms = [
    'A receipt for a cheque or an online transfer is valid only on '
        'realisation of the amount.',
    'The balance shown is as per our records on the date of this receipt; '
        'the customer statement is the full account.',
    'A cash receipt for more than Rs. 5,000 bears a one-rupee revenue '
        'stamp, as required by the Indian Stamp Act, 1899.',
  ];

  /// The bilty / lorry receipt. [ownersRisk] picks the risk line.
  static List<String> lorryReceiptTerms({required bool ownersRisk}) => [
        'This goods receipt is issued under section 8 of the Carriage by '
            'Road Act, 2007. Goods are accepted on the basis of the count and '
            'description declared by the consignor in the goods forwarding '
            'note; the contents of packed items have not been checked.',
        ownersRisk
            ? 'Goods travel at the owner\'s risk. The carrier\'s liability for '
                'loss, damage or non-delivery is limited as provided in '
                'sections 10 and 11 of the Carriage by Road Act, 2007, and in '
                'no case exceeds the value declared on this receipt. The goods '
                'are not insured by the carrier unless stated above.'
            : 'Goods travel at the carrier\'s risk as agreed above, to the '
                'extent of the value declared on this receipt, subject to '
                'sections 10 and 11 of the Carriage by Road Act, 2007.',
        'The consignor declares that the consignment contains no dangerous '
            'or hazardous goods (section 12) and consists of used personal and '
            'household effects, for which no e-way bill is required.',
        'Delivery will be given to the consignee named above, or to a person '
            'authorised by them in writing and identified by a valid photo ID, '
            'after freight and other charges are paid. The carrier has a lien '
            'on the goods for those charges.',
        'Any shortage or damage must be noted on this receipt at the time of '
            'delivery. A claim for loss, damage or non-delivery must be '
            'notified to the carrier in writing within 180 days of the date '
            'of this receipt, as required by section 16 of the Act.',
        'Goods not taken delivery of within 7 days of arrival attract '
            'demurrage and storage charges, and may be dealt with as provided '
            'in section 17 of the Act after notice to the consignor.',
        'Subject to the jurisdiction of the courts at the place of booking.',
      ];

  static const String footer =
      'This is a computer-generated document.  '
      'SAVE PAPER - SAVE TREES | BE DIGITAL - GO GREEN';
}
