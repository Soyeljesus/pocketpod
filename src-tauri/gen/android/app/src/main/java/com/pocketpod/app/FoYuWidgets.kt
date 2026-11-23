package com.pocketpod.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Dibuja los widgets. Solo guarda en el teléfono la canción actual y su portada. */
object FoYuWidgets {
  const val ACTION_TOGGLE = "com.pocketpod.app.widget.TOGGLE"
  const val ACTION_NEXT = "com.pocketpod.app.widget.NEXT"
  const val ACTION_PREVIOUS = "com.pocketpod.app.widget.PREVIOUS"
  const val ACTION_REWIND = "com.pocketpod.app.widget.REWIND"
  const val ACTION_FORWARD = "com.pocketpod.app.widget.FORWARD"

  private const val PREFS = "foyu_widget"
  private const val ART_FILE = "widget_art.png"
  private const val ART_SIZE = 240
  private const val MAX_ART_BYTES = 3 * 1024 * 1024
  private val COLOR = Regex("^#[0-9a-fA-F]{6}$")
  private val artWorker = Executors.newSingleThreadExecutor()

  fun update(
    context: Context,
    title: String,
    artist: String,
    artworkUrl: String,
    playing: Boolean,
    tint: String,
    accent: String,
    positionMs: Long,
    durationMs: Long,
  ) {
    val app = context.applicationContext
    val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val artChanged = prefs.getString("art_url", "") != artworkUrl
    prefs.edit()
      .putString("title", title.take(160))
      .putString("artist", artist.take(160))
      .putString("art_url", artworkUrl)
      .putBoolean("playing", playing)
      .putLong("position_ms", positionMs.coerceAtLeast(0))
      .putLong("duration_ms", durationMs.coerceAtLeast(0))
      .putLong("updated_at", SystemClock.elapsedRealtime())
      .putString("tint", if (COLOR.matches(tint)) tint else "#1d2f7b")
      .putString("accent", if (COLOR.matches(accent)) accent else "#b9c6ff")
      .apply()

    if (artChanged) {
      artFile(app).delete()
      if (artworkUrl.isNotEmpty()) artWorker.execute { downloadArt(app, artworkUrl) }
    }
    refresh(app)
  }

  /** Posición estimada ahora mismo, contando el tiempo desde la última actualización. */
  fun positionNow(context: Context): Long {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val position = prefs.getLong("position_ms", 0)
    val duration = prefs.getLong("duration_ms", 0)
    if (!prefs.getBoolean("playing", false)) return position
    val elapsed = SystemClock.elapsedRealtime() - prefs.getLong("updated_at", 0)
    val estimate = position + elapsed.coerceAtLeast(0)
    return if (duration > 0) estimate.coerceAtMost(duration) else estimate
  }

