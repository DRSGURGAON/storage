import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/features/company/models/company_model.dart';
import 'package:godown_book/features/company/services/app_id_counter_service.dart';

/// The App ID a subscriber sees on their dashboard and quotes to
/// support: "SW1324" for the first company in a Firebase project, and
/// never a placeholder standing in for one.
void main() {
  group('App ID', () {
    test('a company starts with no ID rather than a placeholder', () {
      const fresh = CompanyModel(companyName: 'Test Godown');
      expect(fresh.companyCode, '');
      expect(AppIdCounterService.isAssigned(fresh.companyCode), isFalse);

      final fromDb = CompanyModel.fromMap({'company_name': 'Test Godown'});
      expect(fromDb.companyCode, '');
    });

    test('nothing, blank and the old DRS001 placeholder all count as unminted',
        () {
      expect(AppIdCounterService.isAssigned(null), isFalse);
      expect(AppIdCounterService.isAssigned(''), isFalse);
      expect(AppIdCounterService.isAssigned('   '), isFalse);
      expect(AppIdCounterService.isAssigned('DRS001'), isFalse);

      expect(AppIdCounterService.isAssigned('SW1324'), isTrue);
      expect(AppIdCounterService.isAssigned('4839'), isTrue);
    });

    test('every ID reads SW', () {
      expect(AppIdCounterService.prefix, 'SW');
    });

    test('a Super Admin search finds the same company however it is typed', () {
      // What a customer reads out, in the shapes people actually type.
      for (final typed in ['SW1324', 'sw1324', 'SW-1324', ' sw 1324 ', '1324']) {
        expect(
          AppIdCounterService.lookupCandidates(typed),
          ['SW1324', '1324', 'DRS-1324'],
          reason: typed,
        );
      }

      // An ID minted by an older build is still reachable by its own form.
      expect(
        AppIdCounterService.lookupCandidates('DRS-4839'),
        contains('4839'),
      );
    });

    test('a search with no number in it matches nothing', () {
      expect(AppIdCounterService.lookupCandidates(''), isEmpty);
      expect(AppIdCounterService.lookupCandidates('SW'), isEmpty);
      expect(AppIdCounterService.lookupCandidates('godown'), isEmpty);
    });
  });
}
