import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Home, Customers and Documents are tabs of the app shell. A tab is
/// switched to with go(); pushing its path stacks a second page with
/// the tab's own key, and the navigator stops the app with
/// "!keyReservation.contains(key)". This test reads every screen and
/// fails on the first push to a tab, so the red screen cannot return.
void main() {
  test('no screen pushes a shell tab on top of the shell', () {
    final offenders = <String>[];
    final pattern = RegExp(r"""\.push\(\s*['"]/(dashboard|customers|documents)['"]""");

    for (final file in Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'))) {
      final source = file.readAsStringSync();
      for (final match in pattern.allMatches(source)) {
        final line = source.substring(0, match.start).split('\n').length;
        offenders.add('${file.path}:$line');
      }
    }

    expect(offenders, isEmpty,
        reason: 'use context.go() for a tab, or a route of its own');
  });
}
