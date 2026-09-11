import java.io.FileInputStream
import java.util.Properties

// Release signing. android/key.properties is deliberately NOT in source
// control (see android/.gitignore): it must be created locally, or by
// the release workflow from repository secrets, pointing at a real
// keystore made with keytool. Without it the build falls back to debug
// signing so `flutter build apk` and `flutter run --release` keep
// working for testing, and starts genuinely release-signing the moment
// a real key.properties exists.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
val hasReleaseKeystore = keystorePropertiesFile.exists()
if (hasReleaseKeystore) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

plugins {
    id("com.android.application")
    // Required for Firebase Phone Auth's Android app verification (Play
    // Integrity, with the reCAPTCHA fallback) to work at all: it reads
    // google-services.json and wires the Firebase app identity into the
    // build. Its version is declared once in settings.gradle.kts.
    id("com.google.gms.google-services")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.drs.godownbook"
    // Pinned rather than left on flutter.compileSdkVersion: Google Play
    // requires new apps to target API level 36, and an explicit value
    // means the requirement is met whatever SDK the build machine has.
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // The app's permanent Play Store identity. Never change this
        // after the first release: Play keys the listing on it, and a
        // change creates a completely separate app.
        applicationId = "com.drs.godownbook"
        minSdk = 23
        targetSdk = 36
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = keystoreProperties["storeFile"]?.let { file(it) }
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                // No keystore on this machine - debug signing keeps
                // local release builds runnable. A build signed this way
                // cannot be uploaded to Play, which is the honest
                // outcome rather than a silent failure later.
                signingConfigs.getByName("debug")
            }

            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
