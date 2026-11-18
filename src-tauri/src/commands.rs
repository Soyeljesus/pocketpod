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

#[cfg(not(target_os = "android"))]
const ANDROID_ONLY: &str = "Esta función está disponible por ahora en Android";

#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn google_sign_in(_client_id: String, _nonce: String) -> Result<String, String> {
    Err(ANDROID_ONLY.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn google_clear_credential() {}

#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn youtube_library_fetch(
    _email: String,
    _interactive: bool,
) -> Result<crate::music::youtube_account::YoutubeLibrary, String> {
    Err(ANDROID_ONLY.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn youtube_disconnect(_email: String) -> Result<(), String> {
    Err(ANDROID_ONLY.to_string())
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
