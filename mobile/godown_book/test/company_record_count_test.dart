import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/features/subscription/services/company_record_count_service.dart';

/// What the Super Admin is allowed to learn about a subscriber: how
/// many documents they have made, and nothing about what is in them.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late FakeFirebaseFirestore cloud;

  setUp(() {
    cloud = FakeFirebaseFirestore();
    CompanyRecordCountService.firestoreOverride = cloud;
  });

  tearDown(() {
    CompanyRecordCountService.firestoreOverride = null;
  });

  Future<void> seed(String uid, String table, int rows) async {
    for (var i = 0; i < rows; i++) {
      await cloud
          .collection('companies')
          .doc(uid)
          .collection(table)
          .doc('$table-$i')
          .set({'id': '$table-$i', 'company_id': 'company-a'});
    }
  }

  test('counts each document table under the owner uid', () async {
    await seed('uid-a', 'quotations', 3);
    await seed('uid-a', 'invoices', 2);
    await seed('uid-a', 'customers', 5);

    final counts = await CompanyRecordCountService.instance.forOwner('uid-a');

    expect(counts.documents['quotations'], 3);
    expect(counts.documents['invoices'], 2);
    expect(counts.documents['notices'], 0);
    expect(counts.masters['customers'], 5);
    expect(counts.totalDocuments, 5);
    expect(counts.isEmpty, isFalse);
  });

  test('line rows never inflate the document total', () async {
    await seed('uid-a', 'quotations', 1);
    await seed('uid-a', 'quotation_lines', 40);
    await seed('uid-a', 'invoice_charges', 12);

    final counts = await CompanyRecordCountService.instance.forOwner('uid-a');

    expect(counts.totalDocuments, 1);
    expect(counts.documents.containsKey('quotation_lines'), isFalse);
  });

  test('one company never counts another', () async {
    await seed('uid-a', 'quotations', 3);
    await seed('uid-b', 'quotations', 9);

    final a = await CompanyRecordCountService.instance.forOwner('uid-a');
    final b = await CompanyRecordCountService.instance.forOwner('uid-b');

    expect(a.documents['quotations'], 3);
    expect(b.documents['quotations'], 9);
  });

  test('a company that has never backed up reads as empty, not as zero rows',
      () async {
    final counts = await CompanyRecordCountService.instance.forOwner('uid-new');

    expect(counts.isEmpty, isTrue);
    expect(counts.totalDocuments, 0);
  });

  test('a subscription with no owner uid says so instead of showing zeroes',
      () async {
    expect(
      () => CompanyRecordCountService.instance.forOwner('   '),
      throwsArgumentError,
    );
  });
}
