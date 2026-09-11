import '../../../core/customer/customer_lookup_service.dart';
import '../../../core/utils/id_generator.dart';
import '../data/customer_dao.dart';
import '../models/customer_model.dart';

class CustomerRepository {
  CustomerRepository._();

  static final CustomerRepository instance = CustomerRepository._();

  final CustomerDao _dao = CustomerDao.instance;

  Future<List<CustomerModel>> getAll({bool activeOnly = false}) async {
    final all = await _dao.getAll();
    return activeOnly ? all.where((c) => c.isActive).toList() : all;
  }

  Future<CustomerModel?> getById(String id) => _dao.getById(id);

  /// Creates a customer. [customer.id] may be empty - a UUID is minted.
  Future<CustomerModel> create(CustomerModel customer) async {
    final now = DateTime.now().toIso8601String();
    final row = CustomerModel(
      id: customer.id.isEmpty ? IdGenerator.generateId() : customer.id,
      customerName: customer.customerName.trim(),
      mobileNumber: customer.mobileNumber.trim(),
      altMobile: customer.altMobile.trim(),
      email: customer.email.trim(),
      gstNumber: customer.gstNumber.trim().toUpperCase(),
      panNumber: customer.panNumber.trim().toUpperCase(),
      address: customer.address.trim(),
      city: customer.city.trim(),
      state: customer.state.trim(),
      pincode: customer.pincode.trim(),
      idProofType: customer.idProofType.trim(),
      idProofNumber: customer.idProofNumber.trim(),
      notes: customer.notes.trim(),
      isActive: customer.isActive,
      createdAt: now,
      updatedAt: now,
    );

    await _dao.insert(row);
    CustomerLookupService.instance.invalidate();
    return row;
  }

  Future<void> update(CustomerModel customer) async {
    await _dao.update(
      customer.copyWith(updatedAt: DateTime.now().toIso8601String()),
    );
    CustomerLookupService.instance.invalidate();
  }

  /// Soft delete - documents already issued still name this customer,
  /// so the row stays for statements and lookups.
  Future<void> deactivate(String id) async {
    final existing = await _dao.getById(id);
    if (existing == null) return;
    await update(existing.copyWith(isActive: false));
  }

  Future<void> reactivate(String id) async {
    final existing = await _dao.getById(id);
    if (existing == null) return;
    await update(existing.copyWith(isActive: true));
  }

  /// Finds a customer by exact phone, or by exact name when no phone
  /// is given - used by document forms to link a typed customer back
  /// to the master without creating duplicates.
  Future<CustomerModel?> findMatching({
    required String name,
    required String phone,
  }) async {
    final all = await _dao.getAll();
    final p = phone.trim();
    if (p.isNotEmpty) {
      for (final c in all) {
        if (c.mobileNumber.trim() == p) return c;
      }
    }
    final n = name.trim().toLowerCase();
    if (n.isEmpty) return null;
    for (final c in all) {
      if (c.customerName.trim().toLowerCase() == n) return c;
    }
    return null;
  }

  /// Ensures a customer row exists for the party named on a document
  /// (Warehouse Receipt / Bill), returning its id. A matching customer
  /// (same phone, else same name) is reused; otherwise one is created
  /// from the document's own snapshot fields.
  Future<String> ensureCustomer({
    required String name,
    required String phone,
    String gst = '',
    String address = '',
    String city = '',
    String state = '',
    String pincode = '',
  }) async {
    final existing = await findMatching(name: name, phone: phone);
    if (existing != null) return existing.id;

    final created = await create(CustomerModel(
      id: '',
      customerName: name,
      mobileNumber: phone,
      gstNumber: gst,
      address: address,
      city: city,
      state: state,
      pincode: pincode,
      createdAt: '',
    ));
    return created.id;
  }
}
