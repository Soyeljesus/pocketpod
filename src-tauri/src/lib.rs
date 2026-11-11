mod commands;
mod media;

#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
fn media_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::<tauri::Wry>::new("media")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.pocketpod.app", "MediaSessionPlugin")?;
            // Los comandos de Rust necesitan este handle para hablar con Kotlin.
            app.manage(media::android::AndroidMediaHandle(handle));
            Ok(())
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(media_plugin());

    builder
        .invoke_handler(tauri::generate_handler![
            commands::get_media_state,
            commands::toggle_play_pause,
            commands::skip_next,
            commands::skip_previous,
            commands::seek_to,
            commands::open_notification_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
