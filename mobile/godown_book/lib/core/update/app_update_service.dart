import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../constants/app_build.dart';

/// A build newer than the one running, as published by CI.
class AppUpdateInfo {
  final int buildNumber;
  final String apkUrl;
  final String pageUrl;
  final String notes;

  const AppUpdateInfo({
    required this.buildNumber,
    required this.apkUrl,
    required this.pageUrl,
    this.notes = '',
  });

  /// Reads a GitHub release. The tag is `build-<run number>` and the
  /// one asset is the APK; anything else shaped is not an update.
  static AppUpdateInfo? fromRelease(Map<String, dynamic> json) {
    final tag = (json['tag_name'] as String?) ?? '';
    final number = int.tryParse(tag.replaceFirst('build-', ''));
    if (number == null) return null;

    final assets = (json['assets'] as List?) ?? const [];
    String apk = '';
    for (final asset in assets) {
      if (asset is! Map) continue;
      final name = (asset['name'] as String?) ?? '';
      if (name.endsWith('.apk')) {
        apk = (asset['browser_download_url'] as String?) ?? '';
        break;
      }
    }
    if (apk.isEmpty) return null;

    return AppUpdateInfo(
      buildNumber: number,
      apkUrl: apk,
      pageUrl: (json['html_url'] as String?) ?? '',
      notes: ((json['body'] as String?) ?? '').trim(),
    );
  }

  /// Newer than the build that is running. A local build (no number)
  /// is never offered an update - it is somebody's laptop.
  bool isNewerThan(String runningBuild) {
    final running = int.tryParse(runningBuild);
    if (running == null) return false;
    return buildNumber > running;
  }
}

/// Asks GitHub for the latest published build, once per app start.
///
/// The repository is public, so its releases are readable without any
/// token, and CI publishes every build there. Nothing here can break
/// the app: no network, a rate limit, a changed shape - all of them
/// are simply "no update".
class AppUpdateService {
  AppUpdateService._();

  static final AppUpdateService instance = AppUpdateService._();

  static const String releasesUrl =
      'https://api.github.com/repos/DRSGURGAON/storage/releases/latest';

  Future<AppUpdateInfo?>? _inFlight;

  Future<AppUpdateInfo?> check() {
    return _inFlight ??= _fetch();
  }

  Future<AppUpdateInfo?> _fetch() async {
    if (AppBuild.number.isEmpty) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
      final request = await client.getUrl(Uri.parse(releasesUrl));
      request.headers.set('Accept', 'application/vnd.github+json');
      request.headers.set('User-Agent', 'StorageBillPro');
      final response = await request.close().timeout(const Duration(seconds: 12));
      if (response.statusCode != 200) return null;
      final body = await response.transform(utf8.decoder).join();
      final json = jsonDecode(body);
      if (json is! Map<String, dynamic>) return null;
      final info = AppUpdateInfo.fromRelease(json);
      if (info == null || !info.isNewerThan(AppBuild.number)) return null;
      return info;
    } catch (error) {
      debugPrint('Update check skipped: $error');
      return null;
    }
  }
}
