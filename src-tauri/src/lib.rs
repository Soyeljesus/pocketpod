mod commands;
mod media;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_media_state,
            commands::toggle_play_pause,
            commands::skip_next,
            commands::skip_previous,
            commands::seek_to
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}