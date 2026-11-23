use crate::media::MediaStateDto;

#[cfg(not(target_os = "android"))]
use crate::media::windows_gsmtc as backend;

#[cfg(target_os = "android")]
use crate::media::android::{self as backend, AndroidMediaHandle};

use tauri::State;

// ---------------------------------------------------------------------------
// Windows / escritorio
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn get_media_state() -> MediaStateDto {
    backend::get_media_state()
}

#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn toggle_play_pause() -> Result<(), String> {
    backend::toggle_play_pause()
}

#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn skip_next() -> Result<(), String> {
    backend::skip_next()
}

#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn skip_previous() -> Result<(), String> {
    backend::skip_previous()
}

#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn seek_to(seconds: f64) -> Result<(), String> {
    backend::seek_to(seconds)
}

/// En escritorio el archivo se guarda desde el WebView.
#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn save_text_file(
    _file_name: String,
    _content: String,
    _mime_type: String,
) -> Result<bool, String> {
    Err("Guardado nativo no disponible en escritorio".to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn leave_app() {}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetState {
    pub title: String,
    pub artist: String,
    pub artwork_url: Option<String>,
    pub playing: bool,
    pub tint: String,
    pub accent: String,
    #[serde(default)]
    pub position_ms: u64,
    #[serde(default)]
    pub duration_ms: u64,
}

#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn widget_update(_state: WidgetState) {}

#[cfg(target_os = "android")]
#[tauri::command(async)]
pub fn widget_update(
    handle: State<'_, AndroidMediaHandle>,
    state: WidgetState,
) -> Result<(), String> {
    backend::update_widget(&handle, state)
}

/// En Windows abre Google en el navegador y devuelve solo el token de
/// identidad, que Firebase usa para iniciar sesión.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn google_sign_in(
    app: tauri::AppHandle,
    client_id: String,
    nonce: String,
    client_secret: Option<String>,
) -> Result<String, String> {
    let tokens = crate::desktop_auth::authorize(
        &app,
        &client_id,
        client_secret.as_deref().unwrap_or(""),
        "openid email profile",
        Some(&nonce),
        None,
    )
    .await?;
    tokens.id_token.ok_or_else(|| "google_invalid_credential".to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn google_clear_credential() {}

/// El permiso de YouTube se pide aparte y el token se usa una vez: no llega
/// al WebView ni se guarda.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn youtube_library_fetch(
    app: tauri::AppHandle,
    email: String,
    interactive: bool,
    client_id: Option<String>,
    client_secret: Option<String>,
) -> Result<crate::music::youtube_account::YoutubeLibrary, String> {
    // Sin token guardado, actualizar en segundo plano pediría abrir el navegador.
    if !interactive {
        return Err("youtube_consent_required".to_string());
    }
    let tokens = crate::desktop_auth::authorize(
        &app,
        client_id.as_deref().unwrap_or(""),
        client_secret.as_deref().unwrap_or(""),
        "https://www.googleapis.com/auth/youtube.readonly",
        None,
        Some(&email),
    )
    .await
    .map_err(|err| err.replace("google_", "youtube_"))?;
    crate::music::youtube_account::fetch_library(&tokens.access_token).await
}

/// En Windows FoYu no guarda el permiso de YouTube, así que no hay nada que
/// borrar del equipo. Se puede retirar del todo desde la cuenta de Google.
#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn youtube_disconnect(_email: String) -> Result<(), String> {
    Ok(())
}

// ---------------------------------------------------------------------------
// Android (el trabajo real lo hace el plugin Kotlin)
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
#[tauri::command(async)]
pub fn get_media_state(handle: State<'_, AndroidMediaHandle>) -> MediaStateDto {
    backend::get_media_state(&handle)
}

#[cfg(target_os = "android")]
#[tauri::command(async)]
pub fn toggle_play_pause(handle: State<'_, AndroidMediaHandle>) -> Result<(), String> {
    backend::toggle_play_pause(&handle)
}

#[cfg(target_os = "android")]
#[tauri::command(async)]
pub fn skip_next(handle: State<'_, AndroidMediaHandle>) -> Result<(), String> {
    backend::skip_next(&handle)
}

#[cfg(target_os = "android")]
#[tauri::command(async)]
pub fn skip_previous(handle: State<'_, AndroidMediaHandle>) -> Result<(), String> {
    backend::skip_previous(&handle)
}

#[cfg(target_os = "android")]
#[tauri::command(async)]
pub fn seek_to(handle: State<'_, AndroidMediaHandle>, seconds: f64) -> Result<(), String> {
    backend::seek_to(&handle, seconds)
}

#[cfg(target_os = "android")]
#[tauri::command(async)]
pub fn save_text_file(
    handle: State<'_, AndroidMediaHandle>,
    file_name: String,
    content: String,
    mime_type: String,
) -> Result<bool, String> {
    backend::save_text_file(&handle, file_name, content, mime_type)
}

#[cfg(target_os = "android")]
#[tauri::command(async)]
pub fn leave_app(handle: State<'_, AndroidMediaHandle>) -> Result<(), String> {
    backend::leave_app(&handle)
}

#[cfg(target_os = "android")]
#[tauri::command(async)]
pub fn google_sign_in(
    handle: State<'_, AndroidMediaHandle>,
    client_id: String,
    nonce: String,
) -> Result<String, String> {
    backend::google_sign_in(&handle, client_id, nonce)
}

#[cfg(target_os = "android")]
#[tauri::command(async)]
pub fn google_clear_credential(handle: State<'_, AndroidMediaHandle>) -> Result<(), String> {
    backend::clear_google_credential(&handle)
}

/// El token de YouTube se queda en Rust: no llega al WebView ni se guarda.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn youtube_library_fetch(
    handle: State<'_, AndroidMediaHandle>,
    email: String,
    interactive: bool,
) -> Result<crate::music::youtube_account::YoutubeLibrary, String> {
    let handle = handle.inner().clone();
    let token = tauri::async_runtime::spawn_blocking(move || {
        backend::youtube_access_token(&handle, email, interactive)
    })
    .await
    .map_err(|_| "youtube_authorization_failed".to_string())??;

    crate::music::youtube_account::fetch_library(&token).await
}

#[cfg(target_os = "android")]
#[tauri::command(async)]
pub fn youtube_disconnect(
    handle: State<'_, AndroidMediaHandle>,
    email: String,
) -> Result<(), String> {
    backend::revoke_youtube_access(&handle, email)
}

// ---------------------------------------------------------------------------
// Puente de música (PocketAll)
// ---------------------------------------------------------------------------

/// Devuelve la URL y el token del servidor local de música. El frontend los
/// usa para `/search` y para el `src` del elemento `<audio>`.
#[tauri::command]
pub fn music_bridge_info(info: State<'_, crate::music::BridgeInfo>) -> crate::music::BridgeInfo {
    info.inner().clone()
}
