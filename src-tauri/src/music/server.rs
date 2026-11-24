//! Servidor HTTP local del puente de música.
//!
//! Contrato:
//!   GET    /health
//!   GET    /search?q=<texto>&limit=<1..30>&t=<token>
//!   GET    /stream/<videoId>?t=<token>      (soporta Range)
//!   GET    /suggest?q=<texto>&t=<token>     (sugerencias al escribir)
//!   GET    /radio/<videoId>?limit=<n>&t=<token>  (canciones parecidas)
//!   GET    /playlist?link=<enlace o id>&t=<token>
//!   POST   /library/export?t=<token>        (devuelve CSV)
//!   POST   /library/import?t=<token>        (nombre y contenido del archivo)
//!   POST /download/<videoId>?t=<token>    (metadatos en el cuerpo JSON)
//!   GET    /offline?t=<token>
//!   GET    /offline/<videoId>?t=<token>     (soporta Range, sin red)
//!   DELETE /offline/<videoId>?t=<token>
//!
//! Escucha solo en 127.0.0.1 y exige token. El token viaja en la query porque
//! un `<audio src>` no puede enviar cabeceras personalizadas.

use std::collections::{HashMap, HashSet};
use std::net::{TcpListener as StdTcpListener};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use tokio::io::AsyncWriteExt;
use tower_http::cors::CorsLayer;

use super::importers::{external_url, import_url};
use super::innertube::parse_playlist_id;
use super::library::{export_csv, import_file, ExportRequest, ImportRequest};
use super::{BridgeInfo, MusicEngine, OfflineTrack, ResolvedStream, Track};

const SEARCH_TTL: Duration = Duration::from_secs(10 * 60);
const PAGE_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_SEARCH_CACHE: usize = 64;
const MAX_STREAM_CACHE: usize = 128;
const OFFLINE_INDEX: &str = "index.json";
const MAX_LIBRARY_BYTES: usize = 24 * 1024 * 1024;
const PROXY_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// Descargas locales. El índice vive en memoria y se persiste como JSON en la
/// misma carpeta que los audios; así la lista sobrevive reinicios aunque el
/// WebView borre su `localStorage`.
struct OfflineStore {
    dir: PathBuf,
    entries: Mutex<Vec<OfflineTrack>>,
}

impl OfflineStore {
    fn open(dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("No se pudo crear la carpeta de descargas: {e}"))?;

        let entries = std::fs::read(dir.join(OFFLINE_INDEX))
            .ok()
            .and_then(|raw| serde_json::from_slice::<Vec<OfflineTrack>>(&raw).ok())
            .unwrap_or_default();

        Ok(Self {
            dir,
            entries: Mutex::new(entries),
        })
    }

    fn list(&self) -> Vec<OfflineTrack> {
        let Ok(guard) = self.entries.lock() else {
            return Vec::new();
        };
        let mut list = guard.clone();
        list.sort_by(|a, b| b.downloaded_at.cmp(&a.downloaded_at));
        list
    }

    fn find(&self, video_id: &str) -> Option<OfflineTrack> {
        let guard = self.entries.lock().ok()?;
        guard
            .iter()
            .find(|entry| entry.video_id == video_id)
            .cloned()
    }

    fn insert(&self, entry: OfflineTrack) -> Result<(), String> {
        let snapshot = {
            let mut guard = self
                .entries
                .lock()
                .map_err(|_| "El índice de descargas está bloqueado".to_string())?;
            guard.retain(|item| item.video_id != entry.video_id);
            guard.push(entry);
            guard.clone()
        };
        self.persist(&snapshot)
    }

    fn remove(&self, video_id: &str) -> Result<Option<OfflineTrack>, String> {
        let (removed, snapshot) = {
            let mut guard = self
                .entries
                .lock()
                .map_err(|_| "El índice de descargas está bloqueado".to_string())?;
            let index = guard.iter().position(|item| item.video_id == video_id);
            let removed = index.map(|index| guard.remove(index));
            (removed, guard.clone())
        };
        if removed.is_some() {
            self.persist(&snapshot)?;
        }
        Ok(removed)
    }

    fn persist(&self, entries: &[OfflineTrack]) -> Result<(), String> {
        let raw = serde_json::to_vec_pretty(entries)
            .map_err(|e| format!("No se pudo serializar el índice: {e}"))?;
        std::fs::write(self.dir.join(OFFLINE_INDEX), raw)
            .map_err(|e| format!("No se pudo guardar el índice de descargas: {e}"))
    }

    fn path_of(&self, entry: &OfflineTrack) -> PathBuf {
        self.dir.join(&entry.file_name)
    }
}

