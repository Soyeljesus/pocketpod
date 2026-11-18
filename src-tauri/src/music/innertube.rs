//! Motor InnerTube en Rust.
//!
//! Búsqueda: `music.youtube.com/youtubei/v1/search` con el cliente WEB_REMIX.
//!
//! Stream: `www.youtube.com/youtubei/v1/player` con dos clientes en cascada:
//!
//! 1. **VISIONOS** con el `visitorData` de la página del vídeo. Desde 2025 casi
//!    todo el catálogo responde solo con SABR (sin `url` por formato) o con el
//!    aviso "confirma que no eres un bot". Este cliente + ese `visitorData`
//!    sigue devolviendo URLs directas de googlevideo, así que el proxy puede
//!    seguir sirviendo audio con `Range` sin descifrar firmas ni usar WebView.
//! 2. **ANDROID_VR** como respaldo para vídeos antiguos.
//!
//! La clave no obvia: el `visitorData` debe venir de una página de
//! `www.youtube.com` (no del buscador de música) y viaja tanto en el contexto
//! del cliente como en la cabecera `X-Goog-Visitor-Id`.

use std::sync::RwLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::header::{ACCEPT_LANGUAGE, CONTENT_TYPE, ORIGIN, REFERER, USER_AGENT};
use serde_json::{json, Value};

use super::{MusicEngine, ResolvedStream, Track};

const YOUTUBE: &str = "https://www.youtube.com";
const YOUTUBE_MUSIC: &str = "https://music.youtube.com";
const WEB_REMIX_VERSION: &str = "1.20241127.01.00";
const ANDROID_VR_VERSION: &str = "1.62.27";
const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// Cliente que YouTube todavía sirve sin PO Token ni login.
const VISIONOS_VERSION: &str = "1.02";
const VISIONOS_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

/// Un `visitorData` de página aguanta bastante, pero se renueva por si YouTube
/// lo invalida. Si un stream falla se fuerza la renovación inmediata.
const PAGE_VISITOR_TTL: Duration = Duration::from_secs(20 * 60);

pub struct InnerTube {
    http: reqwest::Client,
    visitor_data: RwLock<Option<String>>,
    page_visitor: RwLock<Option<(String, Instant)>>,
    hl: String,
    gl: String,
}

impl InnerTube {
    pub fn new() -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .user_agent(DEFAULT_UA)
            .connect_timeout(Duration::from_secs(6))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| format!("No se pudo crear el cliente HTTP: {e}"))?;

        Ok(Self {
            http,
            visitor_data: RwLock::new(None),
            page_visitor: RwLock::new(None),
            hl: "es".to_string(),
            gl: "ES".to_string(),
        })
    }

    fn remember_visitor(&self, value: &Value) {
        if let Some(visitor) = value
            .pointer("/responseContext/visitorData")
            .and_then(Value::as_str)
        {
            if !visitor.is_empty() {
                if let Ok(mut guard) = self.visitor_data.write() {
                    *guard = Some(visitor.to_string());
                }
            }
        }
    }

    fn music_client(&self) -> Value {
        let mut client = json!({
            "clientName": "WEB_REMIX",
            "clientVersion": WEB_REMIX_VERSION,
            "hl": self.hl,
            "gl": self.gl,
        });
        if let Some(visitor) = self
            .visitor_data
            .read()
            .ok()
            .and_then(|guard| guard.clone())
        {
            client["visitorData"] = json!(visitor);
        }
        client
    }

    fn vr_client(&self) -> Value {
        let mut client = json!({
            "clientName": "ANDROID_VR",
            "clientVersion": ANDROID_VR_VERSION,
            "androidSdkVersion": 32,
            "osName": "Android",
            "osVersion": "12",
            "deviceMake": "Oculus",
            "deviceModel": "Quest 3",
            "hl": self.hl,
            "gl": self.gl,
        });
        if let Some(visitor) = self
            .visitor_data
            .read()
            .ok()
            .and_then(|guard| guard.clone())
        {
            client["visitorData"] = json!(visitor);
        }
        client
    }
}

