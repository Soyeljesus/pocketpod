//! Importa playlists públicas de otros servicios.
//!
//! Solo se leen datos públicos (título, artista y duración). Cada canción se
//! busca después en YouTube Music, que es de donde sale el audio.

use std::collections::HashSet;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use reqwest::redirect::Policy;
use reqwest::Url;
use serde_json::Value;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use super::{ImportedPlaylist, MusicEngine, Track};

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const MAX_EXTERNAL_TRACKS: usize = 1000;
const MAX_DEEZER_PAGES: usize = 25;
const MATCH_CONCURRENCY: usize = 6;
const UNREADABLE: &str = "No se pudieron leer las canciones de ese enlace. Comprueba que la playlist sea pública.";

#[derive(Debug, Clone, PartialEq)]
pub(super) struct ExternalTrack {
    pub(super) title: String,
    pub(super) artist: String,
    pub(super) duration_sec: f64,
}

#[derive(Debug)]
struct ExternalPlaylist {
    id: String,
    title: String,
    source: String,
    tracks: Vec<ExternalTrack>,
}

/// Devuelve la URL si el texto apunta a un servicio distinto de YouTube.
pub fn external_url(input: &str) -> Option<Url> {
    let token = input
        .split_whitespace()
        .find(|part| {
            let lower = part.to_lowercase();
            lower.starts_with("https://")
                || lower.starts_with("http://")
                || lower.starts_with("www.")
                || lower.starts_with("open.spotify.com/")
                || lower.starts_with("music.apple.com/")
                || lower.starts_with("deezer.com/")
        })?
        .trim_end_matches(['.', ',', ')', ']']);

    let text = if token.contains("://") {
        token.to_string()
    } else {
        format!("https://{token}")
    };
    let url = Url::parse(&text).ok()?;
    let host = url.host_str()?.to_lowercase();
    let youtube = host == "youtu.be"
        || host == "youtube.com"
        || host.ends_with(".youtube.com")
        || host == "youtube-nocookie.com";
    (!youtube).then_some(url)
}

pub async fn import_url(
    engine: &Arc<dyn MusicEngine>,
    url: Url,
) -> Result<ImportedPlaylist, String> {
    let http = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| format!("No se pudo preparar la importación: {e}"))?;

    let external = read_external(&http, url).await?;
    let total = external.tracks.len();
    let tracks = match_tracks(engine, external.tracks).await;
    if tracks.is_empty() {
        return Err("No se encontró ninguna de esas canciones en YouTube Music".to_string());
    }

    Ok(ImportedPlaylist {
        id: external.id,
        title: external.title,
        skipped: total.saturating_sub(tracks.len()),
        source: external.source,
        tracks,
    })
}

async fn read_external(http: &reqwest::Client, url: Url) -> Result<ExternalPlaylist, String> {
    let host = host_of(&url);

    if host == "spotify.link" || host == "spoti.fi" {
        let (final_url, body) = fetch(http, url).await?;
        let target = spotify_target(&final_url)
            .or_else(|| spotify_target_in_text(&body))
            .ok_or_else(|| UNREADABLE.to_string())?;
        return read_spotify(http, target).await;
    }
    if host == "spotify.com" || host.ends_with(".spotify.com") {
        let target = spotify_target(&url).ok_or_else(|| {
            "Pega el enlace de una playlist o un álbum de Spotify".to_string()
        })?;
        return read_spotify(http, target).await;
    }
    if host == "link.deezer.com" || host == "deezer.page.link" {
        let (final_url, _) = fetch(http, url).await?;
        let target = deezer_target(&final_url).ok_or_else(|| UNREADABLE.to_string())?;
        return read_deezer(http, target).await;
    }
    if host == "deezer.com" || host.ends_with(".deezer.com") {
        let target = deezer_target(&url)
            .ok_or_else(|| "Pega el enlace de una playlist o un álbum de Deezer".to_string())?;
        return read_deezer(http, target).await;
    }

    let (final_url, html) = fetch(http, url).await?;
    let source = source_name(&host_of(&final_url));
    let id = format!("web:{:016x}", stable_hash(final_url.as_str()));
    playlist_from_html(&html, id, source)
}

