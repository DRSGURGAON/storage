import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/constants/id_proof_types.dart';

/// The ID proof is now chosen from a list instead of typed. Records
/// made before that list existed still have to open on the right entry,
/// and nothing anyone typed may be thrown away.
void main() {
  group('IdProofTypes.parse', () {
    test('reads the type and the number out of what was typed before', () {
      final a = IdProofTypes.parse('Aadhaar 1234-5678-9012');
      expect(a.type, IdProofTypes.aadhaar);
      expect(a.number, '1234-5678-9012');
      expect(a.customType, '');

      final p = IdProofTypes.parse('PAN ABCDE1234F');
      expect(p.type, IdProofTypes.pan);
      expect(p.number, 'ABCDE1234F');
    });

    test('the spellings people actually use all land on the right entry', () {
      for (final written in [
        'Aadhaar 1234',
        'aadhar 1234',
        'Adhaar card 1234',
        'ADHAR CARD 1234',
        'Aadhaar Card: 1234',
        'Aadhaar no. 1234',
        'UID 1234',
      ]) {
        final parsed = IdProofTypes.parse(written);
        expect(parsed.type, IdProofTypes.aadhaar, reason: written);
        expect(parsed.number, '1234', reason: written);
      }

      expect(IdProofTypes.parse('PANCARD ABCDE1234F').type, IdProofTypes.pan);
      expect(IdProofTypes.parse('DL HR-26 20110012345').type, IdProofTypes.drivingLicence);
      expect(IdProofTypes.parse('Driving Licence HR2611').type, IdProofTypes.drivingLicence);
      expect(IdProofTypes.parse('Voter ID XYZ1234567').type, IdProofTypes.voterId);
      expect(IdProofTypes.parse('EPIC XYZ1234567').type, IdProofTypes.voterId);
      expect(IdProofTypes.parse('Passport M1234567').type, IdProofTypes.passport);
      expect(IdProofTypes.parse('Ration card 99/2211').type, IdProofTypes.rationCard);
    });

    test('a name that merely starts like a type is not mistaken for one', () {
      final parsed = IdProofTypes.parse('Pandey ji ka card');
      expect(parsed.type, IdProofTypes.other);
      expect(parsed.number, '');
      expect(parsed.customType, 'Pandey ji ka card');
    });

    test('a document the list does not name keeps its own name and number', () {
      final parsed = IdProofTypes.parse('Army ID 99213');
      expect(parsed.type, IdProofTypes.other);
      expect(parsed.customType, 'Army ID');
      expect(parsed.number, '99213');
      expect(parsed.effectiveType, 'Army ID');
      expect(parsed.combined, 'Army ID 99213');
    });

    test('a bare number is a number with no type yet', () {
      final parsed = IdProofTypes.parse('1234-5678-9012');
      expect(parsed.type, '');
      expect(parsed.number, '1234-5678-9012');
      expect(parsed.combined, '1234-5678-9012');
    });

    test('a type on its own keeps the type', () {
      final parsed = IdProofTypes.parse('Aadhaar');
      expect(parsed.type, IdProofTypes.aadhaar);
      expect(parsed.number, '');
      expect(parsed.combined, 'Aadhaar Card');
    });

    test('nothing recorded stays nothing', () {
      for (final empty in ['', '   ']) {
        final parsed = IdProofTypes.parse(empty);
        expect(parsed.type, '');
        expect(parsed.number, '');
        expect(parsed.customType, '');
        expect(parsed.combined, '');
      }
    });

    test('every listed type survives a round trip', () {
      for (final type in IdProofTypes.values) {
        if (type == IdProofTypes.other) continue;
        final stored = IdProofTypes.combine(type, 'X123');
        final parsed = IdProofTypes.parse(stored);
        expect(parsed.type, type, reason: stored);
        expect(parsed.number, 'X123', reason: stored);
        expect(parsed.combined, stored, reason: stored);
      }
    });
  });

  group('IdProofTypes.combine', () {
    test('joins the two halves, and never leaves a stray space', () {
      expect(IdProofTypes.combine('Aadhaar Card', '1234'), 'Aadhaar Card 1234');
      expect(IdProofTypes.combine('Aadhaar Card', ''), 'Aadhaar Card');
      expect(IdProofTypes.combine('', '1234'), '1234');
      expect(IdProofTypes.combine('  ', '  '), '');
    });

    test('"Other" prints what the customer actually showed', () {
      const named = IdProof(type: IdProofTypes.other, customType: 'CGHS card', number: '77');
      expect(named.effectiveType, 'CGHS card');
      expect(named.combined, 'CGHS card 77');

      const unnamed = IdProof(type: IdProofTypes.other, number: '77');
      expect(unnamed.effectiveType, IdProofTypes.other);
      expect(unnamed.combined, 'Other 77');
    });
  });
}
