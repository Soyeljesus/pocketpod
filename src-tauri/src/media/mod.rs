use serde::{Deserialize, Serialize};

/// Estado normalizado que consume el frontend. Es común a todas las
/// plataformas: en Windows lo rellena GSMTC y en Android siempre está vacío.
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
        }
    }
}

#[cfg(target_os = "windows")]
pub mod windows_gsmtc;

/// En Android FoYu no accede a la reproducción de otras apps.
#[cfg(target_os = "android")]
pub mod android;