async fn read_spotify(
    http: &reqwest::Client,
    (kind, id): (String, String),
) -> Result<ExternalPlaylist, String> {
    let url = Url::parse(&format!("https://open.spotify.com/embed/{kind}/{id}"))
        .map_err(|e| e.to_string())?;
    let (_, html) = fetch(http, url).await?;
    playlist_from_html(&html, format!("spotify:{kind}:{id}"), "Spotify".to_string())
}

fn spotify_target(url: &Url) -> Option<(String, String)> {
    if !host_of(url).ends_with("spotify.com") {
        return None;
    }
    let parts: Vec<&str> = url.path_segments()?.filter(|p| !p.is_empty()).collect();
    parts.windows(2).find_map(|pair| {
        let valid = matches!(pair[0], "playlist" | "album")
            && pair[1].len() >= 10
            && pair[1].chars().all(|c| c.is_ascii_alphanumeric());
        valid.then(|| (pair[0].to_string(), pair[1].to_string()))
    })
}

fn spotify_target_in_text(text: &str) -> Option<(String, String)> {
    text.match_indices("open.spotify.com/").find_map(|(index, _)| {
        let tail: String = text[index..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || "./-_".contains(*c))
            .collect();
        spotify_target(&Url::parse(&format!("https://{tail}")).ok()?)
    })
}

fn deezer_target(url: &Url) -> Option<(String, String)> {
    if !host_of(url).ends_with("deezer.com") {
        return None;
    }
    let parts: Vec<&str> = url.path_segments()?.filter(|p| !p.is_empty()).collect();
    parts.windows(2).find_map(|pair| {
        let valid = matches!(pair[0], "playlist" | "album")
            && !pair[1].is_empty()
            && pair[1].chars().all(|c| c.is_ascii_digit());
        valid.then(|| (pair[0].to_string(), pair[1].to_string()))
    })
}

async fn read_deezer(
    http: &reqwest::Client,
    (kind, id): (String, String),
) -> Result<ExternalPlaylist, String> {
    let url = Url::parse(&format!("https://api.deezer.com/{kind}/{id}"))
        .map_err(|e| e.to_string())?;
    let (_, body) = fetch(http, url).await?;
    let value: Value = serde_json::from_str(&body).map_err(|_| UNREADABLE.to_string())?;
    if value.get("error").is_some() {
        return Err(UNREADABLE.to_string());
    }

    let title = text_field(&value, &["title"]).unwrap_or_else(|| "Playlist de Deezer".to_string());
    let mut tracks = deezer_tracks(value.pointer("/tracks/data"));
    let mut next = value.pointer("/tracks/next").and_then(Value::as_str).map(str::to_string);
    let mut pages = 0;

    while let Some(link) = next {
        if pages >= MAX_DEEZER_PAGES || tracks.len() >= MAX_EXTERNAL_TRACKS {
            break;
        }
        pages += 1;
        let page_url = Url::parse(&link).map_err(|_| UNREADABLE.to_string())?;
        if host_of(&page_url) != "api.deezer.com" {
            break;
        }
        let (_, body) = fetch(http, page_url).await?;
        let page: Value = serde_json::from_str(&body).map_err(|_| UNREADABLE.to_string())?;
        tracks.extend(deezer_tracks(page.get("data")));
        next = page.get("next").and_then(Value::as_str).map(str::to_string);
    }

    finish_playlist(format!("deezer:{kind}:{id}"), title, "Deezer".to_string(), tracks)
}

fn deezer_tracks(data: Option<&Value>) -> Vec<ExternalTrack> {
    data.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(ExternalTrack {
                title: text_field(item, &["title"])?,
                artist: item.pointer("/artist/name")?.as_str()?.trim().to_string(),
                duration_sec: item.get("duration").and_then(Value::as_f64).unwrap_or(0.0),
            })
        })
        .collect()
}

fn finish_playlist(
    id: String,
    title: String,
    source: String,
    mut tracks: Vec<ExternalTrack>,
) -> Result<ExternalPlaylist, String> {
    tracks.truncate(MAX_EXTERNAL_TRACKS);
    if tracks.is_empty() {
        return Err(UNREADABLE.to_string());
    }
    Ok(ExternalPlaylist { id, title, source, tracks })
}

fn host_of(url: &Url) -> String {
    url.host_str()
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_lowercase()
}