#[async_trait::async_trait]
impl MusicEngine for InnerTube {
    fn name(&self) -> &'static str {
        "innertube-rust"
    }

    async fn search(&self, query: &str, limit: usize) -> Result<Vec<Track>, String> {
        let body = json!({
            "context": { "client": self.music_client() },
            "query": query,
        });

        let response = self
            .http
            .post(format!("{YOUTUBE_MUSIC}/youtubei/v1/search?prettyPrint=false"))
            .header(CONTENT_TYPE, "application/json")
            .header(ORIGIN, YOUTUBE_MUSIC)
            .header(REFERER, format!("{YOUTUBE_MUSIC}/"))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("No se pudo contactar con YouTube Music: {e}"))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("YouTube Music respondió HTTP {status}"));
        }

        let value: Value = response
            .json()
            .await
            .map_err(|e| format!("Respuesta inválida de YouTube Music: {e}"))?;

        self.remember_visitor(&value);

        let tracks = parse_search(&value, limit);
        if tracks.is_empty() {
            return Err("Sin resultados para esa búsqueda".to_string());
        }
        Ok(tracks)
    }

    async fn resolve(&self, video_id: &str) -> Result<ResolvedStream, String> {
        let mut last_error = String::from("YouTube no devolvió audio reproducible para este vídeo");

        // 1) VISIONOS con el visitorData de la página. Se reintenta una vez con
        //    un visitor nuevo: YouTube invalida el anterior sin avisar.
        for attempt in 0..2 {
            let visitor = match self.page_visitor(video_id, attempt > 0).await {
                Ok(visitor) => visitor,
                Err(err) => {
                    last_error = err;
                    break;
                }
            };

            match self
                .player_request(video_id, self.visionos_client(&visitor), Some(&visitor))
                .await
            {
                Ok(value) => match extract_stream(&value) {
                    Ok(stream) => return Ok(stream),
                    Err(err) => last_error = err,
                },
                Err(err) => last_error = err,
            }
        }

        // 2) Respaldo: ANDROID_VR sigue dando URLs directas en vídeos antiguos.
        let visitor = self
            .visitor_data
            .read()
            .ok()
            .and_then(|guard| guard.clone());

        match self
            .player_request(video_id, self.vr_client(), visitor.as_deref())
            .await
        {
            Ok(value) => match extract_stream(&value) {
                Ok(stream) => Ok(stream),
                Err(err) => Err(if last_error.is_empty() { err } else { last_error }),
            },
            Err(_) => Err(last_error),
        }
    }
}

impl InnerTube {
    fn visionos_client(&self, visitor: &str) -> Value {
        json!({
            "clientName": "VISIONOS",
            "clientVersion": VISIONOS_VERSION,
            "deviceMake": "Apple",
            "deviceModel": "RealityDevice17,1",
            "osName": "visionOS",
            "osVersion": "26.5.23O471",
            "userAgent": VISIONOS_UA,
            "visitorData": visitor,
            "hl": self.hl,
            "gl": self.gl,
        })
    }

    /// Devuelve el `visitorData` de la página del vídeo, cacheado 20 minutos.
    async fn page_visitor(&self, video_id: &str, refresh: bool) -> Result<String, String> {
        if !refresh {
            if let Some((value, at)) = self
                .page_visitor
                .read()
                .ok()
                .and_then(|guard| guard.clone())
            {
                if at.elapsed() < PAGE_VISITOR_TTL {
                    return Ok(value);
                }
            }
        }

        let response = self
            .http
            .get(format!("{YOUTUBE}/watch?v={video_id}"))
            .header(USER_AGENT, VISIONOS_UA)
            .header(ACCEPT_LANGUAGE, "es-ES,es;q=0.9")
            .send()
            .await
            .map_err(|e| format!("No se pudo abrir la página del vídeo: {e}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "La página del vídeo respondió HTTP {}",
                response.status()
            ));
        }

        let html = response
            .text()
            .await
            .map_err(|e| format!("No se pudo leer la página del vídeo: {e}"))?;

        let visitor = match extract_visitor_data(&html) {
            Some(visitor) => visitor,
            None => {
                let start = html.find("<title>").map(|i| &html[i..(i + 120).min(html.len())]);
                eprintln!(
                    "[PocketAll] visitorData ausente en la página ({} bytes): {:?}",
                    html.len(),
                    start
                );
                return Err("YouTube no expuso visitorData en la página".to_string());
            }
        };

        if let Ok(mut guard) = self.page_visitor.write() {
            *guard = Some((visitor.clone(), Instant::now()));
        }

