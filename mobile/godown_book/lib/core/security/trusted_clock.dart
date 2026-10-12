import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// "What time is it, really?" - for the one decision that must not be
/// fooled by the phone's own clock: has this subscription expired.
///
/// WHY: expiry is a calendar date compared against "now". If "now" is
/// simply DateTime.now(), setting the phone's date back a month keeps an
/// expired subscription running for ever.
///
/// HOW: whenever the app is online it reads the real time from a Google
/// server (the HTTP `Date` header) and records an ANCHOR: that server time
/// together with Android's `elapsedRealtime` - a counter of milliseconds
/// since boot that the user cannot change - and the boot count. From then
/// on, within the same boot, the time is anchor + elapsed counter: exact,
/// offline, and immune to the clock setting. After a reboot (the counter
/// restarts) it falls back to the device clock, but never to a moment
/// earlier than the latest time ever seen (the "high-water mark"), so
/// turning the clock back cannot un-expire anything.
///
/// WHAT IT CANNOT DO: a rooted phone with the app's storage edited by hand
/// can still defeat any check that lives inside the app. This closes the
/// ordinary, non-technical ways of cheating, which is what the clock is for.
class TrustedClock {
  TrustedClock._();

  static final TrustedClock instance = TrustedClock._();

  static const MethodChannel _channel =
      MethodChannel('com.drs.godownbook/clock');

  static const _kServerMs = 'tc.serverMs';
  static const _kElapsedMs = 'tc.elapsedMs';
  static const _kBoot = 'tc.boot';
  static const _kHighWater = 'tc.highWaterMs';

  /// Any server answer older than this is not a real clock reading.
  static final int _earliestPlausibleMs =
      DateTime.utc(2024, 1, 1).millisecondsSinceEpoch;

  ClockAnchor? _anchor;
  int _highWaterMs = 0;
  DateTime? _lastSyncAttempt;
  SharedPreferences? _prefs;

  /// Loads the saved anchor. Call once at startup, before anything asks
  /// for [now].
  Future<void> init() async {
    try {
      _prefs = await SharedPreferences.getInstance();
      final prefs = _prefs!;
      final serverMs = prefs.getInt(_kServerMs);
      final elapsedMs = prefs.getInt(_kElapsedMs);
      final boot = prefs.getInt(_kBoot);
      if (serverMs != null && elapsedMs != null && boot != null) {
        _anchor = ClockAnchor(serverMs: serverMs, elapsedMs: elapsedMs, boot: boot);
      }
      _highWaterMs = prefs.getInt(_kHighWater) ?? 0;
    } catch (error) {
      debugPrint('TrustedClock init failed: $error');
    }

    await refreshClockInfo();

    // The platform counter keeps counting while the phone sleeps and the
    // app's stopwatch does not, so re-read it now and then.
    _refreshTimer?.cancel();
    _refreshTimer = Timer.periodic(
      const Duration(minutes: 2),
      (_) => unawaited(refreshClockInfo()),
    );
  }

  Timer? _refreshTimer;

  /// The trusted current time, synchronously.
  DateTime now() {
    final info = _lastClockInfo;
    final ms = computeNowMs(
      deviceNowMs: DateTime.now().millisecondsSinceEpoch,
      highWaterMs: _highWaterMs,
      anchor: _anchor,
      // The platform counter was read some moments ago; add the time the
      // app's own monotonic stopwatch has run since.
      elapsedNowMs: info == null
          ? null
          : info.elapsedMs + (_stopwatch.elapsedMilliseconds - _stopwatchAtInfo),
      bootNow: info?.boot,
    );

    if (ms > _highWaterMs) {
      _highWaterMs = ms;
      unawaited(_prefs?.setInt(_kHighWater, ms));
    }

    return DateTime.fromMillisecondsSinceEpoch(ms);
  }

  /// How long ago the clock was last checked against a real server, or
  /// null if it never has been (a fresh install that has not been online).
  Duration? sinceLastSync() {
    final anchor = _anchor;
    if (anchor == null) return null;

    final nowMs = now().millisecondsSinceEpoch;
    final ago = nowMs - anchor.serverMs;
    return Duration(milliseconds: ago < 0 ? 0 : ago);
  }