struct CachedSearch {
    at: Instant,
    tracks: Vec<Track>,
}

struct CachedStream {
    stream: ResolvedStream,
}

#[derive(Clone)]
struct AppState {
    token: String,
    engine: Arc<dyn MusicEngine>,
    http: reqwest::Client,
    searches: Arc<Mutex<HashMap<String, CachedSearch>>>,
    streams: Arc<Mutex<HashMap<String, CachedStream>>>,
    offline: Option<Arc<OfflineStore>>,
    downloading: Arc<Mutex<HashSet<String>>>,
    pages: Arc<Mutex<HashMap<String, (Instant, serde_json::Value)>>>,
}

impl AppState {
    /// Lee una página de descubrimiento, guardada 30 minutos para no repetir peticiones.
    async fn discover_page(
        &self,
        browse_id: &str,
        params: Option<&str>,
        region: &str,
    ) -> Result<serde_json::Value, String> {
        let key = format!("{browse_id}|{}|{region}", params.unwrap_or(""));
        if let Ok(guard) = self.pages.lock() {
            if let Some((at, value)) = guard.get(&key) {
                if at.elapsed() < PAGE_TTL {
                    return Ok(value.clone());
                }
            }
        }
        let value = self.engine.browse_page(browse_id, params, region).await?;
        if let Ok(mut guard) = self.pages.lock() {
            if guard.len() >= 48 {
                guard.clear();
            }
            guard.insert(key, (Instant::now(), value.clone()));
        }
        Ok(value)
    }

    fn authorized(&self, headers: &HeaderMap, token: Option<&str>) -> bool {
        if token.is_some_and(|candidate| candidate == self.token.as_str()) {
            return true;
        }
        headers
            .get("x-pocketall-token")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|candidate| candidate == self.token.as_str())
    }

    fn cached_search(&self, key: &str) -> Option<Vec<Track>> {
        let guard = self.searches.lock().ok()?;
        let entry = guard.get(key)?;
        if entry.at.elapsed() > SEARCH_TTL {
            return None;
        }
        Some(entry.tracks.clone())
    }

    fn store_search(&self, key: String, tracks: Vec<Track>) {
        let Ok(mut guard) = self.searches.lock() else {
            return;
        };
        if guard.len() >= MAX_SEARCH_CACHE {
            guard.clear();
        }
        guard.insert(
            key,
            CachedSearch {
                at: Instant::now(),
                tracks,
            },
        );
    }

    async fn resolve_cached(&self, video_id: &str) -> Result<ResolvedStream, String> {
        {
            let Ok(guard) = self.streams.lock() else {
                return self.engine.resolve(video_id).await;
            };
            if let Some(entry) = guard.get(video_id) {
                if entry.stream.expires_at > Instant::now() {
                    return Ok(entry.stream.clone());
                }
            }
        }

        let stream = self.engine.resolve(video_id).await?;

        if let Ok(mut guard) = self.streams.lock() {
            if guard.len() >= MAX_STREAM_CACHE {
                guard.clear();
            }
            guard.insert(
                video_id.to_string(),
                CachedStream {
                    stream: stream.clone(),
                },
            );
        }

        Ok(stream)
    }

    fn invalidate_stream(&self, video_id: &str) {
        if let Ok(mut guard) = self.streams.lock() {
            guard.remove(video_id);
        }
    }
}

/// Arranca el servidor dentro del proceso Tauri. `data_dir` es la carpeta de
/// datos de la app; si falta (modo standalone), las descargas quedan
/// desactivadas y `/offline` responde 503.
pub fn start(engine: Arc<dyn MusicEngine>, data_dir: Option<PathBuf>) -> Result<BridgeInfo, String> {
    let (state, info) = prepare(engine, data_dir, 0)?;
    let listener = StdTcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let info = BridgeInfo {
        base_url: format!("http://127.0.0.1:{port}"),
        ..info
    };
    let app = router(state);

    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => {
                if let Err(err) = axum::serve(listener, app).await {
                    eprintln!("[PocketAll] servidor detenido: {err}");
                }
            }
            Err(err) => eprintln!("[PocketAll] no se pudo activar el listener: {err}"),
        }
    });

    Ok(info)
}