        Ok(visitor)
    }

    async fn player_request(
        &self,
        video_id: &str,
        client: Value,
        visitor: Option<&str>,
    ) -> Result<Value, String> {
        let body = json!({
            "context": { "client": client },
            "videoId": video_id,
            "contentCheckOk": true,
            "racyCheckOk": true,
        });

        let mut request = self
            .http
            .post(format!("{YOUTUBE}/youtubei/v1/player?prettyPrint=false"))
            .header(CONTENT_TYPE, "application/json")
            .header(ORIGIN, YOUTUBE)
            .header(REFERER, format!("{YOUTUBE}/"));

        // Solo el cliente de visión usa estas cabeceras; ANDROID_VR funciona sin
        // ellas y añadirlas con un visitor de otra sesión lo empeora.
        if let Some(visitor) = visitor {
            request = request
                .header(USER_AGENT, VISIONOS_UA)
                .header("X-Goog-Visitor-Id", visitor)
                .header("X-YouTube-Client-Name", "101")
                .header("X-YouTube-Client-Version", VISIONOS_VERSION);
        }

        let response = request
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("No se pudo resolver el stream: {e}"))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("YouTube respondió HTTP {status}"));
        }

        let value: Value = response
            .json()
            .await
            .map_err(|e| format!("Respuesta inválida de YouTube: {e}"))?;

        self.remember_visitor(&value);

        Ok(value)
    }
}

/// Comprueba la respuesta del reproductor y devuelve el mejor audio con URL
/// directa. Extraído aparte para poder probarlo sin red.
fn extract_stream(value: &Value) -> Result<ResolvedStream, String> {
    let playability = value
        .pointer("/playabilityStatus/status")
        .and_then(Value::as_str)
        .unwrap_or("UNKNOWN");

    if playability != "OK" {
        let reason = value
            .pointer("/playabilityStatus/reason")
            .and_then(Value::as_str)
            .unwrap_or("YouTube no permite reproducir este vídeo");
        return Err(reason.to_string());
    }

    let format = best_audio_format(value)
        .ok_or_else(|| "YouTube no devolvió audio reproducible para este vídeo".to_string())?;

    let url = format
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| "El formato de audio no incluye URL directa".to_string())?
        .to_string();

    let content_type = format
        .get("mimeType")
        .and_then(Value::as_str)
        .unwrap_or("audio/webm")
        .split(';')
        .next()
        .unwrap_or("audio/webm")
        .trim()
        .to_string();

    Ok(ResolvedStream {
        expires_at: stream_expiry(&url),
        url,
        content_type,
        // googlevideo acepta la petición sin cabeceras especiales, pero el
        // proxy añade User-Agent y Referer por si el CDN se pone serio.
        headers: Vec::new(),
    })
}

/// Busca `"VISITOR_DATA":"..."` en el HTML del watch page. YouTube lo incrusta
/// tanto en `ytcfg.set({...})` como en el JSON inicial.
fn extract_visitor_data(html: &str) -> Option<String> {
    for marker in ["\"VISITOR_DATA\":\"", "\\\"VISITOR_DATA\\\":\\\""] {
        let Some(start) = html.find(marker) else {
            continue;
        };

        let rest = &html[start + marker.len()..];
        let end = rest.find(['"', '\\']).unwrap_or(rest.len());
        let visitor = rest[..end].trim();

        // El visitorData real es un protobuf base64-url de ~450 caracteres
        // (a veces con `%3D` al final), así que no se puede limitar a un
        // tamaño pequeño. Solo se comprueba que sea plausible.
        let plausible = !visitor.is_empty()
            && visitor.len() <= 4096
            && visitor
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '%' | '='));

        if plausible {
            return Some(visitor.to_string());
        }
    }
    None
}

/// Elige el audio de mayor bitrate entre los formatos adaptativos. Si no hay,
/// prueba con los progresivos (muxed) por si el vídeo es antiguo.
fn best_audio_format(value: &Value) -> Option<&Value> {
    let mut best: Option<&Value> = None;
    let mut best_bitrate = 0u64;

    for key in ["adaptiveFormats", "formats"] {
        let Some(formats) = value
            .pointer(&format!("/streamingData/{key}"))
            .and_then(Value::as_array)
        else {
            continue;
        };

        for format in formats {
            let is_audio = format
                .get("mimeType")
                .and_then(Value::as_str)
                .map(|mime| mime.starts_with("audio/"))
                .unwrap_or(false);
            if !is_audio || format.get("url").and_then(Value::as_str).is_none() {
                continue;
            }

            let bitrate = format.get("bitrate").and_then(Value::as_u64).unwrap_or(0);
            if best.is_none() || bitrate > best_bitrate {
                best = Some(format);
                best_bitrate = bitrate;
            }
        }

        if best.is_some() {
            break;
        }
    }

    best
}

