import 'package:cloud_firestore/cloud_firestore.dart';

/// Assigns a genuinely globally-unique, sequential "DRS-" customer ID
/// to every new company, starting at DRS-4838 and incrementing by
/// exactly 1 per company - the identifier a subscriber sees as "my
/// ID" and the identifier Super Admin uses to find that exact company
/// (old or new) without ambiguity.
///
/// WHY FIRESTORE, NOT A LOCAL COUNTER: this app is single-tenant-per-
/// device (see TenantScope's own doc comment) - there is genuinely no
/// way for two separate phones to coordinate "who gets the next
/// number" without a shared, authoritative source. A purely local
/// counter would let two companies onboarding at the same moment on
/// two different devices both compute "the next number" independently
/// and collide. Firestore's own transaction mechanism (confirmed via
/// Firebase's own official documentation: reads must happen before
/// writes inside runTransaction, and the SDK automatically retries on
/// a detected conflict) is the only mechanism this project has access
/// to that can genuinely guarantee no two companies are ever assigned
/// the same number, even if they register in the same instant.
///
/// REQUIRES NETWORK CONNECTIVITY: a Firestore transaction genuinely
/// cannot complete offline (confirmed via Firebase's own
/// documentation) - assignDrsId() will throw if called with no
/// internet connection. Callers (CompanyOnboardingScreen) must handle
/// this as a genuine failure, not silently proceed without an ID.
class DrsIdCounterService {
  DrsIdCounterService._();

  static final DrsIdCounterService instance = DrsIdCounterService._();

  /// Single counter document - one Firestore document is genuinely
  /// enough for this project's realistic registration volume (a new
  /// Packers & Movers company onboarding is not a high-frequency
  /// event; Firestore's own 1-write-per-second-per-document limit is
  /// not a genuine constraint here, unlike a high-traffic like/vote
  /// counter).
  static const _counterDocPath = 'counters/company_registration';

  /// The first-ever DRS ID, per this task's own explicit requirement.
  static const int _startingValue = 4838;

  /// Atomically assigns and returns the next sequential App ID (plain
  /// number, no prefix: "4838" the very first time this is ever called
  /// for this Firebase project, "4839" the next, and so on - never
  /// reused, even if a company is later deleted). Call exactly once per
  /// genuinely new company, at the moment CompanyModel.companyId is
  /// first generated (see CompanyController.saveCompany()'s own doc
  /// comment on companyId for the equivalent "generated once, never
  /// changes" reasoning this ID follows).
  Future<String> assignNextDrsId() async {
    final db = FirebaseFirestore.instance;
    final counterRef = db.doc(_counterDocPath);

    final nextValue = await db.runTransaction<int>((transaction) async {
      final snapshot = await transaction.get(counterRef);

      final current = snapshot.exists
          ? (snapshot.data()?['lastAssigned'] as int? ?? _startingValue - 1)
          : _startingValue - 1;

      final next = current + 1;

      transaction.set(counterRef, {
        'lastAssigned': next,
        'updatedAt': FieldValue.serverTimestamp(),
      });

      return next;
    }).timeout(const Duration(seconds: 10));

    // Plain number, no "DRS-" prefix - per explicit instruction ("app
    // id se drs hta do, only appid - 4838 se start hoke aage"). The
    // counter itself is unchanged, so numbering continues exactly
    // where it was.
    return '$nextValue';
  }
}
