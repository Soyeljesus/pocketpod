package com.pocketpod.app

import android.accounts.Account
import android.app.Activity
import android.content.Intent
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.core.content.ContextCompat
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.identity.RevokeAccessRequest
import com.google.android.gms.common.api.Scope
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.lang.ref.WeakReference

@InvokeArg
class SaveFileArgs {
  var fileName: String = "FoYu.csv"
  var content: String = ""
  var mimeType: String = "text/csv"
}

@InvokeArg
class WidgetArgs {
  var title: String = ""
  var artist: String = ""
  var artworkUrl: String? = null
  var playing: Boolean = false
  var tint: String = ""
  var accent: String = ""
}

@InvokeArg
class GoogleSignInArgs {
  var clientId: String = ""
  var nonce: String = ""
}

@InvokeArg
class YoutubeAccessArgs {
  var email: String = ""
  var interactive: Boolean = false
}

private const val YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly"

/** Funciones nativas de FoYu: archivos, cuenta y salida al segundo plano. */
@TauriPlugin
class MediaSessionPlugin(private val activity: Activity) : Plugin(activity) {
  private var pendingFileContent: String? = null
  private var page: WeakReference<WebView>? = null

  override fun load(webView: WebView) {
    super.load(webView)
    page = WeakReference(webView)
    current = WeakReference(this)
    FoYuWidgets.refresh(activity)
  }

  override fun onDestroy() {
    if (current?.get() === this) current = null
    FoYuWidgets.refresh(activity)
    super.onDestroy()
  }

  private fun runWidgetAction(action: String): Boolean {
    val view = page?.get() ?: return false
    view.post {
      view.evaluateJavascript("window.__foyuWidget && window.__foyuWidget('$action')", null)
    }
    return true
  }

  /** Muestra en los widgets lo que está sonando. */
  @Command
  fun updateWidget(invoke: Invoke) {
    val args = invoke.parseArgs(WidgetArgs::class.java)
    FoYuWidgets.update(
      activity,
      args.title,
      args.artist,
      args.artworkUrl.orEmpty(),
      args.playing,
      args.tint,
      args.accent,
    )
    invoke.resolve()
  }