/// Modo standalone: lo usa `src/bin/pocketall.rs` (sidecar opcional).
pub async fn run_standalone(engine: Arc<dyn MusicEngine>, port: u16) -> Result<(), String> {
    let (state, mut info) = prepare(engine, None, port)?;
    let listener = StdTcpListener::bind(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let bound = listener.local_addr().map_err(|e| e.to_string())?;
    info.base_url = format!("http://127.0.0.1:{}", bound.port());
    println!(
        "{}",
        serde_json::to_string(&info).map_err(|e| e.to_string())?
    );

    let listener = tokio::net::TcpListener::from_std(listener).map_err(|e| e.to_string())?;
    axum::serve(listener, router(state))
        .await
        .map_err(|e| e.to_string())
}

fn prepare(
    engine: Arc<dyn MusicEngine>,
    data_dir: Option<PathBuf>,
    _port: u16,
) -> Result<(AppState, BridgeInfo), String> {
    let http = reqwest::Client::builder()
        .user_agent(PROXY_USER_AGENT)
        .connect_timeout(Duration::from_secs(6))
        // Timeout por operación de lectura, no total: un `timeout` global corta
        // la descarga de una canción larga a mitad. El `<audio>` pide por
        // `Range`, así que ninguna lectura individual debería tardar 30 s.
        .read_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("No se pudo crear el cliente HTTP del proxy: {e}"))?;

    // Si la carpeta no se puede crear, la app sigue funcionando sin descargas:
    // es mejor perder esa función que impedir reproducir música.
    let offline = data_dir.and_then(|dir| match OfflineStore::open(dir.join("offline")) {
        Ok(store) => Some(Arc::new(store)),
        Err(err) => {
            eprintln!("[PocketAll] descargas desactivadas: {err}");
            None
        }
    });

    let token = random_token();
    let info = BridgeInfo {
        base_url: String::new(),
        token: token.clone(),
        engine: engine.name().to_string(),
        available: engine.available(),
        message: engine.message(),
    };

    Ok((
        AppState {
            token,
            engine,
            http,
            searches: Arc::new(Mutex::new(HashMap::new())),
            streams: Arc::new(Mutex::new(HashMap::new())),
            offline,
            downloading: Arc::new(Mutex::new(HashSet::new())),
            pages: Arc::new(Mutex::new(HashMap::new())),
        },
        info,
    ))
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/search", get(search))
        .route("/stream/{video_id}", get(stream))
        .route("/playlist", get(playlist))
        .route("/suggest", get(suggest))
        .route("/radio/{video_id}", get(radio))
        .route("/discover", get(discover))
        .route("/moods", get(moods))
        .route("/lookup", get(lookup))
        .route(
            "/library/export",
            post(export_library).layer(DefaultBodyLimit::max(MAX_LIBRARY_BYTES)),
        )
        .route(
            "/library/import",
            post(import_library).layer(DefaultBodyLimit::max(MAX_LIBRARY_BYTES)),
        )
        .route("/download/{video_id}", post(download))
        .route("/offline", get(list_offline))
        .route("/offline/{video_id}", get(offline_stream).delete(delete_offline))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Response {
    Json(json!({
        "ok": true,
        "engine": state.engine.name(),
        "available": state.engine.available(),
    }))
    .into_response()
}

#[derive(Deserialize)]
struct SearchParams {
    q: Option<String>,
    limit: Option<usize>,
    t: Option<String>,
}

async fn search(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
    headers: HeaderMap,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }

    let query = params.q.unwrap_or_default().trim().to_string();
    if query.is_empty() {
        return error(StatusCode::BAD_REQUEST, "Falta el parámetro q");
    }
    if query.chars().count() > 200 {
        return error(StatusCode::BAD_REQUEST, "Consulta demasiado larga");
    }

    let limit = params.limit.unwrap_or(20).clamp(1, 30);
    let key = format!("{}|{limit}", query.to_lowercase());

    if let Some(tracks) = state.cached_search(&key) {
        return Json(tracks).into_response();
    }

    match state.engine.search(&query, limit).await {
        Ok(tracks) => {
            state.store_search(key, tracks.clone());
            Json(tracks).into_response()
        }
        Err(err) => error(StatusCode::BAD_GATEWAY, err),
    }
}

