import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The Android manifest names a launcher activity by class. Nothing in
/// the build checks that the class is actually there: Gradle compiles
/// whatever Kotlin it finds, the manifest merger never looks, and the
/// APK is produced and signed exactly as if all were well. The failure
/// only shows up on a real phone, where the launcher asks for a class
/// that does not exist and Android kills the app the moment it opens -
/// "keeps stopping", with no clue as to why.
///
/// That happened here: the manifest asked for
/// com.drs.godownbook.MainActivity while the file declared
/// com.drs.godown_book.MainActivity. These tests make the same mistake
/// fail on the machine that makes the build instead.
void main() {
  final manifest =
      File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
  final gradle = File('android/app/build.gradle.kts').readAsStringSync();

  String namespace() {
    final match =
        RegExp(r'namespace\s*=\s*"([^"]+)"').firstMatch(gradle);
    expect(match, isNotNull, reason: 'no namespace in build.gradle.kts');
    return match!.group(1)!;
  }

  /// Every activity the manifest declares, as a full class name.
  List<String> activityClasses() {
    final space = namespace();
    return RegExp(r'<activity\b[^>]*android:name="([^"]+)"', dotAll: true)
        .allMatches(manifest)
        .map((m) => m.group(1)!)
        .map((name) => name.startsWith('.') ? '$space$name' : name)
        .toList();
  }

  test('the namespace and the applicationId agree', () {
    final appId =
        RegExp(r'applicationId\s*=\s*"([^"]+)"').firstMatch(gradle)?.group(1);
    expect(appId, namespace(),
        reason: 'a mismatch here silently changes what ".MainActivity" means');
  });

  test('every activity the manifest names exists in the right package', () {
    final activities = activityClasses();
    expect(activities, isNotEmpty, reason: 'no activity in the manifest');

    for (final className in activities) {
      final parts = className.split('.');
      final package = parts.sublist(0, parts.length - 1).join('.');
      final simpleName = parts.last;

      final candidates = [
        'android/app/src/main/kotlin/${package.replaceAll('.', '/')}/'
            '$simpleName.kt',
        'android/app/src/main/java/${package.replaceAll('.', '/')}/'
            '$simpleName.java',
      ];
      final found = candidates.where((p) => File(p).existsSync()).toList();

      expect(found, isNotEmpty,
          reason: 'The manifest asks for $className. Nothing is at '
              '${candidates.join(' or ')}, so the app will be killed the '
              'moment a launcher opens it.');

      // The directory being right is not enough - Kotlin takes the
      // class's package from the declaration, not the folder.
      final source = File(found.first).readAsStringSync();
      expect(source, contains(RegExp('^package\\s+$package\\s*;?\\s*\$',
          multiLine: true)),
          reason: '${found.first} does not declare package $package');
    }
  });

  test('the launcher activity is the one that is exported', () {
    // Android 12 refuses to install an intent-filtered component that
    // does not say whether it is exported.
    expect(manifest, contains('android:exported="true"'));
    expect(manifest, contains('android.intent.category.LAUNCHER'));
  });
}
