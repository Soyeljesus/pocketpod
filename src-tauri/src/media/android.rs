use super::MediaStateDto;
use tauri::plugin::PluginHandle;
use tauri::Wry;

/// Handle al plugin nativo Kotlin registrado en `lib.rs`. Se guarda en el
/// estado de la app para que los comandos puedan hablar con Android.
#[derive(Clone)]
pub struct AndroidMediaHandle(pub PluginHandle<Wry>);

fn call<T: serde::de::DeserializeOwned>(
    handle: &AndroidMediaHandle,
    command: &str,
    payload: impl serde::Serialize,
) -> Result<T, String> {
    handle
        .0
        .run_mobile_plugin(command, payload)
        .map_err(|err| err.to_string())
}

const NOT_AVAILABLE: &str = "No disponible en Android";

/// FoYu no lee la reproducción de otras apps en Android.
pub fn get_media_state(_handle: &AndroidMediaHandle) -> MediaStateDto {
    MediaStateDto::empty()
}

pub fn toggle_play_pause(_handle: &AndroidMediaHandle) -> Result<(), String> {
    Err(NOT_AVAILABLE.to_string())
}

pub fn skip_next(_handle: &AndroidMediaHandle) -> Result<(), String> {
    Err(NOT_AVAILABLE.to_string())
}

pub fn skip_previous(_handle: &AndroidMediaHandle) -> Result<(), String> {
    Err(NOT_AVAILABLE.to_string())
}

pub fn seek_to(_handle: &AndroidMediaHandle, _seconds: f64) -> Result<(), String> {
    Err(NOT_AVAILABLE.to_string())
}

#[derive(serde::Deserialize)]
struct SaveFileResult {
    saved: bool,
}

pub fn save_text_file(
    handle: &AndroidMediaHandle,
    file_name: String,
    content: String,
    mime_type: String,
) -> Result<bool, String> {
    call::<SaveFileResult>(
        handle,
        "saveTextFile",
        serde_json::json!({
            "fileName": file_name,
            "content": content,
            "mimeType": mime_type,
        }),
    )
    .map(|result| result.saved)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleSignInResult {
    id_token: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeTokenResult {
    access_token: String,
}

pub fn google_sign_in(
    handle: &AndroidMediaHandle,
    client_id: String,
    nonce: String,
) -> Result<String, String> {
    call::<GoogleSignInResult>(
        handle,
        "googleSignIn",
        serde_json::json!({ "clientId": client_id, "nonce": nonce }),
    )
    .map(|result| result.id_token)
}

pub fn clear_google_credential(handle: &AndroidMediaHandle) -> Result<(), String> {
    call::<Option<serde_json::Value>>(handle, "clearGoogleCredential", ()).map(|_| ())
}

pub fn youtube_access_token(
    handle: &AndroidMediaHandle,
    email: String,
    interactive: bool,
) -> Result<String, String> {
    call::<YoutubeTokenResult>(
        handle,
        "youtubeAccessToken",
        serde_json::json!({ "email": email, "interactive": interactive }),
    )
    .map(|result| result.access_token)
}

pub fn revoke_youtube_access(handle: &AndroidMediaHandle, email: String) -> Result<(), String> {
    call::<Option<serde_json::Value>>(
        handle,
        "revokeYoutubeAccess",
        serde_json::json!({ "email": email, "interactive": false }),
    )
    .map(|_| ())
}

pub fn update_widget(
    handle: &AndroidMediaHandle,
    state: crate::commands::WidgetState,
) -> Result<(), String> {
    call::<Option<serde_json::Value>>(handle, "updateWidget", state).map(|_| ())
}

/// Descarga el APK nuevo. Puede tardar: se llama desde un hilo aparte.
pub fn download_update(handle: &AndroidMediaHandle, url: String, version: String) -> Result<(), String> {
    call::<serde_json::Value>(
        handle,
        "downloadUpdate",
        serde_json::json!({ "url": url, "version": version }),
    )
    .map(|_| ())
}

/// Devuelve "installing" o "permission" (falta permitir instalar apps).
pub fn install_update(handle: &AndroidMediaHandle, version: String) -> Result<String, String> {
    #[derive(serde::Deserialize)]
    struct Status {
        status: String,
    }
    call::<Status>(handle, "installUpdate", serde_json::json!({ "version": version }))
        .map(|result| result.status)
}

pub fn leave_app(handle: &AndroidMediaHandle) -> Result<(), String> {
    call::<Option<serde_json::Value>>(handle, "moveToBackground", ()).map(|_| ())
}
