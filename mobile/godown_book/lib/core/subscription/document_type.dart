/// Fixed set of document-type identifiers for demo-generation tracking -
/// a plain string constant class (not an enum) so a new document type
/// can be added without a Dart enum migration touching every switch
/// that exhausts it. Every call site references these constants rather
/// than typing the string, so a typo can't silently create a second,
/// unrelated counter for what was meant to be the same document type.
class DocumentType {
  DocumentType._();

  static const warehouseReceipt = 'warehouse_receipt';
  static const inventoryList = 'inventory_list';
  static const storageAgreement = 'storage_agreement';
  static const deliveryOrder = 'delivery_order';
  static const gatePass = 'gate_pass';
  static const bill = 'bill';
  static const moneyReceipt = 'money_receipt';
  static const statement = 'statement';
  static const letterHead = 'letter_head';

  /// Every type, in the order screens list them.
  static const List<String> all = [
    warehouseReceipt,
    inventoryList,
    storageAgreement,
    deliveryOrder,
    gatePass,
    bill,
    moneyReceipt,
    statement,
    letterHead,
  ];

  static String label(String type) => switch (type) {
        warehouseReceipt => 'Warehouse Receipt',
        inventoryList => 'Inventory List',
        storageAgreement => 'Storage Agreement',
        deliveryOrder => 'Delivery Order',
        gatePass => 'Gate Pass',
        bill => 'Rent Bill',
        moneyReceipt => 'Money Receipt',
        statement => 'Customer Statement',
        letterHead => 'Letter Head',
        _ => type,
      };
}