fn source_name(host: &str) -> String {
    if host.ends_with("music.apple.com") {
        "Apple Music".to_string()
    } else if host.ends_with("soundcloud.com") {
        "SoundCloud".to_string()
    } else if host.ends_with("tidal.com") {
        "TIDAL".to_string()
    } else if host.contains("amazon.") {
        "Amazon Music".to_string()
    } else {
        host.to_string()
    }
}

fn stable_hash(text: &str) -> u64 {
    text.bytes().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    })
}

/// Descarga una página pública. Cada salto se valida para que un enlace no
/// pueda dirigir la app hacia el equipo o la red local.
async fn fetch(http: &reqwest::Client, start: Url) -> Result<(Url, String), String> {
    let mut url = start;

    for _ in 0..=MAX_REDIRECTS {
        ensure_public(&url).await?;
        let mut response = http
            .get(url.clone())
            .send()
            .await
            .map_err(|e| format!("No se pudo abrir el enlace: {e}"))?;

        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| UNREADABLE.to_string())?;
            url = url.join(location).map_err(|_| UNREADABLE.to_string())?;
            continue;
        }
        if !response.status().is_success() {
            return Err(UNREADABLE.to_string());
        }

        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("No se pudo leer el enlace: {e}"))?
        {
            if body.len() + chunk.len() > MAX_BODY_BYTES {
                return Err("La página del enlace es demasiado grande".to_string());
            }
            body.extend_from_slice(&chunk);
        }
        return Ok((url, String::from_utf8_lossy(&body).into_owned()));
    }

    Err("El enlace redirige demasiadas veces".to_string())
}

async fn ensure_public(url: &Url) -> Result<(), String> {
    const BLOCKED: &str = "Ese enlace no apunta a una página pública";

    if url.scheme() != "https" {
        return Err("El enlace debe empezar por https://".to_string());
    }
    let host = url.host_str().ok_or(BLOCKED)?;
    let lower = host.to_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") || lower.ends_with(".local") {
        return Err(BLOCKED.to_string());
    }

    let addresses = tokio::net::lookup_host((host, url.port_or_known_default().unwrap_or(443)))
        .await
        .map_err(|_| "No se encontró la página del enlace".to_string())?;
    let mut any = false;
    for address in addresses {
        any = true;
        if !is_public_ip(address.ip()) {
            return Err(BLOCKED.to_string());
        }
    }
    if any { Ok(()) } else { Err(BLOCKED.to_string()) }
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, ..] = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.is_unspecified()
                || ip.is_multicast()
                || a == 0
                || a >= 240
                || (a == 100 && (64..128).contains(&b)))
        }
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(mapped));
            }
            let first = ip.segments()[0];
            !(ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80)
        }
    }
}

fn playlist_from_html(html: &str, id: String, source: String) -> Result<ExternalPlaylist, String> {
    let mut best: Option<(Vec<ExternalTrack>, Option<String>)> = None;
    let mut named = None;

    for body in script_bodies(html) {
        let Some(value) = parse_script_json(body) else {
            continue;
        };
        if named.is_none() {
            named = schema_name(&value);
        }
        collect_tracks(&value, None, &mut best);
    }

    let (tracks, parent_title) = best.ok_or_else(|| UNREADABLE.to_string())?;
    let title = parent_title
        .or(named)
        .or_else(|| meta_title(html))
        .unwrap_or_else(|| format!("Playlist de {source}"));
    finish_playlist(id, title, source, tracks)
}

fn script_bodies(html: &str) -> Vec<&str> {
    let mut bodies = Vec::new();
    let mut rest = html;
    while let Some(start) = rest.find("<script") {
        let after = &rest[start..];
        let Some(open_end) = after.find('>') else {
            break;
        };
        let content = &after[open_end + 1..];
        let Some(close) = content.find("</script") else {
            break;
        };
        bodies.push(content[..close].trim());
        rest = &content[close..];
    }
    bodies
}

fn parse_script_json(body: &str) -> Option<Value> {
    let json = if body.starts_with('{') || body.starts_with('[') {
        body
    } else {
        let (_, value) = body.split_once('=')?;
        let value = value.trim();
        if !(value.starts_with('{') || value.starts_with('[')) {
            return None;
        }
        value
    };
    serde_json::from_str(json.trim_end_matches(';').trim_end()).ok()
}

