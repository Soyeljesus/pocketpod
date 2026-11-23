package com.pocketpod.app

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.lang.ref.WeakReference

/**
 * Reproductor en la barra de notificaciones y en la pantalla de bloqueo.
 *
 * El audio suena en la vista web; aquí solo se publica qué suena y se
 * reenvían los botones (notificación, auriculares, reloj) a la app. Las
 * notificaciones de una sesión multimedia no necesitan el permiso de
 * notificaciones en Android 13 o superior.
 */
object FoYuPlayback {
  private const val CHANNEL = "foyu_playback"
  const val NOTIFICATION_ID = 7301

  private var session: MediaSessionCompat? = null
  private var metadataKey = ""

  private fun session(context: Context): MediaSessionCompat {
    session?.let { return it }
    val created = MediaSessionCompat(context, "FoYu").apply {
      setSessionActivity(FoYuWidgets.openApp(context))
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() { send("play") }
        override fun onPause() { send("pause") }
        override fun onSkipToNext() { send("next") }
        override fun onSkipToPrevious() { send("previous") }
        override fun onFastForward() { send("forward") }
        override fun onRewind() { send("rewind") }
        override fun onStop() { send("pause") }
        override fun onSeekTo(pos: Long) { send("seek:${(pos / 1000).coerceAtLeast(0)}") }
      }, Handler(Looper.getMainLooper()))
    }
    session = created
    return created
  }

  private fun send(action: String) {
    MediaSessionPlugin.sendWidgetAction(action)
  }

  private val main = Handler(Looper.getMainLooper())

  /** Vuelve a publicar el estado guardado por los widgets (siempre en el hilo principal). */
  fun refresh(context: Context) {
    val app = context.applicationContext
    if (Looper.myLooper() != Looper.getMainLooper()) {
      main.post { refresh(app) }
      return
    }
    val prefs = FoYuWidgets.prefs(app)
    val title = prefs.getString("title", "").orEmpty()
    if (!MediaSessionPlugin.isRunning() || title.isBlank()) {
      stop(app)
      return
    }
    val artist = prefs.getString("artist", "").orEmpty()
    val playing = prefs.getBoolean("playing", false)
    val duration = prefs.getLong("duration_ms", 0)
    val position = FoYuWidgets.positionNow(app)
    val art = FoYuWidgets.loadArt(app)
    val media = session(app)

    val key = "$title|$artist|$duration|${art != null}|${prefs.getString("art_url", "")}"
    if (key != metadataKey) {
      metadataKey = key
      media.setMetadata(
        MediaMetadataCompat.Builder()
          .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
          .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
          .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, if (duration > 0) duration else -1)
          .apply { if (art != null) putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art) }
          .build(),
      )
    }

    media.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(
          PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_FAST_FORWARD or
            PlaybackStateCompat.ACTION_REWIND or
            PlaybackStateCompat.ACTION_STOP or
            PlaybackStateCompat.ACTION_SEEK_TO,
        )
        .setState(
          if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
          position,
          if (playing) 1f else 0f,
        )
        .build(),
    )
    media.isActive = true

    if (playing) {
      PlaybackService.start(app)
    } else {
      PlaybackService.pause(app)
    }
  }

  fun stop(context: Context) {
    metadataKey = ""
    PlaybackService.stop(context)
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    session?.let {
      it.isActive = false
      it.release()
    }
    session = null
  }

  private fun ensureChannel(context: Context) {
    NotificationManagerCompat.from(context).createNotificationChannel(
      NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW)
        .setName(context.getString(R.string.playback_channel))
        .setDescription(context.getString(R.string.playback_channel_description))
        .setShowBadge(false)
        .build(),
    )
  }

  fun buildNotification(context: Context): Notification? {
    val media = session ?: return null
    val prefs = FoYuWidgets.prefs(context)
    val title = prefs.getString("title", "").orEmpty()
    if (title.isBlank()) return null
    val playing = prefs.getBoolean("playing", false)
    ensureChannel(context)

    return NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_widget_note)
      .setContentTitle(title)
      .setContentText(prefs.getString("artist", "").orEmpty())
      .setLargeIcon(FoYuWidgets.loadArt(context))
      .setContentIntent(FoYuWidgets.openApp(context))
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setSilent(true)
      .setOngoing(playing)
      .addAction(
        R.drawable.ic_widget_previous,
        context.getString(R.string.widget_previous),
        FoYuWidgets.action(context, FoYuWidgets.ACTION_PREVIOUS, 13),
      )
      .addAction(
        if (playing) R.drawable.ic_widget_pause else R.drawable.ic_widget_play,
        context.getString(if (playing) R.string.widget_pause else R.string.widget_play),
        FoYuWidgets.action(context, FoYuWidgets.ACTION_TOGGLE, 11),
      )
      .addAction(
        R.drawable.ic_widget_next,
        context.getString(R.string.widget_next),
        FoYuWidgets.action(context, FoYuWidgets.ACTION_NEXT, 12),
      )
      .setStyle(
        androidx.media.app.NotificationCompat.MediaStyle()
          .setMediaSession(media.sessionToken)
          .setShowActionsInCompactView(0, 1, 2),
      )
      .build()
  }
}

/**
 * Mantiene viva la app mientras suena música con la pantalla apagada o en
 * otra app. Se detiene en cuanto la música se pausa o la app se cierra.
 */
class PlaybackService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = WeakReference(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = FoYuPlayback.buildNotification(this)
    if (notification == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      ServiceCompat.startForeground(
        this,
        FoYuPlayback.NOTIFICATION_ID,
        notification,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        } else {
          0
        },
      )
    } catch (_: Exception) {
      // Si Android no deja pasar a primer plano, al menos se muestra el reproductor.
      notify(this, notification)
      stopSelf()
    }
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Al cerrar FoYu desde recientes, el audio se detiene: se quita el reproductor.
    FoYuPlayback.stop(applicationContext)
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    if (instance?.get() === this) instance = null
    super.onDestroy()
  }

  companion object {
    private var instance: WeakReference<PlaybackService>? = null

    private fun notify(context: Context, notification: Notification) {
      try {
        NotificationManagerCompat.from(context).notify(FoYuPlayback.NOTIFICATION_ID, notification)
      } catch (_: SecurityException) {
        // Sin permiso de notificaciones no se puede mostrar nada más.
      }
    }

    fun start(context: Context) {
      try {
        ContextCompat.startForegroundService(context, Intent(context, PlaybackService::class.java))
      } catch (_: Exception) {
        FoYuPlayback.buildNotification(context)?.let { notify(context, it) }
      }
    }

    /** En pausa la notificación se puede descartar y el servicio se detiene. */
    fun pause(context: Context) {
      val notification = FoYuPlayback.buildNotification(context) ?: return
      instance?.get()?.let {
        ServiceCompat.stopForeground(it, ServiceCompat.STOP_FOREGROUND_DETACH)
        it.stopSelf()
      }
      notify(context, notification)
    }

    fun stop(context: Context) {
      instance?.get()?.let {
        ServiceCompat.stopForeground(it, ServiceCompat.STOP_FOREGROUND_REMOVE)
        it.stopSelf()
      }
    }
  }
}
