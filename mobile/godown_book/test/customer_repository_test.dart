import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/customer/customer_lookup_service.dart';
import 'package:godown_book/features/customers/models/customer_model.dart';
import 'package:godown_book/features/customers/repositories/customer_repository.dart';
import 'package:godown_book/features/master/repositories/storage_location_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_database.dart';

void main() {
  late Database db;
  final repo = CustomerRepository.instance;

  setUp(() async {
    db = await openTestDatabase();
    CustomerLookupService.instance.invalidate();
  });

  tearDown(() async {
    await db.close();
  });

  test('create mints an id, trims and upper-cases tax ids', () async {
    final created = await repo.create(const CustomerModel(
      id: '',
      customerName: '  Sharma Cold Store ',
      mobileNumber: ' 9876543210 ',
      gstNumber: '07abcde1234f1z5',
      createdAt: '',
    ));

    expect(created.id, isNotEmpty);
    expect(created.customerName, 'Sharma Cold Store');
    expect(created.mobileNumber, '9876543210');
    expect(created.gstNumber, '07ABCDE1234F1Z5');
    expect(created.createdAt, isNotEmpty);

    final loaded = await repo.getById(created.id);
    expect(loaded?.customerName, 'Sharma Cold Store');
  });

  test('ensureCustomer reuses a match by phone, then by name', () async {
    final first = await repo.ensureCustomer(
      name: 'Gupta Agro',
      phone: '9000000001',
      city: 'Karnal',
    );
    final byPhone = await repo.ensureCustomer(
      name: 'Gupta Agro Pvt Ltd',
      phone: '9000000001',
    );
    final byName = await repo.ensureCustomer(name: 'gupta agro', phone: '');
    final fresh = await repo.ensureCustomer(name: 'Someone Else', phone: '');

    expect(byPhone, first);
    expect(byName, first);
    expect(fresh, isNot(first));
    expect((await repo.getAll()).length, 2);
  });

  test('deactivate hides from active lists but keeps the row', () async {
    final c = await repo.create(const CustomerModel(
      id: '',
      customerName: 'Old Depositor',
      createdAt: '',
    ));
    await repo.deactivate(c.id);

    expect(await repo.getAll(activeOnly: true), isEmpty);
    expect((await repo.getAll()).single.isActive, isFalse);

    await repo.reactivate(c.id);
    expect((await repo.getAll(activeOnly: true)).single.id, c.id);
  });

  test('lookup suggests by name or phone, merged with extra sources', () async {
    await repo.create(const CustomerModel(
      id: '',
      customerName: 'Verma Traders',
      mobileNumber: '9111111111',
      city: 'Panipat',
      createdAt: '',
    ));

    CustomerLookupService.instance.extraSources.add(() async => const [
          CustomerSuggestion(
            name: 'Verma Traders',
            gst: '06AAAAA0000A1Z5',
            source: 'Warehouse Receipt',
          ),
        ]);
    addTearDown(CustomerLookupService.instance.extraSources.clear);

    final byName = await CustomerLookupService.instance.search('verma');
    expect(byName.single.phone, '9111111111');
    // The master row's own fields win; the document fills the gaps.
    expect(byName.single.gst, '06AAAAA0000A1Z5');
    expect(byName.single.source, 'Customer');
    expect(byName.single.customerId, isNotEmpty);

    final byPhone = await CustomerLookupService.instance.search('9111');
    expect(byPhone.single.name, 'Verma Traders');

    expect(await CustomerLookupService.instance.search(''), isEmpty);
  });

  test('storage locations get sequential codes', () async {
    final a = await StorageLocationRepository.instance.create(name: 'Hall A');
    final b = await StorageLocationRepository.instance.create(name: 'Rack 3');
    final c = await StorageLocationRepository.instance.create(
      name: 'Cold Room',
      code: 'cold-1',
    );

    expect(a.code, 'LOC001');
    expect(b.code, 'LOC002');
    expect(c.code, 'COLD-1');
    expect(b.sortOrder, greaterThan(a.sortOrder));

    await StorageLocationRepository.instance.delete(b.id);
    expect(
      (await StorageLocationRepository.instance.getAll()).map((l) => l.name),
      ['Hall A', 'Cold Room'],
    );
  });
}