  /// Reads the real time from the network and anchors it. Quiet and
  /// best-effort: offline, blocked or malformed answers just leave the
  /// previous anchor in place. At most once every ten minutes unless
  /// [force].
  Future<bool> sync({bool force = false}) async {
    final last = _lastSyncAttempt;
    if (!force &&
        last != null &&
        DateTime.now().difference(last) < const Duration(minutes: 10)) {
      return false;
    }
    _lastSyncAttempt = DateTime.now();

    try {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 5);
      try {
        final request = await client
            .headUrl(Uri.parse('https://www.google.com/generate_204'))
            .timeout(const Duration(seconds: 6));
        final response = await request.close().timeout(const Duration(seconds: 6));
        final header = response.headers.value(HttpHeaders.dateHeader);
        if (header == null) return false;

        final serverMs = HttpDate.parse(header).millisecondsSinceEpoch;
        if (serverMs < _earliestPlausibleMs) return false;

        final info = await _readClockInfo();
        _lastClockInfo = info;
        _stopwatchAtInfo = _stopwatch.elapsedMilliseconds;

        _anchor = ClockAnchor(
          serverMs: serverMs,
          elapsedMs: info?.elapsedMs ?? -1,
          boot: info?.boot ?? -1,
        );
        _highWaterMs = serverMs > _highWaterMs ? serverMs : _highWaterMs;

        final prefs = _prefs ?? await SharedPreferences.getInstance();
        _prefs = prefs;
        await prefs.setInt(_kServerMs, _anchor!.serverMs);
        await prefs.setInt(_kElapsedMs, _anchor!.elapsedMs);
        await prefs.setInt(_kBoot, _anchor!.boot);
        await prefs.setInt(_kHighWater, _highWaterMs);
        return true;
      } finally {
        client.close(force: true);
      }
    } catch (error) {
      debugPrint('TrustedClock sync skipped: $error');
      return false;
    }
  }

  // ---------------------------------------------------------------
  // Platform clock counter (elapsedRealtime + boot count)
  // ---------------------------------------------------------------

  ClockInfo? _lastClockInfo;

  /// now() is synchronous but reading the platform counter is not, so the
  /// counter is read now and then and extrapolated with this stopwatch.
  final Stopwatch _stopwatch = Stopwatch()..start();
  int _stopwatchAtInfo = 0;

  Future<ClockInfo?> _readClockInfo() async {
    if (!Platform.isAndroid) return null;
    try {
      final result =
          await _channel.invokeMapMethod<String, dynamic>('getClockInfo');
      if (result == null) return null;
      return ClockInfo(
        elapsedMs: (result['elapsed'] as num).toInt(),
        boot: (result['boot'] as num).toInt(),
      );
    } catch (_) {
      return null;
    }
  }

  /// Refreshes the platform counter; call at startup and when the app
  /// returns to the foreground.
  Future<void> refreshClockInfo() async {
    final info = await _readClockInfo();
    if (info == null) return;
    _lastClockInfo = info;
    _stopwatchAtInfo = _stopwatch.elapsedMilliseconds;
  }

  /// Pure arithmetic of [now] - separate so it can be tested without a
  /// phone.
  @visibleForTesting
  static int computeNowMs({
    required int deviceNowMs,
    required int highWaterMs,
    ClockAnchor? anchor,
    int? elapsedNowMs,
    int? bootNow,
  }) {
    if (anchor != null &&
        anchor.boot >= 0 &&
        elapsedNowMs != null &&
        bootNow != null &&
        bootNow == anchor.boot &&
        elapsedNowMs >= anchor.elapsedMs) {
      // Same boot: the counter the user cannot touch. Exact.
      return anchor.serverMs + (elapsedNowMs - anchor.elapsedMs);
    }

    // After a reboot, or with no platform counter: the device clock, but
    // never earlier than the latest moment already seen.
    return deviceNowMs > highWaterMs ? deviceNowMs : highWaterMs;
  }
}

/// A server time paired with the platform counter at that instant.
class ClockAnchor {
  const ClockAnchor({
    required this.serverMs,
    required this.elapsedMs,
    required this.boot,
  });

  final int serverMs;
  final int elapsedMs;
  final int boot;
}

class ClockInfo {
  const ClockInfo({required this.elapsedMs, required this.boot});

  final int elapsedMs;
  final int boot;
}
