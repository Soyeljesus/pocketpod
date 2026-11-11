package com.pocketpod.app

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream

@InvokeArg
class SeekArgs {
  var seconds: Double = 0.0
}

/**
 * Puente entre PocketPod y las sesiones multimedia de Android.
 *
 * Android no permite leer ni controlar la reproducción de otras apps sin el
 * permiso de acceso a notificaciones. Por eso el plugin comprueba ese permiso
 * y, si falta, el frontend muestra un aviso para activarlo.
 */
@TauriPlugin
class MediaSessionPlugin(private val activity: Activity) : Plugin(activity) {
  private val manager: MediaSessionManager
    get() = activity.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager

  private val listenerComponent: ComponentName
    get() = ComponentName(activity, MediaNotificationListener::class.java)

  // La portada se cachea por pista: decodificarla y comprimirla en cada
  // sondeo (una vez por segundo) sería muy caro.
  private var artworkCacheKey: String = "<none>"
  private var artworkCacheValue: String = ""

  private fun notificationAccessGranted(): Boolean {
    val enabled = Settings.Secure.getString(
      activity.contentResolver,
      "enabled_notification_listeners",
    ) ?: return false

    return enabled.split(':').any { flattened ->
      val component = ComponentName.unflattenFromString(flattened)
      component?.packageName == activity.packageName
    }
  }

  private fun isTargetPlayer(packageName: String): Boolean {
    val id = packageName.lowercase()
    return id.contains("spotify") || id.contains("apple") || id.contains("itunes")
  }

