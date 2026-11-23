//! Puente de música local ("PocketAll").
//!
//! Expone por HTTP lo que el WebView necesita para reproducir audio:
//! `GET /search` y `GET /stream/{videoId}`. El servidor escucha solo en
//! 127.0.0.1, en un puerto efímero, y exige un token por petición.
//!
//! El motor de extracción es intercambiable (`MusicEngine`): hoy usa
//! InnerTube directamente desde Rust, que funciona igual en Windows y en
//! Android. Si algún día YouTube rompe el cliente ANDROID_VR, se puede añadir
//! un motor Kotlin (InnerTubeX, el de Vivi-Music) o un binario yt-dlp sin
//! tocar el frontend ni el contrato HTTP.

pub mod discover;
pub mod importers;
pub mod innertube;
pub mod library;
pub mod youtube_account;
pub mod server;

use serde::{Deserialize, Serialize};
use std::time::Instant;

/// Canción normalizada que consume React. Los nombres van en camelCase para
/// que el frontend no tenga que traducir campos.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_sec: f64,
    pub thumbnail_url: Option<String>,
}

/// Playlist pública importada. `skipped` cuenta las canciones de otro servicio
/// que no se encontraron en YouTube Music.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPlaylist {
    pub id: String,
    pub title: String,
    pub source: String,
    pub skipped: usize,
    pub tracks: Vec<Track>,
}

/// Canción descargada para escuchar sin conexión. El audio vive en
/// `app_data_dir/offline/<videoId>.<ext>` y se sirve por `/offline/{id}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineTrack {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_sec: f64,
    pub thumbnail_url: Option<String>,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub downloaded_at: u64,
}

/// Stream de audio ya resuelto. `url` apunta a googlevideo y caduca: por eso
/// el servidor la cachea con `expires_at` y la renueva antes de que falle.
#[derive(Debug, Clone)]
pub struct ResolvedStream {
    pub url: String,
    pub content_type: String,
    pub headers: Vec<(String, String)>,
    pub expires_at: Instant,
}

/// Datos que el frontend necesita para hablar con el puente.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInfo {
    pub base_url: String,
    pub token: String,
    pub engine: String,
    pub available: bool,
    pub message: Option<String>,
}

impl BridgeInfo {
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            base_url: String::new(),
            token: String::new(),
            engine: "none".to_string(),
            available: false,
            message: Some(message.into()),
        }
    }
}

/// Contrato mínimo del motor de extracción. Mantenerlo pequeño permite
/// cambiar Rust ↔ Kotlin ↔ yt-dlp sin reescribir el servidor ni la UI.
#[async_trait::async_trait]
pub trait MusicEngine: Send + Sync {
    fn name(&self) -> &'static str;

    fn available(&self) -> bool {
        true
    }

    fn message(&self) -> Option<String> {
        None
    }

    async fn search(&self, query: &str, limit: usize) -> Result<Vec<Track>, String>;

    async fn resolve(&self, video_id: &str) -> Result<ResolvedStream, String>;

    async fn playlist(&self, playlist_id: &str) -> Result<ImportedPlaylist, String>;

    /// Sugerencias mientras se escribe: búsquedas completas y canciones.
    async fn suggestions(&self, _query: &str) -> Result<Suggestions, String> {
        Ok(Suggestions::default())
    }

    /// Canciones parecidas a `video_id` (la "radio" de YouTube Music).
    async fn radio(&self, _video_id: &str, _limit: usize) -> Result<Vec<Track>, String> {
        Ok(Vec::new())
    }

    /// Página de YouTube Music ya leída (inicio, ánimos y géneros, una categoría).
    async fn browse_page(
        &self,
        _browse_id: &str,
        _params: Option<&str>,
        _region: &str,
    ) -> Result<serde_json::Value, String> {
        Err("No disponible".to_string())
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestions {
    pub queries: Vec<String>,
    pub tracks: Vec<Track>,
}
