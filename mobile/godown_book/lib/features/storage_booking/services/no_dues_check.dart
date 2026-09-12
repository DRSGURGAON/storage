import '../../billing/repositories/billing_repository.dart';
import '../models/storage_booking_model.dart';
import '../models/storage_status.dart';

/// Whether a storage record has really closed - goods gone, bills paid,
/// deposit settled - and, when it has not, what is still in the way.
/// A no-dues certificate is only ever issued on a clear check.
class NoDuesCheck {
  final StorageBookingModel booking;
  final CustomerBalance balance;
  final DepositSummary deposit;

  const NoDuesCheck({
    required this.booking,
    required this.balance,
    required this.deposit,
  });

  /// What stops the certificate, in the order the operator would fix
  /// it. Empty when nothing does.
  List<String> get blockers {
    final reasons = <String>[];

    switch (booking.status) {
      case StorageStatus.released:
        break;
      case StorageStatus.cancelled:
        reasons.add('This storage record was cancelled - nothing was stored');
      case StorageStatus.inStorage:
      case StorageStatus.partiallyReleased:
        reasons.add('Goods are still in the godown - release them first');
    }

    if (balance.outstanding > 0.004) {
      reasons.add(
        '₹${balance.outstanding.toStringAsFixed(0)} is still outstanding',
      );
    }

    if (deposit.held > 0.004) {
      reasons.add(
        'Security deposit of ₹${deposit.held.toStringAsFixed(0)} is still '
        'held - return or adjust it first',
      );
    }

    return reasons;
  }

  bool get isClear => blockers.isEmpty;
}
