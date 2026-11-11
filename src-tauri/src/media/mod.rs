use serde::{Deserialize, Serialize};

/// Estado normalizado que consume el frontend. Es común a todas las
/// plataformas: en Windows lo rellena GSMTC y en Android el plugin nativo.
#[derive(Serialize, Deserialize, Clone)]
pub struct MediaStateDto {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub artwork_data_url: Option<String>,
    pub status: String,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub can_seek: bool,
    pub connected: bool,
    pub source_app_id: Option<String>,
    /// En Android indica si el usuario ha concedido acceso a las notificaciones.
    /// En Windows siempre es `true` porque GSMTC no requiere permisos.
    #[serde(default = "default_permission_granted")]
    pub permission_granted: bool,
}

fn default_permission_granted() -> bool {
    true
}

impl MediaStateDto {
    pub fn empty() -> Self {
        Self {
            title: String::new(),
            artist: String::new(),
            album: String::new(),
            artwork_data_url: None,
            status: "unknown".to_string(),
            position_sec: 0.0,
            duration_sec: 0.0,
            can_seek: false,
            connected: false,
            source_app_id: None,
            permission_granted: true,
        }
    }
}

#[cfg(target_os = "windows")]
pub mod windows_gsmtc;

/// En Android las operaciones reales viven en el plugin Kotlin
/// (`MediaSessionPlugin`). Este módulo las invoca desde Rust a través de
/// `run_mobile_plugin`, de modo que el frontend siempre usa comandos normales
/// de Tauri y no necesita permisos ACL de plugin.
#[cfg(target_os = "android")]
pub mod android;
