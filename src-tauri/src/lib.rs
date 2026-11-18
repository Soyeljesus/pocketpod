pub mod music;
mod commands;
mod media;

use std::sync::Arc;
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

/// Arranca el puente HTTP local de música y lo deja disponible como estado.
/// Si falla (por ejemplo, no hay red al construir el cliente), la app sigue
/// funcionando: el frontend recibirá `available: false` y un mensaje.
fn start_music_bridge(app: &tauri::App) {
    let engine = match music::innertube::InnerTube::new() {
        Ok(engine) => Arc::new(engine) as Arc<dyn music::MusicEngine>,
        Err(err) => {
            app.manage(music::BridgeInfo::unavailable(err));
            return;
        }
    };

    // Las descargas viven en la carpeta privada de la app. Si no se puede
    // resolver, el puente arranca igualmente sin descargas.
    let data_dir = app.path().app_data_dir().ok();

    match music::server::start(engine, data_dir) {
        Ok(info) => {
            app.manage(info);
        }
        Err(err) => {
            app.manage(music::BridgeInfo::unavailable(err));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(media_plugin());

    builder
        .setup(|app| {
            start_music_bridge(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_media_state,
            commands::toggle_play_pause,
            commands::skip_next,
            commands::skip_previous,
            commands::seek_to,
            commands::save_text_file,
            commands::leave_app,
            commands::google_sign_in,
            commands::google_clear_credential,
            commands::youtube_library_fetch,
            commands::youtube_disconnect,
            commands::music_bridge_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
