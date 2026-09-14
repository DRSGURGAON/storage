/// Which build this is. CI compiles the workflow run number in with
/// --dart-define=BUILD_NUMBER; a local build has none and says so.
class AppBuild {
  AppBuild._();

  static const String number = String.fromEnvironment('BUILD_NUMBER');

  static String get label => number.isEmpty ? 'Local build' : 'Build $number';
}
