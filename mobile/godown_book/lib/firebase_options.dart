// Firebase project configuration.
//
// PLACEHOLDER - regenerate this file for your own Firebase project by
// running, from mobile/godown_book:
//
//   dart pub global activate flutterfire_cli
//   flutterfire configure --project=<your-firebase-project-id> \
//       --platforms=android,web
//
// That command overwrites this file with real values and also writes
// android/app/google-services.json. Until then Firebase.initializeApp()
// fails at startup and the app shows its "Could not connect" screen -
// deliberately, so a build can never silently talk to the wrong project.
//
// ignore_for_file: type=lint
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  /// The value flutterfire_configure has not replaced yet.
  static const placeholder = 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE';

  /// True while this file is still the one in source control. On
  /// Android that is survivable - google-services.json carries the same
  /// facts, and main() falls back to it - so the app has to be able to
  /// ask.
  static bool get isPlaceholder => android.apiKey == placeholder;

  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      return web;
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions are not supported for this platform.',
        );
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    appId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    messagingSenderId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    projectId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
  );

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    appId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    messagingSenderId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    projectId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    authDomain: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
  );
}