async fn suggest(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
    headers: HeaderMap,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }
    let query = params.q.unwrap_or_default().trim().to_string();
    if query.is_empty() || query.chars().count() > 200 {
        return Json(super::Suggestions::default()).into_response();
    }
    match state.engine.suggestions(&query).await {
        Ok(found) => Json(found).into_response(),
        Err(err) => error(StatusCode::BAD_GATEWAY, err),
    }
}

async fn radio(
    State(state): State<AppState>,
    Path(video_id): Path<String>,
    Query(params): Query<SearchParams>,
    headers: HeaderMap,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }
    let valid = (6..=20).contains(&video_id.len())
        && video_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return error(StatusCode::BAD_REQUEST, "Canción no válida");
    }
    let limit = params.limit.unwrap_or(25).clamp(1, 50);
    match state.engine.radio(&video_id, limit).await {
        Ok(tracks) => Json(tracks).into_response(),
        Err(err) => error(StatusCode::BAD_GATEWAY, err),
    }
}

#[derive(Deserialize)]
struct DiscoverParams {
    /// Página: vacío para el inicio o una categoría de ánimo/género.
    id: Option<String>,
    params: Option<String>,
    gl: Option<String>,
    t: Option<String>,
}

fn clean_region(gl: Option<&str>) -> String {
    gl.filter(|code| code.len() == 2 && code.chars().all(|c| c.is_ascii_alphabetic()))
        .map(str::to_ascii_uppercase)
        .unwrap_or_else(|| "US".to_string())
}

fn clean_params(params: Option<&str>) -> Option<&str> {
    params.filter(|value| {
        !value.is_empty()
            && value.len() <= 512
            && value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '=' | '%'))
    })
}

/// Inicio (sin `id`) o una categoría de ánimo o género (`id` + `params`).
async fn discover(
    State(state): State<AppState>,
    Query(params): Query<DiscoverParams>,
    headers: HeaderMap,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }
    let region = clean_region(params.gl.as_deref());
    let browse_id = params.id.as_deref().unwrap_or("FEmusic_home");
    // Inicio, una categoría o la página de un artista (UC...).
    let artist = browse_id.len() == 24
        && browse_id.starts_with("UC")
        && browse_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !artist && !matches!(browse_id, "FEmusic_home" | "FEmusic_moods_and_genres_category") {
        return error(StatusCode::BAD_REQUEST, "Página no válida");
    }
    let page_params = clean_params(params.params.as_deref());
    if params.params.is_some() && page_params.is_none() {
        return error(StatusCode::BAD_REQUEST, "Parámetros no válidos");
    }
    match state.discover_page(browse_id, page_params, &region).await {
        Ok(value) => Json(super::discover::parse_page(&value)).into_response(),
        Err(err) => error(StatusCode::BAD_GATEWAY, err),
    }
}

#[derive(Deserialize)]
struct LookupParams {
    kind: Option<String>,
    q: Option<String>,
    t: Option<String>,
}

/// Busca el álbum o el artista de una canción para abrir su página.
async fn lookup(
    State(state): State<AppState>,
    Query(params): Query<LookupParams>,
    headers: HeaderMap,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }
    let kind = params.kind.as_deref().unwrap_or_default();
    let filter = match kind {
        "album" => "EgWKAQIYAWoMEA4QChADEAQQCRAF",
        "artist" => "EgWKAQIgAWoMEA4QChADEAQQCRAF",
        _ => return error(StatusCode::BAD_REQUEST, "Tipo no válido"),
    };
    let query = params.q.unwrap_or_default().trim().to_string();
    if query.is_empty() || query.chars().count() > 200 {
        return error(StatusCode::BAD_REQUEST, "Búsqueda no válida");
    }
    match state.engine.search_raw(&query, filter).await {
        Ok(value) => match super::discover::parse_lookup(&value, kind) {
            Some(item) => Json(item).into_response(),
            None => error(StatusCode::NOT_FOUND, "No se encontró en YouTube Music"),
        },
        Err(err) => error(StatusCode::BAD_GATEWAY, err),
    }
}

