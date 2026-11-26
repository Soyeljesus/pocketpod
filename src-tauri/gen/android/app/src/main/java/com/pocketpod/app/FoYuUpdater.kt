package com.pocketpod.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Descarga la versión nueva dentro de la app y abre el instalador de Android.
 *
 * Solo acepta archivos de las versiones publicadas del repositorio de FoYu,
 * y antes de instalar comprueba que el APK sea de esta misma app. Android
 * además rechaza la actualización si no está firmada con la misma clave.
 */
object FoYuUpdater {
  private const val RELEASES = "https://github.com/Soyeljesus/pocketpod/releases/download/"
  private val ALLOWED_HOSTS = setOf(
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
  )
  private const val MAX_BYTES = 200L * 1024 * 1024
  private const val MAX_REDIRECTS = 5

  private fun folder(activity: Activity) = File(activity.cacheDir, "updates").apply { mkdirs() }

  fun apkFile(activity: Activity, version: String) =
    File(folder(activity), "FoYu-${version.filter { it.isLetterOrDigit() || it == '.' }}.apk")

  /** Descarga el APK y avisa del progreso (0-100). Devuelve el archivo listo. */
  fun download(activity: Activity, address: String, version: String, progress: (Int) -> Unit): File {
    require(address.startsWith(RELEASES) && address.endsWith(".apk")) { "update_source_invalid" }

    // Se borran descargas viejas para no ocupar espacio.
    folder(activity).listFiles()?.forEach { it.delete() }
    val target = apkFile(activity, version)
    val partial = File(target.path + ".part")

    var url = URL(address)
    var connection: HttpURLConnection
    var redirects = 0
    while (true) {
      require(url.protocol == "https" && url.host.lowercase() in ALLOWED_HOSTS) { "update_source_invalid" }
      connection = (url.openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = false
        connectTimeout = 15_000
        readTimeout = 30_000
        setRequestProperty("Accept", "application/octet-stream")
      }
      val code = connection.responseCode
      if (code in 300..399) {
        val next = connection.getHeaderField("Location") ?: throw IllegalStateException("update_download_failed")
        connection.disconnect()
        require(++redirects <= MAX_REDIRECTS) { "update_download_failed" }
        url = URL(url, next)
        continue
      }
      if (code != HttpURLConnection.HTTP_OK) {
        connection.disconnect()
        throw IllegalStateException("update_download_failed")
      }
      break
    }

    try {
      val total = connection.contentLengthLong
      if (total > MAX_BYTES) throw IllegalStateException("update_too_large")
      var done = 0L
      var lastReported = -1
      connection.inputStream.use { input ->
        partial.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
            done += count
            if (done > MAX_BYTES) throw IllegalStateException("update_too_large")
            if (total > 0) {
              val percent = ((done * 100) / total).toInt()
              if (percent != lastReported) {
                lastReported = percent
                progress(percent)
              }
            }
          }
        }
      }
    } finally {
      connection.disconnect()
    }

    // Debe ser un APK de esta misma app; si no, se descarta.
    val info = activity.packageManager.getPackageArchiveInfo(partial.path, 0)
    if (info?.packageName != activity.packageName) {
      partial.delete()
      throw IllegalStateException("update_not_foyu")
    }
    if (!partial.renameTo(target)) throw IllegalStateException("update_download_failed")
    progress(100)
    return target
  }

  /** Android 8+ pide permitir, una sola vez, que FoYu instale actualizaciones. */
  fun canInstall(activity: Activity): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activity.packageManager.canRequestPackageInstalls()

  fun openInstallPermission(activity: Activity) {
    activity.startActivity(
      Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${activity.packageName}"),
      ),
    )
  }

  fun install(activity: Activity, file: File) {
    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
    activity.startActivity(
      Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }
}
