use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use windows::core::Error;
use windows_future::{AsyncStatus, IAsyncOperation};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionMediaProperties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Storage::Streams::DataReader;

// Helper para esperar de forma bloqueante a que termine una operación asíncrona.
fn block_on<T: windows::core::RuntimeType + 'static>(op: IAsyncOperation<T>) -> Result<T, Error> {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);

    loop {
        match op.Status()? {
            AsyncStatus::Started => {
                if std::time::Instant::now() >= deadline {
                    // HRESULT_FROM_WIN32(ERROR_TIMEOUT)
                    return Err(Error::new(
                        windows::core::HRESULT(0x800705B4u32 as i32),
                        "Timed out waiting for async operation",
                    ));
                }
                thread::sleep(Duration::from_millis(10));
            }
            AsyncStatus::Completed => {
                return op.GetResults();
            }
            AsyncStatus::Canceled => {
                return Err(Error::new(
                    windows::core::HRESULT(0x800704C7u32 as i32),
                    "Operation canceled",
                ));
            }
            AsyncStatus::Error => {
                return Err(Error::from_hresult(op.ErrorCode()?));
            }
            _ => unreachable!(),
        }
    }
}

// Caché de portada por pista: evita volver a leer y codificar la imagen en
// cada sondeo (una vez por segundo), que es lo más caro de `get_media_state`.
static ARTWORK_CACHE: OnceLock<Mutex<Option<(String, String)>>> = OnceLock::new();

fn artwork_cache() -> &'static Mutex<Option<(String, String)>> {
    ARTWORK_CACHE.get_or_init(|| Mutex::new(None))
}

fn detect_image_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF")
        && bytes.len() >= 12
        && bytes[8..].starts_with(b"WEBP")
    {
        "image/webp"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else {
        // Formato desconocido: la mayoría de portadas de Spotify son JPEG.
        "image/jpeg"
    }
}

fn read_artwork(
    props: &GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<String> {
    let thumbnail = props.Thumbnail().ok()?;
    let stream = block_on(thumbnail.OpenReadAsync().ok()?).ok()?;
    let size = stream.Size().ok()?;
    if size == 0 {
        return None;
    }

    let reader = DataReader::CreateDataReader(&stream).ok()?;
    block_on(reader.LoadAsync(size as u32).ok()?).ok()?;

    let mut buffer = vec![0u8; size as usize];
    reader.ReadBytes(&mut buffer).ok()?;

    let mime = detect_image_mime(&buffer);
    let b64 = general_purpose::STANDARD.encode(&buffer);
    Some(format!("data:{};base64,{}", mime, b64))
}

#[derive(Serialize, Clone)]
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
    fn empty() -> Self {
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

fn get_spotify_session() -> Option<GlobalSystemMediaTransportControlsSession> {
    let op = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().ok()?;
    let manager = block_on(op).ok()?;
    let sessions = manager.GetSessions().ok()?;

    for i in 0..sessions.Size().ok()? {
        let session = sessions.GetAt(i).ok()?;
        let app_id = session.SourceAppUserModelId().ok()?.to_string();

        if app_id.to_lowercase().contains("spotify") {
            return Some(session);
        }
    }
    None
}

pub fn get_media_state() -> MediaStateDto {
    let session = match get_spotify_session() {
        Some(s) => s,
        None => return MediaStateDto::empty(),
    };

    let mut dto = MediaStateDto::empty();
    dto.connected = true;
    dto.source_app_id = session.SourceAppUserModelId().ok().map(|s| s.to_string());

    // Metadatos
    if let Ok(op) = session.TryGetMediaPropertiesAsync() {
        if let Ok(media_props) = block_on(op) {
            dto.title = media_props.Title().unwrap_or_default().to_string();
            dto.artist = media_props.Artist().unwrap_or_default().to_string();
            dto.album = media_props.AlbumTitle().unwrap_or_default().to_string();

            // Portada (se cachea por pista para no releerla cada segundo).
            let artwork_key = format!("{}|{}|{}", dto.title, dto.artist, dto.album);
            let cached = artwork_cache()
                .lock()
                .ok()
                .and_then(|guard| guard.clone());

            dto.artwork_data_url = match cached {
                Some((key, url)) if key == artwork_key => Some(url),
                _ => {
                    let artwork = read_artwork(&media_props);
                    if let Some(url) = &artwork {
                        if let Ok(mut guard) = artwork_cache().lock() {
                            *guard = Some((artwork_key, url.clone()));
                        }
                    }
                    artwork
                }
            };
        }
    }

    // Estado de reproducción
    if let Ok(info) = session.GetPlaybackInfo() {
        if let Ok(status) = info.PlaybackStatus() {
            dto.status = match status {
                GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => "playing",
                GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => "paused",
                GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => "stopped",
                _ => "unknown",
            }.to_string();
        }
        
        if let Ok(controls) = info.Controls() {
            dto.can_seek = controls.IsPlaybackPositionEnabled().unwrap_or(false);
        }
    }

    // Línea de tiempo
    if let Ok(timeline) = session.GetTimelineProperties() {
        if let Ok(pos) = timeline.Position() {
            dto.position_sec = pos.Duration as f64 / 10_000_000.0;
        }
        if let Ok(end) = timeline.EndTime() {
            dto.duration_sec = end.Duration as f64 / 10_000_000.0;
        }
    }

    dto
}

pub fn toggle_play_pause() -> Result<(), String> {
    if let Some(s) = get_spotify_session() {
        if let Ok(op) = s.TryTogglePlayPauseAsync() {
            if let Ok(true) = block_on(op) { return Ok(()); }
        }
    }
    Err("No se pudo alternar Play/Pause".into())
}

pub fn skip_next() -> Result<(), String> {
    if let Some(s) = get_spotify_session() {
        if let Ok(op) = s.TrySkipNextAsync() {
            if let Ok(true) = block_on(op) { return Ok(()); }
        }
    }
    Err("No se pudo saltar a la siguiente".into())
}

pub fn skip_previous() -> Result<(), String> {
    if let Some(s) = get_spotify_session() {
        if let Ok(op) = s.TrySkipPreviousAsync() {
            if let Ok(true) = block_on(op) { return Ok(()); }
        }
    }
    Err("No se pudo volver a la anterior".into())
}

pub fn seek_to(seconds: f64) -> Result<(), String> {
    if let Some(s) = get_spotify_session() {
        let ticks = (seconds * 10_000_000.0) as i64;
        if let Ok(op) = s.TryChangePlaybackPositionAsync(ticks) {
            if let Ok(true) = block_on(op) { return Ok(()); }
        }
    }
    Err("No se pudo cambiar la posición".into())
}