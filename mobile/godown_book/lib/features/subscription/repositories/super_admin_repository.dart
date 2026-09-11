import '../../../core/subscription/super_admin_scope.dart';
import '../models/super_admin_model.dart';
import '../services/super_admin_firestore_service.dart';

class SuperAdminRepository {
  SuperAdminRepository._();

  static final SuperAdminRepository instance = SuperAdminRepository._();

  final SuperAdminFirestoreService _service =
      SuperAdminFirestoreService.instance;

  /// True when no Super Admin exists anywhere yet - the UI's own
  /// signal for whether to offer the one-time bootstrap setup at all,
  /// without needing to catch a StateError from
  /// bootstrapFirstSuperAdmin() just to find out.
  Future<bool> canBootstrap() => _service.canBootstrap();

  /// Managing who else is a Super Admin is itself Super Admin-only -
  /// otherwise anyone could grant themselves platform-wide access.
  Future<List<SuperAdminModel>> getAll() async {
    await SuperAdminScope.refresh();

    if (!SuperAdminScope.isSuperAdmin) {
      throw SuperAdminRequiredException();
    }

    return _service.getAll();
  }

  Future<void> add({
    required String uid,
    required String mobileNumber,
    String name = '',
  }) async {
    await SuperAdminScope.refresh();

    if (!SuperAdminScope.isSuperAdmin) {
      throw SuperAdminRequiredException();
    }

    await _service.add(uid: uid, mobileNumber: mobileNumber, name: name);
  }

  /// Bootstraps the very first Super Admin - the chicken-and-egg
  /// solution for SuperAdminRepository.add() otherwise requiring an
  /// existing Super Admin to grant the first one. Only succeeds when
  /// no Super Admin document exists yet anywhere in Firestore, and
  /// the underlying Security Rule independently enforces the same
  /// "collection currently empty" condition server-side - this client
  /// check is a fast, friendly failure, not the actual boundary.
  Future<SuperAdminModel> bootstrapFirstSuperAdmin({
    required String mobileNumber,
    String name = '',
  }) async {
    final canBootstrap = await _service.canBootstrap();

    if (!canBootstrap) {
      throw StateError(
        'A Super Admin already exists - use add() instead, which '
        'requires being signed in as an existing Super Admin.',
      );
    }

    return _service.bootstrapFirstSuperAdmin(
      mobileNumber: mobileNumber,
      name: name,
    );
  }
}