  private fun activeControllers(): List<MediaController> {
    return try {
      manager.getActiveSessions(listenerComponent)
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun isPlaying(controller: MediaController): Boolean {
    return controller.playbackState?.state == PlaybackState.STATE_PLAYING
  }

  /** Prioriza el reproductor que está sonando; después Spotify/Apple Music. */
  private fun pickController(): MediaController? {
    val controllers = activeControllers()
    return controllers.firstOrNull { isPlaying(it) && isTargetPlayer(it.packageName) }
      ?: controllers.firstOrNull { isPlaying(it) }
      ?: controllers.firstOrNull { isTargetPlayer(it.packageName) }
      ?: controllers.firstOrNull()
  }

  private fun metadataString(metadata: MediaMetadata?, key: String): String {
    return metadata?.getString(key)?.trim().orEmpty()
  }

  private fun artworkDataUrl(metadata: MediaMetadata): String {
    val artKey = listOf(
      metadataString(metadata, MediaMetadata.METADATA_KEY_TITLE),
      metadataString(metadata, MediaMetadata.METADATA_KEY_ARTIST),
      metadataString(metadata, MediaMetadata.METADATA_KEY_ALBUM),
    ).joinToString("|")

    if (artKey == artworkCacheKey) {
      return artworkCacheValue
    }

    var bitmap: Bitmap? = metadata.getBitmap(MediaMetadata.METADATA_KEY_ART)
      ?: metadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
      ?: metadata.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)

    if (bitmap == null) {
      val artUri = metadata.getString(MediaMetadata.METADATA_KEY_ART_URI)
        ?: metadata.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI)

      if (!artUri.isNullOrBlank()) {
        try {
          val uri = Uri.parse(artUri)
          if (uri.scheme == "content" || uri.scheme == "file") {
            bitmap = activity.contentResolver.openInputStream(uri)?.use(BitmapFactory::decodeStream)
          }
        } catch (_: Exception) {
          bitmap = null
        }
      }
    }

    if (bitmap == null) {
      artworkCacheKey = artKey
      artworkCacheValue = ""
      return ""
    }

    val maxSide = 320
    val largest = maxOf(bitmap.width, bitmap.height)
    val scaled = if (largest > maxSide) {
      val ratio = maxSide.toFloat() / largest.toFloat()
      Bitmap.createScaledBitmap(
        bitmap,
        (bitmap.width * ratio).toInt().coerceAtLeast(1),
        (bitmap.height * ratio).toInt().coerceAtLeast(1),
        true,
      )
    } else {
      bitmap
    }

    val output = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, 82, output)
    val encoded = "data:image/jpeg;base64," +
      Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)

    artworkCacheKey = artKey
    artworkCacheValue = encoded
    return encoded
  }

  private fun playbackStatus(state: Int?): String {
    return when (state) {
      PlaybackState.STATE_PLAYING -> "playing"
      PlaybackState.STATE_PAUSED,
      PlaybackState.STATE_BUFFERING,
      PlaybackState.STATE_CONNECTING,
      PlaybackState.STATE_FAST_FORWARDING,
      PlaybackState.STATE_REWINDING,
      -> "paused"
      PlaybackState.STATE_STOPPED,
      PlaybackState.STATE_NONE,
      PlaybackState.STATE_ERROR,
      -> "stopped"
      else -> "unknown"
    }
  }

  private fun buildState(): JSObject {
    val granted = notificationAccessGranted()
    val result = JSObject()
    result.put("title", "")
    result.put("artist", "")
    result.put("album", "")
    result.put("artwork_data_url", "")
    result.put("status", "unknown")
    result.put("position_sec", 0.0)
    result.put("duration_sec", 0.0)
    result.put("can_seek", false)
    result.put("connected", false)
    result.put("source_app_id", "")
    result.put("permission_granted", granted)

    if (!granted) return result

    val controller = pickController() ?: return result
    val metadata = controller.metadata
    val playback = controller.playbackState

    val status = playbackStatus(playback?.state)
    val durationMs = metadata?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L
    val durationSec = durationMs.toDouble() / 1000.0

    var positionSec = (playback?.position ?: 0L).toDouble() / 1000.0
    if (status == "playing" && playback != null) {
      val lastUpdate = playback.lastPositionUpdateTime
      if (lastUpdate > 0L) {
        val elapsed = (SystemClock.elapsedRealtime() - lastUpdate).toDouble() / 1000.0
        if (elapsed in 0.0..86_400.0) {
          positionSec += elapsed
        }
      }
    }
    if (durationSec > 0.0) {
      positionSec = positionSec.coerceIn(0.0, durationSec)
    }

    val canSeek = playback != null &&
      (playback.actions and PlaybackState.ACTION_SEEK_TO) != 0L

    result.put("title", metadataString(metadata, MediaMetadata.METADATA_KEY_TITLE))
    result.put(
      "artist",
      metadataString(metadata, MediaMetadata.METADATA_KEY_ARTIST).ifEmpty {
        metadataString(metadata, MediaMetadata.METADATA_KEY_ALBUM_ARTIST)
      },
    )
    result.put("album", metadataString(metadata, MediaMetadata.METADATA_KEY_ALBUM))
    result.put("artwork_data_url", if (metadata != null) artworkDataUrl(metadata) else "")
    result.put("status", status)
    result.put("position_sec", positionSec)
    result.put("duration_sec", durationSec)
    result.put("can_seek", canSeek)
    result.put("connected", true)
    result.put("source_app_id", controller.packageName)

    return result
  }

  @Command
  fun getMediaState(invoke: Invoke) {
    try {
      invoke.resolve(buildState())
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "No se pudo leer la sesión multimedia")
    }
  }

  @Command
  fun togglePlayPause(invoke: Invoke) {
    val controller = pickController()
    if (controller == null) {
      invoke.reject("No hay ningún reproductor activo")
      return
    }

    try {
      if (isPlaying(controller)) {
        controller.transportControls.pause()
      } else {
        controller.transportControls.play()
      }
      invoke.resolve()
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "No se pudo cambiar la reproducción")
    }
  }

  @Command
  fun skipNext(invoke: Invoke) {
    val controller = pickController()
    if (controller == null) {
      invoke.reject("No hay ningún reproductor activo")
      return
    }
    controller.transportControls.skipToNext()
    invoke.resolve()
  }

  @Command
  fun skipPrevious(invoke: Invoke) {
    val controller = pickController()
    if (controller == null) {
      invoke.reject("No hay ningún reproductor activo")
      return
    }
    controller.transportControls.skipToPrevious()
    invoke.resolve()
  }

  @Command
  fun seekTo(invoke: Invoke) {
    val controller = pickController()
    if (controller == null) {
      invoke.reject("No hay ningún reproductor activo")
      return
    }

    try {
      val args = invoke.parseArgs(SeekArgs::class.java)
      controller.transportControls.seekTo((args.seconds * 1000.0).toLong())
      invoke.resolve()
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "No se pudo cambiar la posición")
    }
  }

  @Command
  fun openNotificationSettings(invoke: Invoke) {
    try {
      val component = ComponentName(activity, MediaNotificationListener::class.java)
      val detail = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).apply {
        putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component.flattenToString())
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

      try {
        activity.startActivity(detail)
      } catch (_: Exception) {
        val general = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(general)
      }

      invoke.resolve()
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "No se pudieron abrir los ajustes")
    }
  }
}
