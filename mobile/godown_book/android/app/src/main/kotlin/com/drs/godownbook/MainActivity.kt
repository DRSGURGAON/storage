// The manifest declares this activity as ".MainActivity", which the
// build resolves against the module's namespace - com.drs.godownbook.
// The package here has to match that exactly, or the launcher asks for
// a class that does not exist and the app dies the moment it is opened.
package com.drs.godownbook

import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

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

        // A report's Excel file: saved into Downloads, or handed to an
        // app (WhatsApp, Gmail) or the share sheet.
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "com.drs.godownbook/file_share",
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "saveFileToDownloads" -> saveFileToDownloads(
                    call.argument<String>("filePath"),
                    call.argument<String>("fileName"),
                    call.argument<String>("mimeType") ?: "application/octet-stream",
                    result,
                )
"openWhatsAppChat" -> openWhatsAppChat(
                    call.argument<String>("phone"),
                    call.argument<String>("targetPackage"),
                    call.argument<String>("text") ?: "",
                    result,
                )
                "shareFile" -> shareFile(
                    call.argument<String>("filePath"),
                    call.argument<String>("mimeType") ?: "application/octet-stream",
                    call.argument<String>("targetPackage"),
                    call.argument<String>("subject"),
                    result,
                )
                else -> result.notImplemented()
            }
        }
    }

    /** Opens a chat, with the message typed in, in exactly the chosen
     *  app - WhatsApp or WhatsApp Business. A plain wa.me link always
     *  went to the phone's default WhatsApp. */
    private fun openWhatsAppChat(
        phone: String?,
        targetPackage: String?,
        text: String,
        result: MethodChannel.Result,
    ) {
        if (phone.isNullOrEmpty() || targetPackage.isNullOrEmpty()) {
            result.error("BAD_ARGS", "phone and targetPackage are required", null)
            return
        }
        val link = Uri.parse("https://api.whatsapp.com/send").buildUpon()
            .appendQueryParameter("phone", phone)
            .apply { if (text.isNotEmpty()) appendQueryParameter("text", text) }
            .build()
        val intent = Intent(Intent.ACTION_VIEW, link).apply {
            setPackage(targetPackage)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            startActivity(intent)
            result.success(true)
        } catch (e: ActivityNotFoundException) {
            result.error("APP_NOT_FOUND", "$targetPackage is not installed", null)
        }
    }

    /** Copies a file the app just wrote into the public Downloads folder
     *  (MediaStore on Android 10+, which needs no storage permission). */
    private fun saveFileToDownloads(
        filePath: String?,
        fileName: String?,
        mimeType: String,
        result: MethodChannel.Result,
    ) {
        if (filePath.isNullOrEmpty() || fileName.isNullOrEmpty()) {
            result.error("BAD_ARGS", "filePath and fileName are required", null)
            return
        }
        val source = File(filePath)
        if (!source.exists()) {
            result.error("FILE_NOT_FOUND", "File does not exist: $filePath", null)
            return
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                    put(MediaStore.Downloads.MIME_TYPE, mimeType)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw java.io.IOException("Could not create the file in Downloads")
                resolver.openOutputStream(uri).use { out ->
                    if (out == null) throw java.io.IOException("Could not open the file for writing")
                    source.inputStream().use { input -> input.copyTo(out) }
                }
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                result.success("Downloads/$fileName")
            } else {
                // Android 9 and older need a storage permission the app does
                // not ask for; if refused, the Dart side keeps its own copy.
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                dir.mkdirs()
                val destination = File(dir, fileName)
                source.copyTo(destination, overwrite = true)
                result.success(destination.absolutePath)
            }
        } catch (e: Exception) {
            result.error("SAVE_FAILED", e.message, null)
        }
    }

    /** Sends a file from the cache folder: to [targetPackage] when given
     *  (fails if that app is not installed), otherwise via the share sheet. */
    private fun shareFile(
        filePath: String?,
        mimeType: String,
        targetPackage: String?,
        subject: String?,
        result: MethodChannel.Result,
    ) {
        if (filePath.isNullOrEmpty()) {
            result.error("BAD_ARGS", "filePath is required", null)
            return
        }
        val file = File(filePath)
        if (!file.exists()) {
            result.error("FILE_NOT_FOUND", "File does not exist: $filePath", null)
            return
        }

        val uri: Uri = try {
            FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        } catch (e: IllegalArgumentException) {
            result.error("PROVIDER_ERROR", e.message, null)
            return
        }

        val send = Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            if (!subject.isNullOrEmpty()) putExtra(Intent.EXTRA_SUBJECT, subject)
            if (!targetPackage.isNullOrEmpty()) setPackage(targetPackage)
        }

        try {
            if (targetPackage.isNullOrEmpty()) {
                startActivity(Intent.createChooser(send, subject ?: "Share"))
            } else {
                startActivity(send)
            }
            result.success(true)
        } catch (e: ActivityNotFoundException) {
            result.error("APP_NOT_FOUND", "$targetPackage is not installed", null)
        }
    }
}