/// Las URLs de googlevideo llevan `expire` (epoch en segundos). Se renueva
/// con un minuto de margen y se limita a 10 minutos para no arrastrar URLs
/// raras si el CDN no incluye el parámetro.
fn stream_expiry(url: &str) -> Instant {
    const MAX_TTL: u64 = 600;

    let seconds = url
        .split("expire=")
        .nth(1)
        .and_then(|tail| tail.split('&').next())
        .and_then(|raw| raw.parse::<u64>().ok());

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let ttl = match seconds {
        Some(expire) if expire > now + 2 => (expire - now - 60).min(MAX_TTL),
        _ => 300,
    };

    Instant::now() + Duration::from_secs(ttl.max(30))
}

fn parse_search(value: &Value, limit: usize) -> Vec<Track> {
    let mut renderers = Vec::new();
    collect_renderers(value, &mut renderers);

    let mut tracks = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for item in renderers {
        let Some(video_id) = video_id_of(item) else {
            continue;
        };
        if !seen.insert(video_id.clone()) {
            continue;
        }

        let title = column_text(item, 0);
        if title.is_empty() {
            continue;
        }

        let parts = subtitle_parts(item);
        let artist = artist_of(item)
            .or_else(|| parts.first().cloned())
            .unwrap_or_default();
        let album = album_of(item)
            .or_else(|| parts.iter().find(|part| **part != artist).cloned())
            .unwrap_or_default();

        tracks.push(Track {
            duration_sec: duration_of(item),
            thumbnail_url: thumbnail_of(item).or_else(|| {
                Some(format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"))
            }),
            video_id,
            title,
            artist,
            album,
        });

        if tracks.len() >= limit {
            break;
        }
    }

    tracks
}

fn collect_renderers<'a>(value: &'a Value, out: &mut Vec<&'a Value>) {
    match value {
        Value::Object(map) => {
            if let Some(item) = map.get("musicResponsiveListItemRenderer") {
                out.push(item);
            }
            for child in map.values() {
                collect_renderers(child, out);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_renderers(child, out);
            }
        }
        _ => {}
    }
}