async fn moods(
    State(state): State<AppState>,
    Query(params): Query<DiscoverParams>,
    headers: HeaderMap,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }
    let region = clean_region(params.gl.as_deref());
    match state
        .discover_page("FEmusic_moods_and_genres", None, &region)
        .await
    {
        Ok(value) => Json(super::discover::parse_moods(&value)).into_response(),
        Err(err) => error(StatusCode::BAD_GATEWAY, err),
    }
}

#[derive(Deserialize)]
struct PlaylistParams {
    link: Option<String>,
    t: Option<String>,
}

async fn playlist(
    State(state): State<AppState>,
    Query(params): Query<PlaylistParams>,
    headers: HeaderMap,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }

    let link = params.link.unwrap_or_default();
    if link.len() > 2048 {
        return error(StatusCode::BAD_REQUEST, "Enlace demasiado largo");
    }
    let result = if let Some(url) = external_url(&link) {
        import_url(&state.engine, url).await
    } else {
        let playlist_id = match parse_playlist_id(&link) {
            Ok(id) => id,
            Err(err) => return error(StatusCode::BAD_REQUEST, err),
        };
        state.engine.playlist(&playlist_id).await
    };

    match result {
        Ok(playlist) => Json(playlist).into_response(),
        Err(err) => error(StatusCode::BAD_GATEWAY, err),
    }
}

#[derive(Deserialize)]
struct TokenParams {
    t: Option<String>,
}

async fn export_library(
    State(state): State<AppState>,
    Query(params): Query<TokenParams>,
    headers: HeaderMap,
    Json(request): Json<ExportRequest>,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }
    (
        [(header::CONTENT_TYPE, "text/csv; charset=utf-8")],
        export_csv(&request),
    )
        .into_response()
}

async fn import_library(
    State(state): State<AppState>,
    Query(params): Query<TokenParams>,
    headers: HeaderMap,
    Json(request): Json<ImportRequest>,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }
    match import_file(&state.engine, request).await {
        Ok(result) => Json(result).into_response(),
        Err(err) => error(StatusCode::BAD_REQUEST, err),
    }
}

async fn stream(
    State(state): State<AppState>,
    Path(video_id): Path<String>,
    Query(params): Query<TokenParams>,
    headers: HeaderMap,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }
    if !valid_video_id(&video_id) {
        return error(StatusCode::BAD_REQUEST, "videoId inválido");
    }

    let range = headers.get(header::RANGE).cloned();

    for attempt in 0..2 {
        let resolved = match state.resolve_cached(&video_id).await {
            Ok(stream) => stream,
            Err(err) => return error(StatusCode::BAD_GATEWAY, err),
        };

        match proxy(&state, &resolved, range.clone()).await {
            Ok(response) => return response,
            Err(err) => {
                // La URL pudo caducar entre la caché y el CDN: se invalida y
                // se reintenta una sola vez con una URL recién resuelta.
                state.invalidate_stream(&video_id);
                if attempt == 1 {
                    return error(StatusCode::BAD_GATEWAY, err);
                }
            }
        }
    }

    error(StatusCode::BAD_GATEWAY, "No se pudo abrir el stream")
}

async fn proxy(
    state: &AppState,
    resolved: &ResolvedStream,
    range: Option<HeaderValue>,
) -> Result<Response, String> {
    let mut request = state
        .http
        .get(resolved.url.as_str())
        .header(header::REFERER, "https://www.youtube.com/");

    for (name, value) in &resolved.headers {
        let (Ok(name), Ok(value)) = (
            name.parse::<HeaderName>(),
            HeaderValue::from_str(value),
        ) else {
            continue;
        };
        request = request.header(name, value);
    }

    if let Some(range) = range {
        request = request.header(header::RANGE, range);
    }

    let upstream = request
        .send()
        .await
        .map_err(|e| format!("No se pudo leer el stream: {e}"))?;

    let status = upstream.status();
    if status == StatusCode::FORBIDDEN || status == StatusCode::GONE {
        return Err("El CDN rechazó la URL del stream".to_string());
    }
    if !status.is_success() {
        return Err(format!("El CDN respondió HTTP {status}"));
    }

    let upstream_headers = upstream.headers().clone();
    let mut response = Response::new(Body::from_stream(upstream.bytes_stream()));
    *response.status_mut() = StatusCode::from_u16(status.as_u16())
        .unwrap_or(StatusCode::BAD_GATEWAY);

    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::ETAG,
        header::LAST_MODIFIED,
    ] {
        if let Some(value) = upstream_headers.get(&name) {
            response.headers_mut().insert(name, value.clone());
        }
    }

    if !response.headers().contains_key(header::CONTENT_TYPE) {
        if let Ok(value) = HeaderValue::from_str(&resolved.content_type) {
            response
                .headers_mut()
                .insert(header::CONTENT_TYPE, value);
        }
    }

    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok(response)
}

