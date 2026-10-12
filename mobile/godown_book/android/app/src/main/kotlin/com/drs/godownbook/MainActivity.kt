// The manifest declares this activity as ".MainActivity", which the
// build resolves against the module's namespace - com.drs.godownbook.
// The package here has to match that exactly, or the launcher asks for
// a class that does not exist and the app dies the moment it is opened.
package com.drs.godownbook

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "com.drs.godownbook/clock",
        ).setMethodCallHandler { call, result ->
            if (call.method == "getClockInfo") {
                // elapsedRealtime (ms since boot, includes sleep) cannot be
                // changed by the user, unlike the wall clock; the boot
                // count says whether the counter has restarted since.
                // Used by TrustedClock so setting the phone's date back
                // cannot keep an expired subscription running.
                try {
                    val boot = android.provider.Settings.Global.getInt(
                        contentResolver,
                        android.provider.Settings.Global.BOOT_COUNT,
                        -1,
                    )
                    result.success(
                        mapOf(
                            "elapsed" to android.os.SystemClock.elapsedRealtime(),
                            "boot" to boot,
                        )
                    )
                } catch (e: Exception) {
                    result.error("NO_CLOCK", e.message, null)
                }
            } else {
                result.notImplemented()
            }
        }
    }
}