fn schema_name(value: &Value) -> Option<String> {
    let kind = value.get("@type")?.as_str()?;
    matches!(kind, "MusicPlaylist" | "MusicAlbum")
        .then(|| text_field(value, &["name"]))
        .flatten()
}

pub(super) fn collect_tracks(
    value: &Value,
    parent_title: Option<String>,
    best: &mut Option<(Vec<ExternalTrack>, Option<String>)>,
) {
    match value {
        Value::Object(map) => {
            let title = text_field(value, &["name", "title"]);
            for child in map.values() {
                collect_tracks(child, title.clone(), best);
            }
        }
        Value::Array(items) => {
            let tracks: Vec<ExternalTrack> = items.iter().filter_map(track_from_json).collect();
            let enough = !tracks.is_empty() && tracks.len() * 5 >= items.len() * 3;
            let better = best.as_ref().is_none_or(|(list, _)| tracks.len() > list.len());
            if enough && better {
                *best = Some((tracks, parent_title));
            }
            for child in items {
                collect_tracks(child, None, best);
            }
        }
        _ => {}
    }
}

pub(super) fn track_from_json(item: &Value) -> Option<ExternalTrack> {
    item.as_object()?;
    let item = item.get("track").filter(|track| track.is_object()).unwrap_or(item);
    for key in ["entityType", "type", "kind", "@type"] {
        if let Some(kind) = item.get(key).and_then(Value::as_str) {
            let kind = kind.to_lowercase();
            if ["episode", "podcast", "audiobook", "chapter"]
                .iter()
                .any(|word| kind.contains(word))
            {
                return None;
            }
        }
    }

    Some(ExternalTrack {
        title: text_field(item, &["title", "name", "trackName", "songName", "track"])?,
        artist: artist_from_json(item)?,
        duration_sec: duration_from_json(item),
    })
}

pub(super) fn text_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)?
            .as_str()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    })
}

fn names_of(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.trim().to_string()).filter(|text| !text.is_empty()),
        Value::Object(_) => text_field(value, &["name", "title", "username"]),
        Value::Array(items) => {
            let names: Vec<String> = items.iter().filter_map(names_of).collect();
            (!names.is_empty()).then(|| names.join(", "))
        }
        _ => None,
    }
}

fn artist_from_json(item: &Value) -> Option<String> {
    ["artistName", "artists", "artist", "byArtist", "performer", "subtitle", "user"]
        .iter()
        .find_map(|key| names_of(item.get(*key)?))
}

fn duration_from_json(item: &Value) -> f64 {
    ["duration", "durationInMillis", "durationMs", "duration_ms", "full_duration"]
        .iter()
        .find_map(|key| {
            let value = item.get(*key)?;
            if let Some(number) = value.as_f64() {
                return Some(if number >= 10_000.0 { number / 1000.0 } else { number });
            }
            parse_iso_duration(value.as_str()?)
        })
        .unwrap_or(0.0)
}

pub(super) fn parse_iso_duration(text: &str) -> Option<f64> {
    let rest = text.strip_prefix("PT")?;
    let mut total = 0.0;
    let mut number = String::new();
    for character in rest.chars() {
        match character {
            'H' | 'M' | 'S' => {
                let value: f64 = number.parse().ok()?;
                number.clear();
                total += value
                    * match character {
                        'H' => 3600.0,
                        'M' => 60.0,
                        _ => 1.0,
                    };
            }
            _ => number.push(character),
        }
    }
    Some(total)
}

fn meta_title(html: &str) -> Option<String> {
    let index = html.find("property=\"og:title\"")?;
    let tag_start = html[..index].rfind('<')?;
    let tag = &html[tag_start..tag_start + html[tag_start..].find('>')?];
    let (_, tail) = tag.split_once("content=\"")?;
    let (content, _) = tail.split_once('"')?;
    let clean = content
        .replace("&amp;", "&")
        .replace("&#39;", "'")
        .replace("&quot;", "\"");
    let clean = clean.split(" | ").next()?.trim().to_string();
    (!clean.is_empty()).then_some(clean)
}