pub(super) fn valid_video_id(video_id: &str) -> bool {
    video_id.len() == 11
        && video_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

// ---------------------------------------------------------------------------
// Descargas offline
// ---------------------------------------------------------------------------

/// `POST /download/{videoId}`: descarga el audio completo al almacenamiento de
/// la app. Devuelve la entrada ya indexada (idempotente: si ya existe, no
/// vuelve a descargar).
async fn download(
    State(state): State<AppState>,
    Path(video_id): Path<String>,
    Query(params): Query<TokenParams>,
    headers: HeaderMap,
    Json(track): Json<Track>,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }
    if !valid_video_id(&video_id) {
        return error(StatusCode::BAD_REQUEST, "videoId inválido");
    }

    let Some(store) = state.offline.clone() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Las descargas no están disponibles en este modo",
        );
    };

    if let Some(existing) = store.find(&video_id) {
        return Json(existing).into_response();
    }

    {
        let Ok(mut guard) = state.downloading.lock() else {
            return error(StatusCode::INTERNAL_SERVER_ERROR, "Estado de descargas bloqueado");
        };
        if !guard.insert(video_id.clone()) {
            return error(StatusCode::CONFLICT, "Esta canción ya se está descargando");
        }
    }

    let result = perform_download(&state, &store, &video_id, track).await;

    if let Ok(mut guard) = state.downloading.lock() {
        guard.remove(&video_id);
    }

    match result {
        Ok(entry) => Json(entry).into_response(),
        Err(err) => error(StatusCode::BAD_GATEWAY, err),
    }
}

async fn perform_download(
    state: &AppState,
    store: &OfflineStore,
    video_id: &str,
    mut track: Track,
) -> Result<OfflineTrack, String> {
    let resolved = state.resolve_cached(video_id).await?;

    // googlevideo limita a ~36 KB/s las peticiones sin rango (su modo
    // "adaptive"). Pidiendo `bytes=0-` responde 206 y entrega el archivo a
    // velocidad completa, la misma vía que usa el `<audio>` al reproducir.
    let mut request = state
        .http
        .get(resolved.url.as_str())
        .header(header::REFERER, "https://www.youtube.com/")
        .header(header::RANGE, "bytes=0-");

    for (name, value) in &resolved.headers {
        let (Ok(name), Ok(value)) = (name.parse::<HeaderName>(), HeaderValue::from_str(value))
        else {
            continue;
        };
        request = request.header(name, value);
    }

    let mut response = request
        .send()
        .await
        .map_err(|e| format!("No se pudo iniciar la descarga: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("El CDN respondió HTTP {status} al descargar"));
    }

    // Si el CDN responde 206, `Content-Range` dice el tamaño total; sirve para
    // detectar descargas cortadas antes de indexarlas como válidas.
    let expected_total = response
        .headers()
        .get(header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit('/').next())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|total| *total > 0);

    let mime_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| resolved.content_type.clone());

    let file_name = format!("{video_id}.{}", extension_for(&mime_type));
    let final_path = store.dir.join(&file_name);
    let temp_path = store.dir.join(format!("{video_id}.part"));

    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|e| format!("No se pudo crear el archivo de descarga: {e}"))?;

    let mut size: u64 = 0;

    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if let Err(err) = file.write_all(&chunk).await {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    return Err(format!("No se pudo escribir la descarga: {err}"));
                }
                size += chunk.len() as u64;
            }
            Ok(None) => break,
            Err(err) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Err(format!("Descarga interrumpida: {err}"));
            }
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("No se pudo cerrar la descarga: {e}"))?;
    drop(file);

    if size == 0 {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err("La descarga llegó vacía".to_string());
    }

    if let Some(total) = expected_total {
        if size != total {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(format!(
                "La descarga quedó incompleta ({size} de {total} bytes)"
            ));
        }
    }

    tokio::fs::rename(&temp_path, &final_path)
        .await
        .map_err(|e| format!("No se pudo guardar la descarga: {e}"))?;

    track.video_id = video_id.to_string();

    let entry = OfflineTrack {
        video_id: video_id.to_string(),
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration_sec: track.duration_sec,
        thumbnail_url: track.thumbnail_url,
        file_name,
        mime_type,
        size_bytes: size,
        downloaded_at: now_secs(),
    };

    store.insert(entry.clone())?;
    Ok(entry)
}

