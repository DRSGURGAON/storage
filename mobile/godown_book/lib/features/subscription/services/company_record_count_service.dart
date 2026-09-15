import 'package:cloud_firestore/cloud_firestore.dart';

/// How many records a company has made, counted straight out of its
/// cloud backup.
///
/// WHY A COUNT AND NOT A COUNTER: the app already keeps a
/// demo-generation counter per document type, but that one exists to
/// enforce the free-copy limit, so it stops moving the moment a company
/// subscribes - which is exactly when the platform owner most wants to
/// know how much the app is being used. It also counts PDF views, not
/// records. This reads the real number of rows in the company's own
/// backup (companies/{uid}/{table}) with Firestore's count aggregation,
/// so nothing extra is written from the customer's phone, a paying
/// company is counted the same as a free one, and opening the same
/// quotation twice is still one quotation.
///
/// WHAT IT DELIBERATELY DOES NOT DO: it never reads a single row. A
/// count aggregation returns a number and nothing else, so a Super
/// Admin sees how many bills exist without seeing whose they are or
/// what they are for. The details stay in Firestore for the rare case
/// they are genuinely needed.
///
/// HONEST LIMIT: these are backed-up rows, not rows on the phone. A
/// company whose app has not been online since its last few documents
/// will read low until its next backup pass.
class CompanyRecordCounts {
  /// Document tables, in the order the screen shows them.
  final Map<String, int> documents;

  /// Masters kept for context - a big customer list with no documents
  /// says something different from an empty account.
  final Map<String, int> masters;

  const CompanyRecordCounts({
    this.documents = const {},
    this.masters = const {},
  });

  int get totalDocuments =>
      documents.values.fold(0, (running, value) => running + value);

  bool get isEmpty => totalDocuments == 0 && masters.values.every((v) => v == 0);
}

class CompanyRecordCountService {
  CompanyRecordCountService._();

  static final CompanyRecordCountService instance =
      CompanyRecordCountService._();

  /// Tests point this at a FakeFirebaseFirestore; production leaves it
  /// null and talks to FirebaseFirestore.instance.
  static FirebaseFirestore? firestoreOverride;

  /// The tables that hold one document each, with the name the Super
  /// Admin knows them by. Line-item tables (quotation_lines,
  /// booking_items, invoice_charges, release_items,
  /// consignment_items) are deliberately absent: they would inflate
  /// "how many documents" with rows nobody ever printed.
  static const Map<String, String> documentTables = {
    'quotations': 'Quotations',
    'storage_bookings': 'Storage records',
    'goods_releases': 'Releases',
    'invoices': 'Bills',
    'payments': 'Receipts',
    'consignments': 'Bilties',
    'notices': 'Notices',
    'incidents': 'Damage reports',
  };

  static const Map<String, String> masterTables = {
    'customers': 'Customers',
    'storage_locations': 'Storage locations',
  };

  static const Duration _timeout = Duration(seconds: 15);

  FirebaseFirestore get _firestore =>
      firestoreOverride ?? FirebaseFirestore.instance;

  /// Counts every table for one company, addressed by the OWNER UID -
  /// the backup lives under the owner's uid, not under the company id
  /// (DocumentCloudSyncService), and SubscriptionModel.ownerUid is
  /// where that uid is recorded.
  ///
  /// Throws when the owner uid is unknown or Firestore refuses, so the
  /// screen can say so instead of showing a page of confident zeroes.
  Future<CompanyRecordCounts> forOwner(String ownerUid) async {
    final uid = ownerUid.trim();
    if (uid.isEmpty) {
      throw ArgumentError(
        'This company has no owner uid recorded, so its backup cannot '
        'be located.',
      );
    }

    final documents = await _countAll(uid, documentTables.keys);
    final masters = await _countAll(uid, masterTables.keys);

    return CompanyRecordCounts(documents: documents, masters: masters);
  }

  Future<Map<String, int>> _countAll(
    String uid,
    Iterable<String> tables,
  ) async {
    final counts = <String, int>{};

    // One aggregation per table, run together - each is a single small
    // request, and a company detail screen should not open eight round
    // trips deep.
    final results = await Future.wait(
      tables.map((table) => _count(uid, table)),
    );

    var index = 0;
    for (final table in tables) {
      counts[table] = results[index];
      index += 1;
    }

    return counts;
  }

  Future<int> _count(String uid, String table) async {
    final snapshot = await _firestore
        .collection('companies')
        .doc(uid)
        .collection(table)
        .count()
        .get()
        .timeout(_timeout);

    return snapshot.count ?? 0;
  }
}
