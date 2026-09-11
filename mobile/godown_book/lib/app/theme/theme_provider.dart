import 'package:flutter/material.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persists the user's light/dark/system preference across app restarts.
///
/// The project has no other persistence mechanism for simple key-value
/// preferences, so this is the minimal addition needed to make the
/// Appearance setting stick - without it, "Dark" would silently reset to
/// the default every time the app is closed.
class ThemeModeNotifier extends StateNotifier<ThemeMode> {
  ThemeModeNotifier() : super(ThemeMode.light) {
    _load();
  }

  static const _prefsKey = 'app_theme_mode';

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_prefsKey);

      state = switch (saved) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        'system' => ThemeMode.system,
        // No preference saved yet (first run) - default to LIGHT, not
        // the device's OS-level setting, per the app's own "always
        // light by default" requirement.
        _ => ThemeMode.light,
      };
    } catch (_) {
      // First run, or preferences unavailable - keep the light default
      // rather than blocking startup on a non-essential preference.
    }
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = mode;

    try {
      final prefs = await SharedPreferences.getInstance();

      await prefs.setString(_prefsKey, switch (mode) {
        ThemeMode.light => 'light',
        ThemeMode.dark => 'dark',
        ThemeMode.system => 'system',
      });
    } catch (_) {
      // The in-memory state above already updated the UI; failing to
      // persist just means the choice won't survive a restart.
    }
  }
}

final themeModeProvider =
    StateNotifierProvider<ThemeModeNotifier, ThemeMode>(
  (ref) => ThemeModeNotifier(),
);
