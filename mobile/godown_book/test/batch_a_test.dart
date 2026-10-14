import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/cloud_sync/document_cloud_sync_service.dart';
import 'package:godown_book/core/errors/delete_blocked_exception.dart';
import 'package:godown_book/core/tenant/tenant_scope.dart';
import 'package:godown_book/core/utils/number_format.dart';
import 'package:godown_book/features/storage_booking/repositories/storage_booking_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

void main() {
  test('amounts read the Indian way', () {
    expect(formatMoney(125000), '1,25,000.00');
    expect(formatMoney(-4500.5), '-4,500.50');
    expect(formatMoney(999), '999.00');
    expect(formatRupees(1250000), '₹ 12,50,000');
    expect(formatRupees(1250.5), '₹ 1,250.50');
    expect(formatRate(9), '9');
    expect(formatRate(2.5), '2.5');
  });

  group('a storage with documents cannot be deleted', () {
    late Database db;

    setUp(() async => db = await openTestDatabase());
    tearDown(() async => db.close());

    test('it names what still points at it', () async {
      await db.insert('invoices', {
        'id': 'bill-1',
        'company_id': TenantScope.companyId,
        'invoice_no': 'SB/1',
        'invoice_date': '2026-10-01',
        'booking_id': 'booking-1',
        'customer_name': 'Rajesh',
        'created_at': '2026-10-01',
      });

      final repo = StorageBookingRepository.instance;
      expect(await repo.linkedDocuments('booking-1'), '1 bill');
      expect(await repo.linkedDocuments('booking-2'), '');
      await expectLater(
        repo.delete('booking-1'),
        throwsA(isA<DeleteBlockedException>()),
      );
    });
  });

  group('restore merges row by row', () {
    late Database db;
    late FakeFirebaseFirestore cloud;

    setUp(() async {
      db = await openTestDatabase();
      cloud = FakeFirebaseFirestore();
      DocumentCloudSyncService.firestoreOverride = cloud;
      DocumentCloudSyncService.currentUidOverride = 'uid-1';
    });
    tearDown(() async {
      DocumentCloudSyncService.firestoreOverride = null;
      DocumentCloudSyncService.currentUidOverride = null;
      await db.close();
    });

    Map<String, Object?> bill(String id, String no, String name) => {
          'id': id,
          'company_id': TenantScope.companyId,
          'invoice_no': no,
          'invoice_date': '2026-10-01',
          'customer_name': name,
          'created_at': '2026-10-01',
        };

    test('a cloud row never deletes a different local document', () async {
      // On this phone: bill SB/1 made offline with its own id.
      await db.insert('invoices', bill('local-1', 'SB/1', 'Local customer'));
      // In the cloud: another document with the same number, an updated
      // copy of a bill this phone has, and a new one.
      await db.insert('invoices', bill('shared-2', 'SB/2', 'Old name'));
      final table = cloud.collection('companies').doc('uid-1').collection('invoices');
      await table.doc('cloud-1').set(bill('cloud-1', 'SB/1', 'Cloud customer'));
      await table.doc('shared-2').set(bill('shared-2', 'SB/2', 'New name'));
      await table.doc('cloud-3').set(bill('cloud-3', 'SB/3', 'Brand new'));

      final result = await DocumentCloudSyncService.instance.restoreFromCloud(
        uid: 'uid-1',
        companyId: TenantScope.companyId,
      );

      expect(result.error, isNull);
      expect(result.restored, 2);
      expect(result.skipped, 1);

      final rows = {
        for (final r in await db.query('invoices')) r['id']: r['customer_name'],
      };
      expect(rows['local-1'], 'Local customer');
      expect(rows.containsKey('cloud-1'), isFalse);
      expect(rows['shared-2'], 'New name');
      expect(rows['cloud-3'], 'Brand new');
    });
  });
}
