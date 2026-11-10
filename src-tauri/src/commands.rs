use crate::media::windows_gsmtc::{self, MediaStateDto};

#[tauri::command(async)]
pub fn get_media_state() -> MediaStateDto {
    windows_gsmtc::get_media_state()
}

#[tauri::command(async)]
pub fn toggle_play_pause() -> Result<(), String> {
    windows_gsmtc::toggle_play_pause()
}

#[tauri::command(async)]
pub fn skip_next() -> Result<(), String> {
    windows_gsmtc::skip_next()
}

#[tauri::command(async)]
pub fn skip_previous() -> Result<(), String> {
    windows_gsmtc::skip_previous()
}

#[tauri::command(async)]
pub fn seek_to(seconds: f64) -> Result<(), String> {
    windows_gsmtc::seek_to(seconds)
}