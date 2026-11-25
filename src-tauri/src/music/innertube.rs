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

use super::{ImportedPlaylist, MusicEngine, ResolvedStream, Suggestions, Track};

const YOUTUBE: &str = "https://www.youtube.com";
const YOUTUBE_MUSIC: &str = "https://music.youtube.com";
/// Filtro "Canciones" de YouTube Music: deja fuera podcasts, audiolibros,
/// álbumes, artistas y vídeos sueltos.
const SONGS_FILTER: &str = "EgWKAQIIAWoMEA4QChADEAQQCRAF";
const PODCAST_EPISODE: &str = "MUSIC_VIDEO_TYPE_PODCAST_EPISODE";
const GREYED_OUT: &str = "MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT";
/// Las charlas largas también aparecen como "canciones" en el catálogo.
const MAX_SEARCH_SONG_SECONDS: f64 = 25.0 * 60.0;
const MAX_PLAYLIST_TRACKS: usize = 2000;
const MAX_PLAYLIST_PAGES: usize = 40;
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

    async fn browse(&self, body: Value) -> Result<Value, String> {
        self.post_music("browse", body).await
    }

    async fn post_music(&self, endpoint: &str, body: Value) -> Result<Value, String> {
        let response = self
            .http
            .post(format!("{YOUTUBE_MUSIC}/youtubei/v1/{endpoint}?prettyPrint=false"))
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
        Ok(value)
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
            "params": SONGS_FILTER,
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

    async fn playlist(&self, playlist_id: &str) -> Result<ImportedPlaylist, String> {
        let first = self
            .browse(json!({
                "context": { "client": self.music_client() },
                "browseId": format!("VL{playlist_id}"),
            }))
            .await?;

        // Solo se lee el estante de la playlist: la misma página incluye
        // sugerencias que no forman parte de ella.
        let shelf = find_key(&first, "musicPlaylistShelfRenderer").ok_or_else(|| {
            "No se pudo leer la playlist. Comprueba que sea pública o no listada.".to_string()
        })?;

        let title = playlist_title(&first).unwrap_or_else(|| "Playlist importada".to_string());
        let mut seen = std::collections::HashSet::new();
        let mut tracks = parse_tracks(shelf, MAX_PLAYLIST_TRACKS, &mut seen);
        let mut token = find_continuation(shelf);
        let mut pages = 0;

        while let Some(continuation) = token {
            if tracks.len() >= MAX_PLAYLIST_TRACKS || pages >= MAX_PLAYLIST_PAGES {
                break;
            }
            pages += 1;

            let page = self
                .browse(json!({
                    "context": { "client": self.music_client() },
                    "continuation": continuation,
                }))
                .await?;
            let remaining = MAX_PLAYLIST_TRACKS - tracks.len();
            tracks.extend(parse_tracks(&page, remaining, &mut seen));
            token = find_continuation(&page).filter(|next| *next != continuation);
        }

        if tracks.is_empty() {
            return Err("La playlist no tiene canciones disponibles".to_string());
        }

        Ok(ImportedPlaylist {
            id: playlist_id.to_string(),
            title,
            source: "YouTube Music".to_string(),
            skipped: 0,
            tracks,
        })
    }

    async fn suggestions(&self, query: &str) -> Result<Suggestions, String> {
        let value = self
            .post_music(
                "music/get_search_suggestions",
                json!({ "context": { "client": self.music_client() }, "input": query }),
            )
            .await?;
        Ok(parse_suggestions(&value))
    }

    async fn search_raw(&self, query: &str, params: &str) -> Result<Value, String> {
        let mut body = json!({ "context": { "client": self.music_client() }, "query": query });
        if !params.is_empty() {
            body["params"] = json!(params);
        }
        self.post_music("search", body).await
    }

    async fn browse_page(
        &self,
        browse_id: &str,
        params: Option<&str>,
        region: &str,
    ) -> Result<Value, String> {
        let mut client = self.music_client();
        client["gl"] = json!(region);
        let mut body = json!({ "context": { "client": client }, "browseId": browse_id });
        if let Some(params) = params.filter(|value| !value.is_empty()) {
            body["params"] = json!(params);
        }
        self.browse(body).await
    }

    async fn radio(&self, video_id: &str, limit: usize) -> Result<Vec<Track>, String> {
        let value = self
            .post_music(
                "next",
                json!({
                    "context": { "client": self.music_client() },
                    "videoId": video_id,
                    "playlistId": format!("RDAMVM{video_id}"),
                    "isAudioOnly": true,
                }),
            )
            .await?;
        Ok(parse_radio(&value, video_id, limit))
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

/// Extrae el id de un enlace de playlist o acepta el id pegado directamente.
/// Nunca se visita el enlace: solo se usa el id contra la API de YouTube Music.
pub fn parse_playlist_id(input: &str) -> Result<String, String> {
    const INVALID: &str = "Pega el enlace de una playlist pública o no listada de YouTube Music";

    let text = input.trim();
    let from_link = text.match_indices("list=").find_map(|(index, key)| {
        let boundary = text[..index].chars().last();
        matches!(boundary, Some('?') | Some('&')).then(|| {
            text[index + key.len()..]
                .split(|c: char| c == '&' || c == '#' || c.is_whitespace())
                .next()
                .unwrap_or_default()
        })
    });
    let raw = from_link.unwrap_or(text);
    let id = raw.strip_prefix("VL").unwrap_or(raw);

    let valid = (10..=128).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return Err(INVALID.to_string());
    }
    if id.starts_with("RD") && !id.starts_with("RDCLAK") {
        return Err("Las mezclas automáticas de YouTube no se pueden importar".to_string());
    }
    Ok(id.to_string())
}

fn find_key<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(map) => map
            .get(key)
            .or_else(|| map.values().find_map(|child| find_key(child, key))),
        Value::Array(items) => items.iter().find_map(|child| find_key(child, key)),
        _ => None,
    }
}