  fun formatTime(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val seconds = total % 60
    return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds)
    else "%d:%02d".format(minutes, seconds)
  }

  fun refresh(context: Context) {
    val app = context.applicationContext
    FoYuPlayback.refresh(app)
    val manager = AppWidgetManager.getInstance(app) ?: return
    render(app, manager, FoYuCompactWidget::class.java, R.layout.widget_compact)
    render(app, manager, FoYuLargeWidget::class.java, R.layout.widget_large)
  }

  private fun render(
    context: Context,
    manager: AppWidgetManager,
    provider: Class<out AppWidgetProvider>,
    layout: Int,
  ) {
    val ids = manager.getAppWidgetIds(ComponentName(context, provider))
    if (ids.isEmpty()) return
    manager.updateAppWidget(ids, build(context, layout))
  }

  private fun build(context: Context, layout: Int): RemoteViews {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val running = MediaSessionPlugin.isRunning()
    val title = prefs.getString("title", "").orEmpty()
    val active = running && title.isNotBlank()
    val playing = active && prefs.getBoolean("playing", false)
    val views = RemoteViews(context.packageName, layout)

    views.setTextViewText(R.id.widget_title, if (active) title else "FoYu")
    views.setTextViewText(
      R.id.widget_artist,
      if (active) prefs.getString("artist", "").orEmpty()
      else context.getString(R.string.widget_idle),
    )
    views.setInt(
      R.id.widget_bg,
      "setColorFilter",
      Color.parseColor(if (active) prefs.getString("tint", "#1d2f7b") else "#172649"),
    )
    views.setInt(
      R.id.widget_play_bg,
      "setColorFilter",
      Color.parseColor(if (active) prefs.getString("accent", "#b9c6ff") else "#b9c6ff"),
    )
    views.setImageViewResource(
      R.id.widget_play_icon,
      if (playing) R.drawable.ic_widget_pause else R.drawable.ic_widget_play,
    )
    views.setContentDescription(
      R.id.widget_play,
      context.getString(if (playing) R.string.widget_pause else R.string.widget_play),
    )

    val art = if (active) loadArt(context) else null
    if (art != null) {
      views.setImageViewBitmap(R.id.widget_art, art)
      views.setViewPadding(R.id.widget_art, 0, 0, 0, 0)
    } else {
      val padding = (14 * context.resources.displayMetrics.density).toInt()
      views.setImageViewResource(R.id.widget_art, R.drawable.ic_widget_note)
      views.setViewPadding(R.id.widget_art, padding, padding, padding, padding)
    }

    val open = openApp(context)
    views.setOnClickPendingIntent(R.id.widget_root, open)
    views.setOnClickPendingIntent(
      R.id.widget_play,
      if (active) action(context, ACTION_TOGGLE, 1) else open,
    )
    views.setOnClickPendingIntent(
      R.id.widget_next,
      if (active) action(context, ACTION_NEXT, 2) else open,
    )
    if (layout == R.layout.widget_large) {
      views.setOnClickPendingIntent(
        R.id.widget_previous,
        if (active) action(context, ACTION_PREVIOUS, 3) else open,
      )
      views.setOnClickPendingIntent(
        R.id.widget_rewind,
        if (active) action(context, ACTION_REWIND, 4) else open,
      )
      views.setOnClickPendingIntent(
        R.id.widget_forward,
        if (active) action(context, ACTION_FORWARD, 5) else open,
      )
    }
    views.setViewVisibility(R.id.widget_next, View.VISIBLE)

    // Tiempo: el cronómetro avanza solo, sin despertar a la app cada segundo.
    val duration = prefs.getLong("duration_ms", 0)
    val showTime = active && duration > 0
    views.setViewVisibility(R.id.widget_time_row, if (showTime) View.VISIBLE else View.GONE)
    views.setViewVisibility(R.id.widget_progress, if (showTime) View.VISIBLE else View.GONE)
    if (showTime) {
      val position = positionNow(context)
      views.setChronometer(
        R.id.widget_elapsed,
        SystemClock.elapsedRealtime() - position,
        null,
        playing,
      )
      views.setTextViewText(
        R.id.widget_duration,
        if (layout == R.layout.widget_large) formatTime(duration)
        else " / ${formatTime(duration)}",
      )
      views.setProgressBar(
        R.id.widget_progress,
        1000,
        ((position * 1000) / duration).toInt().coerceIn(0, 1000),
        false,
      )
    }
    return views
  }

  internal fun action(context: Context, name: String, code: Int): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      code,
      Intent(context, WidgetActionReceiver::class.java).setAction(name),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  internal fun openApp(context: Context): PendingIntent =
    PendingIntent.getActivity(
      context,
      0,
      Intent(context, MainActivity::class.java)
        .setAction(Intent.ACTION_MAIN)
        .addCategory(Intent.CATEGORY_LAUNCHER)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun artFile(context: Context) = File(context.cacheDir, ART_FILE)

  internal fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  internal fun loadArt(context: Context): Bitmap? {
    val file = artFile(context)
    return if (file.exists()) BitmapFactory.decodeFile(file.path) else null
  }

  private fun allowedArtwork(url: URL): Boolean {
    val host = url.host.lowercase()
    return url.protocol == "https" &&
      listOf("googleusercontent.com", "ytimg.com", "ggpht.com").any { domain ->
        host == domain || host.endsWith(".$domain")
      }
  }

  private fun downloadArt(context: Context, address: String) {
    try {
      val url = URL(address)
      if (!allowedArtwork(url)) return
      val connection = url.openConnection() as HttpURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 6_000
      connection.readTimeout = 8_000
      val bytes = try {
        if (connection.responseCode != HttpURLConnection.HTTP_OK) return
        connection.inputStream.use { input ->
          val output = ByteArrayOutputStream()
          val buffer = ByteArray(16 * 1024)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
            if (output.size() > MAX_ART_BYTES) return
          }
          output.toByteArray()
        }
      } finally {
        connection.disconnect()
      }

      val source = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return
      val rounded = roundedSquare(source)
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      if (prefs.getString("art_url", "") != address) return
      artFile(context).outputStream().use {
        rounded.compress(Bitmap.CompressFormat.PNG, 100, it)
      }
      refresh(context)
    } catch (_: Exception) {
      // Sin portada, el widget muestra una nota musical.
    }
  }

  private fun roundedSquare(source: Bitmap): Bitmap {
    val side = minOf(source.width, source.height)
    val square = Bitmap.createBitmap(
      source,
      (source.width - side) / 2,
      (source.height - side) / 2,
      side,
      side,
    )
    val scaled = Bitmap.createScaledBitmap(square, ART_SIZE, ART_SIZE, true)
    val output = Bitmap.createBitmap(ART_SIZE, ART_SIZE, Bitmap.Config.ARGB_8888)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    }
    Canvas(output).drawRoundRect(
      RectF(0f, 0f, ART_SIZE.toFloat(), ART_SIZE.toFloat()),
      38f,
      38f,
      paint,
    )
    return output
  }
}

class FoYuCompactWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    FoYuWidgets.refresh(context)
  }
}

class FoYuLargeWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    FoYuWidgets.refresh(context)
  }
}

/** Recibe solo los botones del widget: no está disponible para otras apps. */
class WidgetActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = when (intent.action) {
      FoYuWidgets.ACTION_TOGGLE -> "toggle"
      FoYuWidgets.ACTION_NEXT -> "next"
      FoYuWidgets.ACTION_PREVIOUS -> "previous"
      FoYuWidgets.ACTION_REWIND -> "rewind"
      FoYuWidgets.ACTION_FORWARD -> "forward"
      else -> return
    }
    if (!MediaSessionPlugin.sendWidgetAction(action)) {
      FoYuWidgets.refresh(context)
    }
  }
}
