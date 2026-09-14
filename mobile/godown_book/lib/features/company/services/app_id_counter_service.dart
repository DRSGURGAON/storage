import 'package:cloud_firestore/cloud_firestore.dart';

/// Assigns a genuinely globally-unique, sequential App ID - "SW1324",
/// "SW1325", and so on - to every new company: the identifier a
/// subscriber sees as "my ID" on their dashboard and quotes to
/// support, and the identifier Super Admin uses to find that exact
/// company without ambiguity.
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
/// documentation) - assignNextAppId() will throw if called with no
/// internet connection. Callers (the dashboard's App ID backfill) must
/// handle this as a genuine failure, not silently proceed without an ID.
class AppIdCounterService {
  AppIdCounterService._();

  static final AppIdCounterService instance = AppIdCounterService._();

  /// Single counter document - one Firestore document is genuinely
  /// enough for this project's realistic registration volume (a new
  /// company onboarding is not a high-frequency event; Firestore's own
  /// 1-write-per-second-per-document limit is not a genuine constraint
  /// here, unlike a high-traffic like/vote counter).
  static const _counterDocPath = 'counters/company_registration';

  /// The number the very first company is given. It applies only in a
  /// Firebase project where the counter document does not exist yet -
  /// once a project has started counting, numbering continues from
  /// wherever it got to, so an ID is never handed out twice.
  static const int _startingValue = 1324;

  /// What every App ID reads as.
  static const String prefix = 'SW';

  /// The value CompanyModel used to carry before an App ID had been
  /// minted. It was never a real ID - no company was ever assigned it -
  /// so a record still holding it is treated as unassigned and gets a
  /// genuine ID on the next online dashboard load.
  static const String legacyPlaceholder = 'DRS001';

  /// True when [code] is a real, minted App ID rather than nothing or
  /// the old placeholder. What the dashboard, Company Settings and the
  /// Super Admin screens ask before showing an ID.
  static bool isAssigned(String? code) {
    final trimmed = (code ?? '').trim();
    return trimmed.isNotEmpty && trimmed != legacyPlaceholder;
  }

  /// The digits inside anything a person might type or an older record
  /// might hold: "SW1325", "sw-1325", "1325", and the "DRS-4839" form
  /// from the first builds. Null when there is no number in it.
  static String? numberIn(String code) {
    final compact = code.toUpperCase().replaceAll(RegExp(r'[\s\-]'), '');
    final digits = compact.replaceAll(RegExp(r'^[A-Z]+'), '');
    if (digits.isEmpty || int.tryParse(digits) == null) return null;
    return digits;
  }

  /// Every stored form the number in [code] could have been saved as,
  /// newest first. A Super Admin search hits companies minted before
  /// and after each change of format.
  static List<String> lookupCandidates(String code) {
    final digits = numberIn(code);
    if (digits == null) return const [];
    return ['$prefix$digits', digits, 'DRS-$digits'];
  }

  /// Atomically assigns and returns the next sequential App ID
  /// ("SW1324" the very first time this is ever called for this
  /// Firebase project, "SW1325" the next, and so on - never reused,
  /// even if a company is later deleted). Call exactly once per
  /// genuinely new company, at the moment CompanyModel.companyId is
  /// first generated (see CompanyController.saveCompany()'s own doc
  /// comment on companyId for the equivalent "generated once, never
  /// changes" reasoning this ID follows).
  Future<String> assignNextAppId() async {
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

    // The counter document itself holds the plain number, so numbering
    // continues exactly where it was across any change of prefix.
    return '$prefix$nextValue';
  }
}