async fn match_tracks(
    engine: &Arc<dyn MusicEngine>,
    tracks: Vec<ExternalTrack>,
) -> Vec<Track> {
    let mut seen = HashSet::new();
    match_each(engine, tracks)
        .await
        .into_iter()
        .flatten()
        .filter(|track| seen.insert(track.video_id.clone()))
        .collect()
}

/// Busca cada canción y conserva su posición; `None` si no hubo coincidencia.
pub(super) async fn match_each(
    engine: &Arc<dyn MusicEngine>,
    tracks: Vec<ExternalTrack>,
) -> Vec<Option<Track>> {
    let total = tracks.len();
    let semaphore = Arc::new(Semaphore::new(MATCH_CONCURRENCY));
    let mut tasks = JoinSet::new();

    for (index, track) in tracks.into_iter().enumerate() {
        let engine = Arc::clone(engine);
        let semaphore = Arc::clone(&semaphore);
        tasks.spawn(async move {
            let _permit = semaphore.acquire_owned().await.ok()?;
            let artist = first_artist(&track.artist);
            let query = format!("{} {artist}", clean_title(&track.title));
            let candidates = engine.search(query.trim(), 6).await.ok()?;
            best_match(&track, candidates).map(|found| (index, found))
        });
    }

    let mut found = vec![None; total];
    while let Some(result) = tasks.join_next().await {
        if let Ok(Some((index, track))) = result {
            found[index] = Some(track);
        }
    }
    found
}

fn first_artist(artists: &str) -> &str {
    artists
        .split([',', '&', ';'])
        .next()
        .unwrap_or(artists)
        .trim()
}

fn clean_title(title: &str) -> String {
    let mut clean = String::new();
    let mut depth = 0usize;
    for character in title.split(" - ").next().unwrap_or(title).chars() {
        match character {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth == 0 => clean.push(character),
            _ => {}
        }
    }
    let clean = clean.trim();
    if clean.is_empty() { title.trim().to_string() } else { clean.to_string() }
}

pub(super) fn tokens(text: &str) -> Vec<String> {
    let folded: String = text
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' | 'ã' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        })
        .collect();
    folded.split_whitespace().map(str::to_string).collect()
}

fn overlap(wanted: &[String], available: &[String]) -> f64 {
    if wanted.is_empty() {
        return 0.0;
    }
    let hits = wanted.iter().filter(|word| available.contains(word)).count();
    hits as f64 / wanted.len() as f64
}

/// Evita elegir una demo, un directo o un remix si no es lo que se pidió.
fn has_unwanted_version(wanted: &str, candidate: &str) -> bool {
    const VERSIONS: [&str; 14] = [
        "demo", "acoustic", "acustico", "acustica", "live", "directo", "vivo", "remix",
        "instrumental", "karaoke", "drumless", "slowed", "sped", "cover",
    ];
    let wanted = tokens(wanted);
    let candidate = tokens(candidate);
    VERSIONS.iter().any(|word| {
        candidate.iter().any(|token| token == word) && !wanted.iter().any(|token| token == word)
    })
}