fn video_id_of(item: &Value) -> Option<String> {
    let candidates = [
        item.pointer("/playlistItemData/videoId"),
        item.pointer(
            "/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchEndpoint/videoId",
        ),
        item.pointer(
            "/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs/0/navigationEndpoint/watchEndpoint/videoId",
        ),
    ];

    for candidate in candidates.into_iter().flatten() {
        if let Some(id) = candidate.as_str() {
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    None
}

fn runs_of(item: &Value, column: usize) -> Vec<String> {
    item.pointer(&format!(
        "/flexColumns/{column}/musicResponsiveListItemFlexColumnRenderer/text/runs"
    ))
    .and_then(Value::as_array)
    .map(|runs| {
        runs.iter()
            .filter_map(|run| run.get("text").and_then(Value::as_str))
            .map(str::to_string)
            .collect()
    })
    .unwrap_or_default()
}

fn column_text(item: &Value, column: usize) -> String {
    runs_of(item, column)
        .into_iter()
        .filter(|text| text != " • ")
        .collect::<Vec<_>>()
        .join("")
        .trim()
        .to_string()
}

fn is_noise(text: &str) -> bool {
    let lower = text.to_lowercase();
    text == " • "
        || matches!(
            lower.trim(),
            "canción"
                | "cancion"
                | "song"
                | "vídeo"
                | "video"
                | "álbum"
                | "album"
                | "artista"
                | "artist"
                | "single"
                | "ep"
                | "lista"
                | "playlist"
        )
        || lower.contains("visualizacion")
        || lower.contains("reproduce")
        || lower.contains(" views")
        || lower.contains("me gusta")
        || lower.contains(" likes")
        || lower.contains("suscriptor")
        || lower.contains("subscriber")
        || parse_duration(text).is_some()
}

fn runs_values(item: &Value, column: usize) -> Vec<&Value> {
    item.pointer(&format!(
        "/flexColumns/{column}/musicResponsiveListItemFlexColumnRenderer/text/runs"
    ))
    .and_then(Value::as_array)
    .map(|runs| runs.iter().collect())
    .unwrap_or_default()
}

fn browse_page_type(run: &Value) -> Option<&str> {
    run.pointer(
        "/navigationEndpoint/browseEndpoint/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType",
    )
    .and_then(Value::as_str)
}

fn run_text<'a>(run: &'a Value, page_type: &str) -> Option<&'a str> {
    if browse_page_type(run) != Some(page_type) {
        return None;
    }
    let text = run.get("text").and_then(Value::as_str)?.trim();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// El artista en la segunda columna. En las filas de tipo "canción" ya no
/// viene ahí: YouTube Music lo esconde en la etiqueta de accesibilidad del
/// botón de reproducción ("Reproducir Título - Artista").
fn artist_of(item: &Value) -> Option<String> {
    for run in runs_values(item, 1) {
        if let Some(artist) = run_text(run, "MUSIC_PAGE_TYPE_ARTIST") {
            return Some(artist.to_string());
        }
    }

    let label = item
        .pointer(
            "/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/accessibilityPlayData/accessibilityData/label",
        )
        .and_then(Value::as_str)?;

    let stripped = ["Reproducir ", "Play ", "Pausar ", "Pause "]
        .iter()
        .find_map(|prefix| label.strip_prefix(prefix))
        .unwrap_or(label);

    stripped
        .rsplit_once(" - ")
        .map(|(_, artist)| artist.trim())
        .filter(|artist| !artist.is_empty())
        .map(str::to_string)
}

fn album_of(item: &Value) -> Option<String> {
    runs_values(item, 1)
        .into_iter()
        .find_map(|run| run_text(run, "MUSIC_PAGE_TYPE_ALBUM"))
        .map(str::to_string)
}

/// Devuelve los trozos "útiles" de la segunda columna (artista, álbum...).
/// El primero es el artista; el resto puede ser álbum o ruido (vistas).
fn subtitle_parts(item: &Value) -> Vec<String> {
    runs_of(item, 1)
        .into_iter()
        .filter(|text| !text.is_empty() && !is_noise(text))
        .map(|text| text.trim().to_string())
        .collect()
}

fn duration_of(item: &Value) -> f64 {
    if let Some(seconds) = item
        .pointer("/fixedColumns/0/musicResponsiveListItemFixedColumnRenderer/text/runs/0/text")
        .and_then(Value::as_str)
        .and_then(parse_duration)
    {
        return seconds;
    }

    runs_of(item, 1)
        .iter()
        .filter_map(|text| parse_duration(text))
        .next()
        .unwrap_or(0.0)
}

fn parse_duration(text: &str) -> Option<f64> {
    let clean = text.trim();
    if clean.is_empty() || !clean.contains(':') {
        return None;
    }

    let mut seconds = 0u64;
    for part in clean.split(':') {
        let value = part.trim().parse::<u64>().ok()?;
        seconds = seconds * 60 + value;
    }
    Some(seconds as f64)
}

fn thumbnail_of(item: &Value) -> Option<String> {
    item.pointer(
        "/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails",
    )
    .and_then(Value::as_array)
    .and_then(|list| list.last())
    .and_then(|thumb| thumb.get("url"))
    .and_then(Value::as_str)
    .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minutes_and_hours() {
        assert_eq!(parse_duration("3:59"), Some(239.0));
        assert_eq!(parse_duration("1:02:03"), Some(3723.0));
        assert_eq!(parse_duration("Live"), None);
    }

    #[test]
    fn reads_expiry_from_url() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let url = format!("https://x.test/v?expire={}&id=1", now + 1000);
        let ttl = stream_expiry(&url).saturating_duration_since(Instant::now());
        assert!(ttl.as_secs() <= 600);
        assert!(ttl.as_secs() >= 30);
    }

    #[test]
    fn extracts_visitor_from_watch_page() {
        let html = r#"ytcfg.set({"VISITOR_DATA":"CgstQ2wwbDNfaGtRRSj8ye7XB","X":"y"});"#;
        assert_eq!(
            extract_visitor_data(html).as_deref(),
            Some("CgstQ2wwbDNfaGtRRSj8ye7XB")
        );

        let escaped = r#"{\"VISITOR_DATA\":\"Cgtlc2NhcGVhZG9cIn0\"}"#;
        assert_eq!(
            extract_visitor_data(escaped).as_deref(),
            Some("Cgtlc2NhcGVhZG9cIn0")
        );

        assert_eq!(extract_visitor_data("<html>consent</html>"), None);

        // El valor real ronda los 450 caracteres y puede acabar en %3D.
        let long_visitor = format!("CgtZ{}%3D", "A".repeat(430));
        let long = format!(
            r#"{{"VISITOR_DATA":"{long_visitor}","hl":"es"}}"#
        );
        let parsed = extract_visitor_data(&long).expect("visitorData largo");
        assert_eq!(parsed, long_visitor);
        assert!(parsed.len() > 256);
    }

    #[test]
    fn rejects_unplayable_responses() {
        let blocked = json!({
            "playabilityStatus": { "status": "LOGIN_REQUIRED", "reason": "Inicia sesión" }
        });
        assert_eq!(
            extract_stream(&blocked).unwrap_err(),
            "Inicia sesión".to_string()
        );

        let sabr_only = json!({
            "playabilityStatus": { "status": "OK" },
            "streamingData": {
                "adaptiveFormats": [{
                    "itag": 251,
                    "mimeType": "audio/webm; codecs=\"opus\"",
                    "bitrate": 130000,
                    "initRange": { "start": "0", "end": "400" }
                }]
            }
        });
        assert!(extract_stream(&sabr_only).is_err());

        let direct = json!({
            "playabilityStatus": { "status": "OK" },
            "streamingData": {
                "adaptiveFormats": [
                    { "itag": 139, "mimeType": "audio/mp4; codecs=\"mp4a.40.5\"", "bitrate": 50000, "url": "https://cdn.test/low" },
                    { "itag": 251, "mimeType": "audio/webm; codecs=\"opus\"", "bitrate": 136000, "url": "https://cdn.test/high" }
                ]
            }
        });
        let stream = extract_stream(&direct).unwrap();
        assert_eq!(stream.url, "https://cdn.test/high");
        assert_eq!(stream.content_type, "audio/webm");
    }

    #[test]
    fn reads_artist_from_song_accessibility_label() {
        let payload = json!({
            "contents": {
                "musicResponsiveListItemRenderer": {
                    "playlistItemData": { "videoId": "abc123" },
                    "overlay": {
                        "musicItemThumbnailOverlayRenderer": {
                            "content": {
                                "musicPlayButtonRenderer": {
                                    "accessibilityPlayData": {
                                        "accessibilityData": {
                                            "label": "Reproducir Instant Crush - Daft Punk"
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "flexColumns": [
                        {
                            "musicResponsiveListItemFlexColumnRenderer": {
                                "text": { "runs": [{ "text": "Instant Crush" }] }
                            }
                        },
                        {
                            "musicResponsiveListItemFlexColumnRenderer": {
                                "text": {
                                    "runs": [
                                        { "text": "Canción" },
                                        { "text": " • " },
                                        { "text": "5:38" }
                                    ]
                                }
                            }
                        }
                    ]
                }
            }
        });

        let tracks = parse_search(&payload, 5);
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].artist, "Daft Punk");
        assert_eq!(tracks[0].title, "Instant Crush");
        assert_eq!(tracks[0].album, "");
        assert_eq!(tracks[0].duration_sec, 338.0);
    }

    #[test]
    fn reads_artist_and_album_from_browse_endpoints() {
        let payload = json!({
            "musicResponsiveListItemRenderer": {
                "playlistItemData": { "videoId": "xyz789" },
                "flexColumns": [
                    {
                        "musicResponsiveListItemFlexColumnRenderer": {
                            "text": { "runs": [{ "text": "Get Lucky" }] }
                        }
                    },
                    {
                        "musicResponsiveListItemFlexColumnRenderer": {
                            "text": {
                                "runs": [
                                    {
                                        "text": "Daft Punk",
                                        "navigationEndpoint": {
                                            "browseEndpoint": {
                                                "browseId": "UC123",
                                                "browseEndpointContextSupportedConfigs": {
                                                    "browseEndpointContextMusicConfig": {
                                                        "pageType": "MUSIC_PAGE_TYPE_ARTIST"
                                                    }
                                                }
                                            }
                                        }
                                    },
                                    { "text": " • " },
                                    {
                                        "text": "Discovery",
                                        "navigationEndpoint": {
                                            "browseEndpoint": {
                                                "browseId": "MPRE123",
                                                "browseEndpointContextSupportedConfigs": {
                                                    "browseEndpointContextMusicConfig": {
                                                        "pageType": "MUSIC_PAGE_TYPE_ALBUM"
                                                    }
                                                }
                                            }
                                        }
                                    },
                                    { "text": " • " },
                                    { "text": "3:32" }
                                ]
                            }
                        }
                    }
                ]
            }
        });

        let tracks = parse_search(&payload, 5);
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].artist, "Daft Punk");
        assert_eq!(tracks[0].album, "Discovery");
        assert_eq!(tracks[0].duration_sec, 212.0);
    }
}
