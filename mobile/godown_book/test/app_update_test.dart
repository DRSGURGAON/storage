import 'package:flutter_test/flutter_test.dart';
import 'package:godown_book/core/update/app_update_service.dart';

/// The dashboard offers an update only when CI has published a build
/// with a higher number than the one running, and never to a local
/// build. The release shape is GitHub's; a change in it is "no update".
void main() {
  Map<String, dynamic> release(String tag, {List assets = const []}) => {
        'tag_name': tag,
        'html_url': 'https://github.com/DRSGURGAON/storage/releases/tag/$tag',
        'body': 'Fix the thing\n\nBranch: main',
        'assets': assets,
      };

  const apk = {
    'name': 'storagebill-pro-build-40.apk',
    'browser_download_url':
        'https://github.com/DRSGURGAON/storage/releases/download/build-40/storagebill-pro-build-40.apk',
  };

  test('reads the build number and the APK from a release', () {
    final info = AppUpdateInfo.fromRelease(release('build-40', assets: [apk]));
    expect(info, isNotNull);
    expect(info!.buildNumber, 40);
    expect(info.apkUrl, endsWith('storagebill-pro-build-40.apk'));
    expect(info.notes, startsWith('Fix the thing'));
  });

  test('a release without an APK, or with an odd tag, is not an update', () {
    expect(AppUpdateInfo.fromRelease(release('build-40')), isNull);
    expect(AppUpdateInfo.fromRelease(release('v1.0.0', assets: [apk])), isNull);
    expect(AppUpdateInfo.fromRelease(release('build-40', assets: [
      {'name': 'notes.txt', 'browser_download_url': 'x'},
    ])), isNull);
  });

  test('is offered only to an older CI build, never to a local one', () {
    final info = AppUpdateInfo.fromRelease(release('build-40', assets: [apk]))!;
    expect(info.isNewerThan('39'), isTrue);
    expect(info.isNewerThan('40'), isFalse);
    expect(info.isNewerThan('41'), isFalse);
    expect(info.isNewerThan(''), isFalse);
  });
}