/// `GET /offline`: canciones descargadas, más recientes primero.
async fn list_offline(
    State(state): State<AppState>,
    Query(params): Query<TokenParams>,
    headers: HeaderMap,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }

    let Some(store) = state.offline.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Las descargas no están disponibles en este modo",
        );
    };

    Json(store.list()).into_response()
}

/// `GET /offline/{videoId}`: sirve el archivo local con soporte de `Range`, que
/// es lo que el `<audio>` usa para buscar dentro de la canción.
async fn offline_stream(
    State(state): State<AppState>,
    Path(video_id): Path<String>,
    Query(params): Query<TokenParams>,
    headers: HeaderMap,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }
    if !valid_video_id(&video_id) {
        return error(StatusCode::BAD_REQUEST, "videoId inválido");
    }

    let Some(store) = state.offline.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Las descargas no están disponibles en este modo",
        );
    };

    let Some(entry) = store.find(&video_id) else {
        return error(StatusCode::NOT_FOUND, "Esa canción no está descargada");
    };

    // El `<audio>` pide por `Range`; se lee solo esa ventana del archivo en vez
    // de cargar la canción entera en memoria en cada petición.
    let path = store.path_of(&entry);
    let total = match tokio::fs::metadata(&path).await {
        Ok(meta) if meta.len() > 0 => meta.len(),
        _ => {
            // Índice huérfano (archivo borrado desde fuera): se limpia.
            let _ = store.remove(&video_id);
            return error(StatusCode::NOT_FOUND, "El archivo descargado no existe");
        }
    };

    let mut response = if let Some(raw) = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
    {
        let Some((start, end)) = parse_range(raw, total) else {
            return error(StatusCode::RANGE_NOT_SATISFIABLE, "Rango no válido");
        };

        let bytes = match read_range(&path, start, end).await {
            Ok(bytes) => bytes,
            Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, err),
        };

        let mut response = Response::new(Body::from(bytes));
        *response.status_mut() = StatusCode::PARTIAL_CONTENT;
        if let Ok(value) = HeaderValue::from_str(&format!("bytes {start}-{end}/{total}")) {
            response.headers_mut().insert(header::CONTENT_RANGE, value);
        }
        response
    } else {
        match tokio::fs::read(&path).await {
            Ok(bytes) if !bytes.is_empty() => Response::new(Body::from(bytes)),
            _ => return error(StatusCode::NOT_FOUND, "El archivo descargado no existe"),
        }
    };

    if let Ok(value) = HeaderValue::from_str(&entry.mime_type) {
        response.headers_mut().insert(header::CONTENT_TYPE, value);
    }
    response
        .headers_mut()
        .insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// `DELETE /offline/{videoId}`: borra el archivo y su entrada del índice.
async fn delete_offline(
    State(state): State<AppState>,
    Path(video_id): Path<String>,
    Query(params): Query<TokenParams>,
    headers: HeaderMap,
) -> Response {
    if !state.authorized(&headers, params.t.as_deref()) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido");
    }
    if !valid_video_id(&video_id) {
        return error(StatusCode::BAD_REQUEST, "videoId inválido");
    }

    let Some(store) = state.offline.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Las descargas no están disponibles en este modo",
        );
    };

    match store.remove(&video_id) {
        Ok(Some(entry)) => {
            let _ = tokio::fs::remove_file(store.path_of(&entry)).await;
            Json(json!({ "ok": true })).into_response()
        }
        Ok(None) => error(StatusCode::NOT_FOUND, "Esa canción no está descargada"),
        Err(err) => error(StatusCode::INTERNAL_SERVER_ERROR, err),
    }
}