  /** Abre el selector del sistema para que la persona elija dónde guardar. */
  @Command
  fun saveTextFile(invoke: Invoke) {
    val args = invoke.parseArgs(SaveFileArgs::class.java)
    pendingFileContent = args.content
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = args.mimeType
      putExtra(Intent.EXTRA_TITLE, args.fileName)
    }
    startActivityForResult(invoke, intent, "onSaveFilePicked")
  }

  @ActivityCallback
  fun onSaveFilePicked(invoke: Invoke, result: ActivityResult) {
    val content = pendingFileContent
    pendingFileContent = null
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null || content == null) {
      invoke.resolve(JSObject().put("saved", false))
      return
    }

    Thread {
      try {
        val stream = activity.contentResolver.openOutputStream(uri, "wt")
          ?: throw IllegalStateException("No se pudo abrir el archivo")
        stream.use { it.write(content.toByteArray(Charsets.UTF_8)) }
        invoke.resolve(JSObject().put("saved", true))
      } catch (error: Exception) {
        invoke.reject(error.message ?: "No se pudo guardar el archivo")
      }
    }.start()
  }

  /** Muestra el selector nativo de cuentas de Google. */
  @Command
  fun googleSignIn(invoke: Invoke) {
    val args = invoke.parseArgs(GoogleSignInArgs::class.java)
    val option = GetSignInWithGoogleOption.Builder(args.clientId)
      .setNonce(args.nonce)
      .build()
    val request = GetCredentialRequest.Builder().addCredentialOption(option).build()

    CredentialManager.create(activity).getCredentialAsync(
      activity,
      request,
      null,
      ContextCompat.getMainExecutor(activity),
      object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
        override fun onResult(result: GetCredentialResponse) {
          val credential = result.credential
          if (
            credential is CustomCredential &&
            credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
          ) {
            val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
            invoke.resolve(JSObject().put("idToken", idToken))
          } else {
            invoke.reject("google_invalid_credential")
          }
        }

        override fun onError(e: GetCredentialException) {
          invoke.reject(
            if (e is GetCredentialCancellationException) "google_cancelled"
            else "google_unavailable",
          )
        }
      },
    )
  }

  /** Olvida la cuenta elegida al cerrar sesión. */
  @Command
  fun clearGoogleCredential(invoke: Invoke) {
    CredentialManager.create(activity).clearCredentialStateAsync(
      ClearCredentialStateRequest(),
      null,
      ContextCompat.getMainExecutor(activity),
      object : CredentialManagerCallback<Void?, ClearCredentialException> {
        override fun onResult(result: Void?) = invoke.resolve()
        override fun onError(e: ClearCredentialException) = invoke.resolve()
      },
    )
  }

  /** Pide permiso de solo lectura. El token dura poco y nunca se guarda. */
  @Command
  fun youtubeAccessToken(invoke: Invoke) {
    val args = invoke.parseArgs(YoutubeAccessArgs::class.java)
    val builder = AuthorizationRequest.builder()
      .setRequestedScopes(listOf(Scope(YOUTUBE_READONLY_SCOPE)))
    if (args.email.isNotBlank()) {
      builder.setAccount(Account(args.email, "com.google"))
    }

    Identity.getAuthorizationClient(activity)
      .authorize(builder.build())
      .addOnSuccessListener { result ->
        val pendingIntent = result.pendingIntent
        when {
          !result.hasResolution() -> resolveYoutubeToken(invoke, result)
          !args.interactive || pendingIntent == null -> invoke.reject("youtube_consent_required")
          else -> startIntentSenderForResult(
            invoke,
            IntentSenderRequest.Builder(pendingIntent.intentSender).build(),
            "onYoutubeAuthorized",
          )
        }
      }
      .addOnFailureListener { invoke.reject("youtube_authorization_failed") }
  }

  @ActivityCallback
  fun onYoutubeAuthorized(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK) {
      invoke.reject("youtube_cancelled")
      return
    }
    try {
      resolveYoutubeToken(
        invoke,
        Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(result.data),
      )
    } catch (_: Exception) {
      invoke.reject("youtube_authorization_failed")
    }
  }

  private fun resolveYoutubeToken(invoke: Invoke, result: AuthorizationResult) {
    val token = result.accessToken
    if (token.isNullOrEmpty()) {
      invoke.reject("youtube_authorization_failed")
    } else {
      invoke.resolve(JSObject().put("accessToken", token))
    }
  }

  /** Retira de la cuenta de Google el permiso concedido a la app. */
  @Command
  fun revokeYoutubeAccess(invoke: Invoke) {
    val args = invoke.parseArgs(YoutubeAccessArgs::class.java)
    if (args.email.isBlank()) {
      invoke.reject("youtube_account_missing")
      return
    }
    val request = RevokeAccessRequest.builder()
      .setAccount(Account(args.email, "com.google"))
      .setScopes(listOf(Scope(YOUTUBE_READONLY_SCOPE)))
      .build()
    Identity.getAuthorizationClient(activity)
      .revokeAccess(request)
      .addOnSuccessListener { invoke.resolve() }
      .addOnFailureListener { invoke.reject("youtube_revoke_failed") }
  }

  companion object {
    private var current: WeakReference<MediaSessionPlugin>? = null

    fun isRunning(): Boolean = current?.get() != null

    fun sendWidgetAction(action: String): Boolean {
      if (action !in setOf("toggle", "next", "previous")) return false
      return current?.get()?.runWidgetAction(action) == true
    }
  }

  /** Sale a la pantalla anterior sin detener la música. */
  @Command
  fun moveToBackground(invoke: Invoke) {
    activity.moveTaskToBack(true)
    invoke.resolve()
  }
}