fn find_continuation(value: &Value) -> Option<String> {
    let token = find_key(value, "continuationCommand")
        .and_then(|command| command.get("token"))
        .or_else(|| {
            find_key(value, "nextContinuationData").and_then(|data| data.get("continuation"))
        })?;
    token
        .as_str()
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn playlist_title(value: &Value) -> Option<String> {
    [
        "musicResponsiveHeaderRenderer",
        "musicDetailHeaderRenderer",
        "musicEditablePlaylistDetailHeaderRenderer",
    ]
    .iter()
    .find_map(|key| {
        find_key(value, key)?
            .pointer("/title/runs/0/text")?
            .as_str()
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(str::to_string)
    })
    .or_else(|| {
        value
            .pointer("/microformat/microformatDataRenderer/title")?
            .as_str()
            .map(|title| title.trim_end_matches(" - YouTube Music").trim().to_string())
            .filter(|title| !title.is_empty())
    })
}

fn is_excluded(item: &Value) -> bool {
    const MUSIC_TYPE: &str =
        "watchEndpoint/watchEndpointMusicSupportedConfigs/watchEndpointMusicConfig/musicVideoType";

    let greyed_out = item
        .get("musicItemRendererDisplayPolicy")
        .and_then(Value::as_str)
        == Some(GREYED_OUT);

    let podcast = [
        format!(
            "/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/{MUSIC_TYPE}"
        ),
        format!(
            "/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs/0/navigationEndpoint/{MUSIC_TYPE}"
        ),
    ]
    .iter()
    .any(|path| item.pointer(path).and_then(Value::as_str) == Some(PODCAST_EPISODE));

    greyed_out || podcast
}

/// Algunas narraciones están catalogadas como canciones. "podcast" solo se
/// mira en artista y álbum para no descartar temas que se titulen así.
pub(super) fn is_spoken_content(title: &str, artist: &str, album: &str) -> bool {
    let credits = format!("{artist} {album}").to_lowercase();
    let everything = format!("{title} {credits}").to_lowercase();
    credits.contains("podcast")
        || ["audiolibro", "audiobook", "audio libro", "audio book"]
            .iter()
            .any(|word| everything.contains(word))
}

/// Resultados de canciones: la relevancia de YouTube combinada con las
/// reproducciones, para que lo más escuchado suba aunque se escriba poco.
fn parse_search(value: &Value, limit: usize) -> Vec<Track> {
    let mut renderers = Vec::new();
    collect_renderers(value, &mut renderers);
    let plays: std::collections::HashMap<String, f64> = renderers
        .iter()
        .filter_map(|item| Some((video_id_of(item)?, plays_of(item)?)))
        .collect();

    let mut seen = std::collections::HashSet::new();
    let mut ranked: Vec<(f64, Track)> = parse_tracks(value, usize::MAX, &mut seen)
        .into_iter()
        .filter(|track| track.duration_sec <= MAX_SEARCH_SONG_SECONDS)
        .enumerate()
        .map(|(position, track)| {
            let count = plays.get(&track.video_id).copied().unwrap_or(0.0);
            // Cada puesto de relevancia pesa como multiplicar ×2 las reproducciones.
            let score = (count + 1.0).log10() - position as f64 * 0.3;
            (score, track)
        })
        .collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
    ranked.into_iter().take(limit).map(|(_, track)| track).collect()
}

/// "84 M reproducciones", "7,3 M de visualizaciones", "19 K plays"...
fn plays_of(item: &Value) -> Option<f64> {
    (1..4).find_map(|column| {
        runs_of(item, column).into_iter().find_map(|text| {
            let lower = text.to_lowercase();
            if !["reproducci", "visualizaci", "plays", "views"].iter().any(|word| lower.contains(word)) {
                return None;
            }
            parse_count(&lower)
        })
    })
}

fn parse_count(text: &str) -> Option<f64> {
    let mut parts = text.split_whitespace();
    let number: f64 = parts.next()?.replace(',', ".").parse().ok()?;
    let rest: Vec<&str> = parts.collect();
    let multiplier = match rest.first().copied() {
        Some("k") | Some("mil") if rest.get(1) == Some(&"m") => 1e9,
        Some("k") | Some("mil") => 1e3,
        Some("m") | Some("mill.") => 1e6,
        Some("b") | Some("mm") => 1e9,
        _ => 1.0,
    };
    Some(number * multiplier)
}

pub(super) fn parse_tracks(
    value: &Value,
    limit: usize,
    seen: &mut std::collections::HashSet<String>,
) -> Vec<Track> {
    let mut renderers = Vec::new();
    collect_renderers(value, &mut renderers);

    let mut tracks = Vec::new();
    if limit == 0 {
        return tracks;
    }

    for item in renderers {
        if is_excluded(item) {
            continue;
        }
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

        if is_spoken_content(&title, &artist, &album) {
            continue;
        }

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
        .filter(|artist| !artist.is_empty() && !is_spoken_duration(artist))
        .map(str::to_string)
}

/// En playlists la etiqueta puede acabar en "5 minutos y 1 segundo".
fn is_spoken_duration(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.chars().any(|c| c.is_ascii_digit())
        && ["minuto", "segundo", "hora", "minute", "second", "hour"]
            .iter()
            .any(|unit| lower.contains(unit))
}

fn album_of(item: &Value) -> Option<String> {
    // En búsquedas va en la segunda columna; en playlists, en la tercera.
    [1, 2]
        .into_iter()
        .flat_map(|column| runs_values(item, column))
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

fn parse_suggestions(value: &Value) -> Suggestions {
    let mut queries = Vec::new();
    collect_suggestions(value, &mut queries);
    queries.dedup();
    queries.truncate(6);

    let mut seen = std::collections::HashSet::new();
    let tracks = parse_tracks(value, 4, &mut seen);
    Suggestions { queries, tracks }
}

fn collect_suggestions(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if let Some(item) = map.get("searchSuggestionRenderer") {
                let query = item
                    .pointer("/navigationEndpoint/searchEndpoint/query")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        let runs = item.pointer("/suggestion/runs")?.as_array()?;
                        Some(
                            runs.iter()
                                .filter_map(|run| run.get("text").and_then(Value::as_str))
                                .collect::<String>(),
                        )
                    });
                if let Some(query) = query.map(|text| text.trim().to_string()) {
                    if !query.is_empty() {
                        out.push(query);
                    }
                }
                return;
            }
            for child in map.values() {
                collect_suggestions(child, out);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_suggestions(child, out);
            }
        }
        _ => {}
    }
}

