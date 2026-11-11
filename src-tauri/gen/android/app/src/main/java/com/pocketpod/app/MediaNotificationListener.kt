package com.pocketpod.app

import android.service.notification.NotificationListenerService

/**
 * Servicio vacío. Su única función es que Android conceda a PocketPod acceso
 * a las sesiones multimedia de otras apps. El usuario lo habilita una vez
 * desde Ajustes › Acceso a notificaciones.
 */
class MediaNotificationListener : NotificationListenerService()
