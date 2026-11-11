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

pub fn get_media_state(handle: &AndroidMediaHandle) -> MediaStateDto {
    match call::<MediaStateDto>(handle, "getMediaState", ()) {
        Ok(state) => state,
        Err(err) => {
            eprintln!("[PocketPod] getMediaState: {err}");
            MediaStateDto::empty()
        }
    }
}

pub fn toggle_play_pause(handle: &AndroidMediaHandle) -> Result<(), String> {
    call::<Option<serde_json::Value>>(handle, "togglePlayPause", ()).map(|_| ())
}

pub fn skip_next(handle: &AndroidMediaHandle) -> Result<(), String> {
    call::<Option<serde_json::Value>>(handle, "skipNext", ()).map(|_| ())
}

pub fn skip_previous(handle: &AndroidMediaHandle) -> Result<(), String> {
    call::<Option<serde_json::Value>>(handle, "skipPrevious", ()).map(|_| ())
}

pub fn seek_to(handle: &AndroidMediaHandle, seconds: f64) -> Result<(), String> {
    call::<Option<serde_json::Value>>(
        handle,
        "seekTo",
        serde_json::json!({ "seconds": seconds }),
    )
    .map(|_| ())
}

pub fn open_notification_settings(handle: &AndroidMediaHandle) -> Result<(), String> {
    call::<Option<serde_json::Value>>(handle, "openNotificationSettings", ()).map(|_| ())
}