fn collect_panel_items<'a>(value: &'a Value, out: &mut Vec<&'a Value>) {
    match value {
        Value::Object(map) => {
            if let Some(item) = map.get("playlistPanelVideoRenderer") {
                out.push(item);
                return;
            }
            for child in map.values() {
                collect_panel_items(child, out);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_panel_items(child, out);
            }
        }
        _ => {}
    }
}

/// Lee la cola de "radio" de `/next`. Se salta la canción de partida.
fn parse_radio(value: &Value, seed: &str, limit: usize) -> Vec<Track> {
    let mut items = Vec::new();
    collect_panel_items(value, &mut items);

    let mut seen = std::collections::HashSet::from([seed.to_string()]);
    let mut tracks = Vec::new();
    for item in items {
        let Some(video_id) = item.get("videoId").and_then(Value::as_str) else {
            continue;
        };
        if video_id.is_empty() || !seen.insert(video_id.to_string()) {
            continue;
        }
        let text_of = |pointer: &str| {
            item.pointer(pointer)
                .and_then(Value::as_array)
                .map(|runs| {
                    runs.iter()
                        .filter_map(|run| run.get("text").and_then(Value::as_str))
                        .collect::<String>()
                })
                .unwrap_or_default()
        };
        let title = text_of("/title/runs").trim().to_string();
        if title.is_empty() {
            continue;
        }

        let runs: Vec<&Value> = item
            .pointer("/longBylineText/runs")
            .and_then(Value::as_array)
            .map(|runs| runs.iter().collect())
            .unwrap_or_default();
        let parts: Vec<String> = text_of("/longBylineText/runs")
            .split(" • ")
            .map(str::trim)
            .filter(|part| !part.is_empty() && !is_noise(part))
            .map(str::to_string)
            .collect();
        let artist = parts.first().cloned().unwrap_or_default();
        let album = runs
            .iter()
            .find_map(|run| run_text(run, "MUSIC_PAGE_TYPE_ALBUM"))
            .map(str::to_string)
            .or_else(|| parts.get(1).cloned())
            .unwrap_or_default();
        if is_spoken_content(&title, &artist, &album) {
            continue;
        }

        let duration_sec = item
            .pointer("/lengthText/runs/0/text")
            .and_then(Value::as_str)
            .and_then(parse_duration)
            .unwrap_or(0.0);
        if duration_sec > MAX_SEARCH_SONG_SECONDS {
            continue;
        }
        let thumbnail_url = item
            .pointer("/thumbnail/thumbnails")
            .and_then(Value::as_array)
            .and_then(|list| list.last())
            .and_then(|thumb| thumb.get("url"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| Some(format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")));

        tracks.push(Track {
            video_id: video_id.to_string(),
            title,
            artist,
            album,
            duration_sec,
            thumbnail_url,
        });
        if tracks.len() >= limit {
            break;
        }
    }
    tracks
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

    fn list_item(video_id: &str, title: &str, music_type: &str) -> Value {
        json!({
            "musicResponsiveListItemRenderer": {
                "playlistItemData": { "videoId": video_id },
                "flexColumns": [{
                    "musicResponsiveListItemFlexColumnRenderer": {
                        "text": { "runs": [{
                            "text": title,
                            "navigationEndpoint": { "watchEndpoint": {
                                "watchEndpointMusicSupportedConfigs": {
                                    "watchEndpointMusicConfig": { "musicVideoType": music_type }
                                }
                            }}
                        }]}
                    }
                }]
            }
        })
    }

    #[test]
    fn reads_playlist_id_from_links() {
        let id = "PLabcdefghij_1234-XYZ";
        for input in [
            format!("https://music.youtube.com/playlist?list={id}&si=abc"),
            format!("https://www.youtube.com/watch?v=abc&list={id}#t"),
            format!("  {id}  "),
            format!("VL{id}"),
        ] {
            assert_eq!(parse_playlist_id(&input).as_deref(), Ok(id));
        }
    }

    #[test]
    fn rejects_unusable_playlist_links() {
        for input in [
            "",
            "LM",
            "https://music.youtube.com/watch?v=abc",
            "https://example.com/?playlist=PLabcdefghij",
            "PLabc/../../etc/passwd",
        ] {
            assert!(parse_playlist_id(input).is_err(), "{input}");
        }
        assert!(parse_playlist_id("list=RDabcdefghij12").is_err());
        assert!(parse_playlist_id("RDCLAK5uy_abcdefghij").is_ok());
    }

    #[test]
    fn skips_podcast_episodes_and_duplicates() {
        let payload = json!([
            list_item("song000001", "Canción", "MUSIC_VIDEO_TYPE_ATV"),
            list_item("song000001", "Canción", "MUSIC_VIDEO_TYPE_ATV"),
            list_item("podcast001", "Episodio", PODCAST_EPISODE),
        ]);
        let tracks = parse_search(&payload, 10);
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].video_id, "song000001");
    }

    #[test]
    fn ignores_spoken_duration_as_artist() {
        let item = json!({
            "overlay": { "musicItemThumbnailOverlayRenderer": { "content": {
                "musicPlayButtonRenderer": { "accessibilityPlayData": {
                    "accessibilityData": {
                        "label": "Reproducir La Soledad - Banda - 5 minutos y 1 segundo"
                    }
                }}
            }}}
        });
        assert_eq!(artist_of(&item), None);
    }

    #[test]
    fn search_skips_very_long_audio() {
        let mut long = list_item("talk000001", "Charla", "MUSIC_VIDEO_TYPE_ATV");
        long["musicResponsiveListItemRenderer"]["fixedColumns"] = json!([{
            "musicResponsiveListItemFixedColumnRenderer": {
                "text": { "runs": [{ "text": "36:43" }] }
            }
        }]);
        let payload = json!([long, list_item("song000001", "Canción", "MUSIC_VIDEO_TYPE_ATV")]);
        let tracks = parse_search(&payload, 10);
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].video_id, "song000001");
    }

    #[test]
    fn detects_spoken_content_without_hiding_songs() {
        assert!(is_spoken_content("Capítulo 1", "Audiolibros en Español", ""));
        assert!(is_spoken_content("Episodio 4", "Mi Podcast", ""));
        assert!(!is_spoken_content("Podcast", "Una Banda", "Un Disco"));
    }

    #[test]
    fn reads_playlist_continuation_formats() {
        let current = json!({ "contents": [{
            "continuationItemRenderer": { "continuationEndpoint": {
                "continuationCommand": { "token": "next-a" }
            }}
        }]});
        assert_eq!(find_continuation(&current).as_deref(), Some("next-a"));

        let legacy = json!({ "continuations": [{
            "nextContinuationData": { "continuation": "next-b" }
        }]});
        assert_eq!(find_continuation(&legacy).as_deref(), Some("next-b"));
        assert_eq!(find_continuation(&json!({ "contents": [] })), None);
    }

    #[test]
    fn reads_play_counts() {
        assert_eq!(parse_count("84 m reproducciones"), Some(84e6));
        assert_eq!(parse_count("7,3 m de visualizaciones"), Some(7.3e6));
        assert_eq!(parse_count("19 k reproducciones"), Some(19e3));
        assert_eq!(parse_count("1,2 b views"), Some(1.2e9));
        assert_eq!(parse_count("850 reproducciones"), Some(850.0));
    }

    #[test]
    fn reads_search_suggestions_and_songs() {
        let value = json!({ "contents": [
            { "searchSuggestionsSectionRenderer": { "contents": [
                { "searchSuggestionRenderer": {
                    "suggestion": { "runs": [{ "text": "bad bun" }, { "text": "ny" }] },
                    "navigationEndpoint": { "searchEndpoint": { "query": "bad bunny" } }
                }},
                { "searchSuggestionRenderer": {
                    "suggestion": { "runs": [{ "text": "bad bunny dtmf" }] }
                }}
            ]}},
            { "searchSuggestionsSectionRenderer": { "contents": [
                list_item("abc", "EoO", "MUSIC_VIDEO_TYPE_ATV")
            ]}}
        ]});
        let parsed = parse_suggestions(&value);
        assert_eq!(parsed.queries, vec!["bad bunny", "bad bunny dtmf"]);
        assert_eq!(parsed.tracks.len(), 1);
        assert_eq!(parsed.tracks[0].video_id, "abc");
    }

    #[test]
    fn reads_radio_without_seed_or_noise() {
        let item = |id: &str, title: &str, byline: &str| {
            json!({ "playlistPanelVideoRenderer": {
                "videoId": id,
                "title": { "runs": [{ "text": title }] },
                "longBylineText": { "runs": [{ "text": byline }] },
                "lengthText": { "runs": [{ "text": "3:44" }] }
            }})
        };
        let value = json!({ "contents": [
            item("seed", "Tití me preguntó", "Bad Bunny • 1133 M de visualizaciones"),
            item("b", "NUEVAYoL", "Bad Bunny • 174 M de visualizaciones • 1,2 M Me gusta"),
            item("b", "NUEVAYoL", "Bad Bunny"),
            item("c", "Capítulo 1", "Autor • Audiolibro"),
        ]});
        let tracks = parse_radio(&value, "seed", 10);
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].video_id, "b");
        assert_eq!(tracks[0].artist, "Bad Bunny");
        assert_eq!(tracks[0].duration_sec, 224.0);
    }

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
