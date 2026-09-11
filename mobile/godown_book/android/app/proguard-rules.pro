# DRS ERP / Bill N Bilty - ProGuard/R8 rules for the release build.
#
# WHY THESE SPECIFIC RULES: Firebase's Android SDKs (Auth, Firestore)
# and the Flutter engine's own embedding layer both use reflection and
# native JNI bridging internally, which R8's default shrinking cannot
# safely trace - stripping these classes causes runtime crashes that
# only appear in release builds (confirmed via multiple real-world
# reports, including Firebase's own flutterfire GitHub issue tracker).
# These rules are DELIBERATELY NARROW rather than a single broad
# `-keep class ** { *; }`, which defeats the entire purpose of R8 (no
# shrinking, no obfuscation) - only the packages genuinely documented
# to need it are kept.
#
# If a future release crash mentions ClassNotFoundException or
# NoSuchMethodError for a class in a package NOT listed here, add a
# narrowly-scoped rule for that specific package - do not widen these
# rules speculatively.

# Flutter's own embedding layer.
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# Firebase Auth + Firestore - both use reflection for their internal
# component registration (Firebase's own dependency-injection-style
# component system), which is not statically traceable by R8.
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }

# Preserve line numbers in stack traces for crash reports, without
# exposing the original source file name.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Flutter's own embedding layer (kept above) statically references
# these Play Core split-install/deferred-component classes even though
# this app doesn't use Play Feature Delivery - the com.google.android
# .play:core dependency that used to provide them was removed (it's
# too old for targetSdk 34+ and Play Console rejects it at upload).
# These classes are never actually invoked at runtime here, so R8 only
# needs to be told not to fail the build over a genuinely missing type,
# not to keep anything.
-dontwarn com.google.android.play.core.splitcompat.**
-dontwarn com.google.android.play.core.splitinstall.**
-dontwarn com.google.android.play.core.tasks.**