fn best_match(wanted: &ExternalTrack, candidates: Vec<Track>) -> Option<Track> {
    let title = tokens(&clean_title(&wanted.title));
    let artists: Vec<Vec<String>> = wanted
        .artist
        .split([',', '&', ';'])
        .map(tokens)
        .filter(|words| !words.is_empty())
        .collect();

    candidates
        .into_iter()
        .filter_map(|candidate| {
            let candidate_title = tokens(&clean_title(&candidate.title));
            let title_score = overlap(&title, &candidate_title) * 0.8
                + overlap(&candidate_title, &title) * 0.2;
            let credits = tokens(&format!("{} {}", candidate.artist, candidate.title));
            let artist_score = artists
                .iter()
                .map(|artist| overlap(artist, &credits))
                .fold(0.0, f64::max);
            let difference = (candidate.duration_sec - wanted.duration_sec).abs();
            let known = candidate.duration_sec > 0.0 && wanted.duration_sec > 0.0;
            let same_length = known && difference <= 5.0;

            let accepted = title_score >= 0.6
                && (artist_score >= 0.5
                    || ((same_length || artists.is_empty()) && title_score >= 0.9));
            if !accepted || (known && difference > 120.0) {
                return None;
            }

            let length_score = if !known {
                0.5
            } else {
                (1.0 - difference / 60.0).max(0.0)
            };
            let version_penalty = if has_unwanted_version(&wanted.title, &candidate.title) {
                0.35
            } else {
                0.0
            };
            let score =
                title_score * 0.55 + artist_score * 0.3 + length_score * 0.15 - version_penalty;
            Some((score, candidate))
        })
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, candidate)| candidate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn candidate(id: &str, title: &str, artist: &str, duration_sec: f64) -> Track {
        Track {
            video_id: id.to_string(),
            title: title.to_string(),
            artist: artist.to_string(),
            album: String::new(),
            duration_sec,
            thumbnail_url: None,
        }
    }

    #[test]
    fn recognizes_external_links_only() {
        assert!(external_url("https://open.spotify.com/playlist/abc?si=1").is_some());
        assert!(external_url("Mira esto https://music.apple.com/us/playlist/a/pl.1").is_some());
        assert!(external_url("open.spotify.com/playlist/abc").is_some());
        assert!(external_url("https://music.youtube.com/playlist?list=PL1").is_none());
        assert!(external_url("Mi lista para correr").is_none());
    }

    #[test]
    fn reads_spotify_links_with_language_prefix() {
        let url = Url::parse("https://open.spotify.com/intl-es/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x").unwrap();
        assert_eq!(
            spotify_target(&url),
            Some(("playlist".to_string(), "37i9dQZF1DXcBWIGoYBM5M".to_string()))
        );
    }

    #[test]
    fn reads_tracks_from_embedded_page_data() {
        let data = json!({ "props": { "entity": {
            "name": "Mi lista",
            "trackList": [
                { "title": "Uno", "subtitle": "Banda", "duration": 200000, "entityType": "track" },
                { "title": "Dos", "subtitle": "Otra", "duration": 180000, "entityType": "track" },
                { "title": "Charla", "subtitle": "Radio", "entityType": "episode" }
            ]
        }}});
        let html = format!("<html><script id=\"d\" type=\"application/json\">{data}</script></html>");
        let playlist = playlist_from_html(&html, "x".into(), "Spotify".into()).unwrap();
        assert_eq!(playlist.title, "Mi lista");
        assert_eq!(playlist.tracks.len(), 2);
        assert_eq!(playlist.tracks[0].duration_sec, 200.0);
    }

    #[test]
    fn matches_the_right_song_and_rejects_others() {
        let wanted = ExternalTrack {
            title: "De Música Ligera - Remasterizado".to_string(),
            artist: "Soda Stereo".to_string(),
            duration_sec: 211.0,
        };
        let found = best_match(
            &wanted,
            vec![
                candidate("cover", "De Música Ligera", "Otra Banda", 300.0),
                candidate("right", "De Musica Ligera", "Soda Stereo", 212.0),
            ],
        );
        assert_eq!(found.unwrap().video_id, "right");
        assert!(best_match(&wanted, vec![candidate("no", "Persiana Americana", "Soda Stereo", 211.0)]).is_none());
    }

    #[test]
    fn prefers_the_original_over_alternate_versions() {
        let wanted = ExternalTrack {
            title: "Give Life Back to Music".to_string(),
            artist: "Daft Punk".to_string(),
            duration_sec: 274.0,
        };
        let found = best_match(
            &wanted,
            vec![
                candidate("alt", "Give Life Back to Music (Drumless Edition)", "Daft Punk", 274.0),
                candidate("right", "Give Life Back to Music", "Daft Punk", 275.0),
            ],
        );
        assert_eq!(found.unwrap().video_id, "right");
    }

    #[test]
    fn blocks_private_addresses() {
        for address in ["127.0.0.1", "10.0.0.1", "192.168.1.5", "169.254.169.254", "::1", "fd00::1"] {
            assert!(!is_public_ip(address.parse().unwrap()), "{address}");
        }
        assert!(is_public_ip("1.1.1.1".parse().unwrap()));
    }

    #[test]
    fn parses_iso_durations() {
        assert_eq!(parse_iso_duration("PT3M28S"), Some(208.0));
        assert_eq!(parse_iso_duration("PT1H0M1S"), Some(3601.0));
    }
}