/// Lee `[start, end]` (ambos inclusive) de un archivo local sin cargarlo entero.
async fn read_range(path: &std::path::Path, start: u64, end: u64) -> Result<Vec<u8>, String> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("No se pudo abrir la descarga: {e}"))?;

    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|e| format!("No se pudo posicionar en la descarga: {e}"))?;

    let len = (end - start + 1) as usize;
    let mut buffer = vec![0u8; len];
    file.read_exact(&mut buffer)
        .await
        .map_err(|e| format!("No se pudo leer la descarga: {e}"))?;

    Ok(buffer)
}

/// `bytes=inicio-fin`, con `fin` opcional. Los reproductores de audio piden
/// este formato; los rangos con sufijo (`-500`) no hacen falta aquí.
fn parse_range(raw: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }
    let spec = raw.trim().strip_prefix("bytes=")?;
    let (start_raw, end_raw) = spec.split_once('-')?;
    if start_raw.trim().is_empty() {
        return None;
    }
    let start = start_raw.trim().parse::<u64>().ok()?;
    if start >= total {
        return None;
    }
    let end = if end_raw.trim().is_empty() {
        total - 1
    } else {
        end_raw.trim().parse::<u64>().ok()?.min(total - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

fn extension_for(mime_type: &str) -> &'static str {
    if mime_type.contains("webm") {
        "webm"
    } else if mime_type.contains("mp4") || mime_type.contains("m4a") || mime_type.contains("aac") {
        "m4a"
    } else if mime_type.contains("mpeg") || mime_type.contains("mp3") {
        "mp3"
    } else {
        "bin"
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

/// 128 bits de entropía sin dependencias extra. `RandomState` se siembra de
/// forma aleatoria por proceso, así que dos hashers dan un token imprevisible.
fn random_token() -> String {
    use std::hash::{BuildHasher, Hasher};

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let mut first = std::collections::hash_map::RandomState::new().build_hasher();
    first.write_u128(nanos);
    first.write_u32(std::process::id());

    let mut second = std::collections::hash_map::RandomState::new().build_hasher();
    second.write_u64(nanos as u64);
    second.write_u64((nanos >> 64) as u64);

    format!("{:016x}{:016x}", first.finish(), second.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_real_style_video_ids() {
        assert!(valid_video_id("dQw4w9WgXcQ"));
        assert!(!valid_video_id("short"));
        assert!(!valid_video_id("../etc/passwd"));
        assert!(!valid_video_id("dQw4w9WgXc "));
    }

    #[test]
    fn tokens_are_unique_enough() {
        let a = random_token();
        let b = random_token();
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
    }

    #[test]
    fn parses_byte_ranges_for_audio() {
        assert_eq!(parse_range("bytes=0-1023", 4096), Some((0, 1023)));
        assert_eq!(parse_range("bytes=1024-", 4096), Some((1024, 4095)));
        assert_eq!(parse_range("bytes=4000-9999", 4096), Some((4000, 4095)));
        assert_eq!(parse_range("bytes=4096-", 4096), None);
        assert_eq!(parse_range("bytes=-500", 4096), None);
        assert_eq!(parse_range("items=0-10", 4096), None);
        assert_eq!(parse_range("bytes=0-10", 0), None);
    }

    #[test]
    fn picks_extension_from_mime() {
        assert_eq!(extension_for("audio/webm"), "webm");
        assert_eq!(extension_for("audio/mp4"), "m4a");
        assert_eq!(extension_for("audio/mpeg"), "mp3");
        assert_eq!(extension_for("application/octet-stream"), "bin");
    }

    #[tokio::test]
    async fn reads_local_ranges_without_loading_the_whole_file() {
        let dir = std::env::temp_dir().join(format!("pocketpod-test-{}", random_token()));
        std::fs::create_dir_all(&dir).expect("carpeta temporal");
        let path = dir.join("sample.webm");
        std::fs::write(&path, b"0123456789").expect("archivo de prueba");

        assert_eq!(read_range(&path, 0, 3).await.unwrap(), b"0123");
        assert_eq!(read_range(&path, 8, 9).await.unwrap(), b"89");
        // Pedir más bytes de los que hay debe fallar, no devolver basura.
        assert!(read_range(&path, 5, 99).await.is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
