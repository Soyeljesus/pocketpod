use crate::media::MediaStateDto;

#[cfg(not(target_os = "android"))]
use crate::media::windows_gsmtc as backend;

#[cfg(target_os = "android")]
use crate::media::android::{self as backend, AndroidMediaHandle};

#[cfg(target_os = "android")]
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

/// Solo existe en Android; en escritorio no hace nada.
#[cfg(not(target_os = "android"))]
#[tauri::command(async)]
pub fn open_notification_settings() {}

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
pub fn open_notification_settings(handle: State<'_, AndroidMediaHandle>) -> Result<(), String> {
    backend::open_notification_settings(&handle)
}
