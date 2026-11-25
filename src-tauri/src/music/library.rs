//! Exporta e importa la biblioteca como archivo.
//!
//! El formato propio es CSV: se abre en cualquier hoja de cálculo y conserva
//! los identificadores para restaurar sin volver a buscar. Al importar también
//! se aceptan CSV/TSV de otras apps, M3U/M3U8, XSPF, JSON y listas de texto.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::importers::{
    collect_tracks, match_each, text_field, tokens, track_from_json, ExternalTrack,
};
use super::{MusicEngine, Track};

const HEADER: [&str; 11] = [
    "Type",
    "Playlist",
    "Title",
    "Artist",
    "Album",
    "DurationSeconds",
    "VideoId",
    "Thumbnail",
    "PlaylistId",
    "PlaylistSource",
    "PlaylistLink",
];
const MAX_ROWS: usize = 20_000;
const MAX_SEARCHES: usize = 2_000;
const NOT_RECOGNIZED: &str =
    "No se reconocieron canciones en ese archivo. Usa CSV, M3U, XSPF, JSON o TXT.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlaylist {
    pub id: String,
    pub title: String,
    pub source: String,
    pub source_link: Option<String>,
    pub tracks: Vec<Track>,
}

#[derive(Debug, Deserialize)]
pub struct ExportRequest {
    pub playlists: Vec<ExportPlaylist>,
    pub likes: Vec<Track>,
    pub downloads: Vec<Track>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub file_name: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedCollection {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub source: String,
    pub source_link: Option<String>,
    pub tracks: Vec<Track>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub collections: Vec<ImportedCollection>,
    pub imported: usize,
    pub skipped: usize,
}

#[derive(Debug, Default, Clone)]
struct Row {
    title: String,
    artist: String,
    album: String,
    duration_sec: f64,
    video_id: String,
    thumbnail: String,
}

#[derive(Debug, Default)]
struct Collection {
    id: String,
    name: String,
    kind: String,
    source: String,
    source_link: Option<String>,
    rows: Vec<Row>,
}

pub fn export_csv(request: &ExportRequest) -> String {
    let mut output = String::from("\u{feff}");
    push_record(&mut output, &HEADER);

    for track in &request.likes {
        push_track(&mut output, "like", "Me gusta", track, "", "", "");
    }
    for track in &request.downloads {
        push_track(&mut output, "download", "Descargadas", track, "", "", "");
    }
    for playlist in &request.playlists {
        let link = playlist.source_link.as_deref().unwrap_or_default();
        if playlist.tracks.is_empty() {
            push_record(
                &mut output,
                &[
                    "playlist", &playlist.title, "", "", "", "", "", "", &playlist.id,
                    &playlist.source, link,
                ],
            );
        }
        for track in &playlist.tracks {
            push_track(
                &mut output,
                "playlist",
                &playlist.title,
                track,
                &playlist.id,
                &playlist.source,
                link,
            );
        }
    }
    output
}

fn push_track(
    output: &mut String,
    kind: &str,
    collection: &str,
    track: &Track,
    id: &str,
    source: &str,
    link: &str,
) {
    let duration = if track.duration_sec > 0.0 {
        format!("{}", track.duration_sec.round() as u64)
    } else {
        String::new()
    };
    push_record(
        output,
        &[
            kind,
            collection,
            &track.title,
            &track.artist,
            &track.album,
            &duration,
            &track.video_id,
            track.thumbnail_url.as_deref().unwrap_or_default(),
            id,
            source,
            link,
        ],
    );
}

fn push_record(output: &mut String, fields: &[&str]) {
    let line = fields
        .iter()
        .map(|field| escape_csv(field))
        .collect::<Vec<_>>()
        .join(",");
    output.push_str(&line);
    output.push_str("\r\n");
}

/// Un apóstrofo inicial evita que una hoja de cálculo ejecute títulos como
/// fórmulas; al importar se retira.
fn escape_csv(field: &str) -> String {
    let guarded = if field.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{field}")
    } else {
        field.to_string()
    };
    if guarded.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", guarded.replace('"', "\"\""))
    } else {
        guarded
    }
}

fn unguard(field: &str) -> &str {
    match field.strip_prefix('\'') {
        Some(rest) if rest.starts_with(['=', '+', '-', '@', '\t', '\r']) => rest,
        _ => field,
    }
}

pub async fn import_file(
    engine: &Arc<dyn MusicEngine>,
    request: ImportRequest,
) -> Result<ImportResult, String> {
    let collections = parse_file(&request.file_name, &request.content)?;

    let mut wanted: Vec<ExternalTrack> = Vec::new();
    let mut seen = HashMap::new();
    for row in collections.iter().flat_map(|collection| &collection.rows) {
        if row.video_id.is_empty() && !seen.contains_key(&row_key(row)) && wanted.len() < MAX_SEARCHES {
            seen.insert(row_key(row), wanted.len());
            wanted.push(ExternalTrack {
                title: row.title.clone(),
                artist: row.artist.clone(),
                duration_sec: row.duration_sec,
            });
        }
    }
    let found = match_each(engine, wanted).await;

    let mut imported = 0;
    let mut skipped = 0;
    let mut output = Vec::new();

    for collection in collections {
        let mut tracks = Vec::new();
        let mut ids = std::collections::HashSet::new();
        for row in &collection.rows {
            let track = if row.video_id.is_empty() {
                seen.get(&row_key(row))
                    .and_then(|index| found.get(*index))
                    .cloned()
                    .flatten()
            } else {
                Some(row_track(row))
            };
            match track {
                Some(track) if ids.insert(track.video_id.clone()) => {
                    imported += 1;
                    tracks.push(track);
                }
                Some(_) => {}
                None => skipped += 1,
            }
        }
        output.push(ImportedCollection {
            id: collection.id,
            name: collection.name,
            kind: collection.kind,
            source: collection.source,
            source_link: collection.source_link,
            tracks,
        });
    }

    if imported == 0 && output.iter().all(|item| item.kind == "likes") {
        return Err("No se encontró ninguna de esas canciones".to_string());
    }
    Ok(ImportResult {
        collections: output,
        imported,
        skipped,
    })
}

fn row_key(row: &Row) -> String {
    format!("{}\u{1f}{}", row.title.to_lowercase(), row.artist.to_lowercase())
}

fn row_track(row: &Row) -> Track {
    Track {
        video_id: row.video_id.clone(),
        title: row.title.clone(),
        artist: row.artist.clone(),
        album: row.album.clone(),
        duration_sec: row.duration_sec,
        thumbnail_url: if row.thumbnail.is_empty() {
            Some(format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", row.video_id))
        } else {
            Some(row.thumbnail.clone())
        },
    }
}

fn parse_file(file_name: &str, content: &str) -> Result<Vec<Collection>, String> {
    let text = content.trim_start_matches('\u{feff}').trim();
    let stem = file_stem(file_name);
    let extension = file_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_lowercase())
        .unwrap_or_default();

    let collections = if text.starts_with("#EXTM3U") || matches!(extension.as_str(), "m3u" | "m3u8") {
        parse_m3u(text, &stem)
    } else if text.contains("<trackList") || extension == "xspf" {
        parse_xspf(text, &stem)
    } else if text.starts_with('{') || text.starts_with('[') {
        parse_json(text, &stem)?
    } else if let Some(collections) = parse_table(text, &stem) {
        collections
    } else {
        parse_lines(text, &stem)
    };

    let usable: Vec<Collection> = collections
        .into_iter()
        .filter(|item| !item.rows.is_empty() || item.kind == "playlist" && !item.id.starts_with("file:"))
        .collect();
    if usable.is_empty() {
        return Err(NOT_RECOGNIZED.to_string());
    }
    Ok(usable)
}

fn file_stem(file_name: &str) -> String {
    let name = file_name.rsplit(['/', '\\']).next().unwrap_or(file_name);
    let stem = name.rsplit_once('.').map_or(name, |(stem, _)| stem).trim();
    if stem.is_empty() { "Playlist importada".to_string() } else { stem.to_string() }
}

fn new_collection(name: &str) -> Collection {
    Collection {
        id: format!("file:{}", tokens(name).join("-")),
        name: name.to_string(),
        kind: "playlist".to_string(),
        source: "Archivo".to_string(),
        source_link: None,
        rows: Vec::new(),
    }
}

fn single(name: &str, rows: Vec<Row>) -> Vec<Collection> {
    let mut collection = new_collection(name);
    collection.rows = rows;
    vec![collection]
}

fn split_artist_title(text: &str) -> Row {
    let text = text.trim();
    match text.split_once(" - ") {
        Some((artist, title)) => Row {
            title: title.trim().to_string(),
            artist: artist.trim().to_string(),
            ..Row::default()
        },
        None => Row {
            title: text.to_string(),
            ..Row::default()
        },
    }
}

fn youtube_id(text: &str) -> Option<String> {
    let tail = text
        .split_once("youtu.be/")
        .map(|(_, tail)| tail)
        .or_else(|| text.split_once("v=").map(|(_, tail)| tail))?;
    let id: String = tail
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    (id.len() == 11).then_some(id)
}

fn parse_m3u(text: &str, stem: &str) -> Vec<Collection> {
    let mut name = stem.to_string();
    let mut rows = Vec::new();
    let mut pending: Option<Row> = None;

    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if let Some(value) = line.strip_prefix("#PLAYLIST:") {
            name = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("#EXTINF:") {
            let (duration, label) = value.split_once(',').unwrap_or((value, ""));
            let mut row = split_artist_title(label);
            row.duration_sec = duration.trim().parse::<f64>().unwrap_or(0.0).max(0.0);
            pending = Some(row);
        } else if !line.starts_with('#') {
            let mut row = pending.take().unwrap_or_else(|| {
                let file = line.rsplit(['/', '\\']).next().unwrap_or(line);
                split_artist_title(file.rsplit_once('.').map_or(file, |(stem, _)| stem))
            });
            row.video_id = youtube_id(line).unwrap_or_default();
            if !row.title.is_empty() {
                rows.push(row);
            }
        }
    }
    single(&name, rows)
}

fn decode_xml(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

fn xml_value(block: &str, tag: &str) -> Option<String> {
    let (_, tail) = block.split_once(&format!("<{tag}>"))?;
    let (value, _) = tail.split_once(&format!("</{tag}>"))?;
    let value = decode_xml(value.trim());
    (!value.is_empty()).then_some(value)
}

fn parse_xspf(text: &str, stem: &str) -> Vec<Collection> {
    let header = text.split("<trackList").next().unwrap_or_default();
    let name = xml_value(header, "title").unwrap_or_else(|| stem.to_string());
    let rows = text
        .split("<track>")
        .skip(1)
        .filter_map(|block| {
            let block = block.split("</track>").next()?;
            Some(Row {
                title: xml_value(block, "title")?,
                artist: xml_value(block, "creator").unwrap_or_default(),
                album: xml_value(block, "album").unwrap_or_default(),
                duration_sec: xml_value(block, "duration")
                    .and_then(|value| value.parse::<f64>().ok())
                    .map_or(0.0, |ms| ms / 1000.0),
                video_id: xml_value(block, "location")
                    .and_then(|value| youtube_id(&value))
                    .unwrap_or_default(),
                thumbnail: String::new(),
            })
        })
        .collect();
    single(&name, rows)
}

fn external_row(track: ExternalTrack) -> Row {
    Row {
        title: track.title,
        artist: track.artist,
        duration_sec: track.duration_sec,
        ..Row::default()
    }
}

fn parse_json(text: &str, stem: &str) -> Result<Vec<Collection>, String> {
    let value: Value = serde_json::from_str(text).map_err(|_| NOT_RECOGNIZED.to_string())?;

    if let Some(playlists) = value.get("playlists").and_then(Value::as_array) {
        let collections: Vec<Collection> = playlists
            .iter()
            .filter_map(|playlist| {
                let name = text_field(playlist, &["name", "title"])?;
                let items = ["items", "tracks"]
                    .iter()
                    .find_map(|key| playlist.get(*key)?.as_array())?;
                let rows = items
                    .iter()
                    .filter_map(track_from_json)
                    .map(external_row)
                    .collect();
                let mut collection = new_collection(&name);
                collection.rows = rows;
                Some(collection)
            })
            .collect();
        if !collections.is_empty() {
            return Ok(collections);
        }
    }

    let mut best = None;
    collect_tracks(&value, None, &mut best);
    let (tracks, title) = best.ok_or_else(|| NOT_RECOGNIZED.to_string())?;
    let name = title.unwrap_or_else(|| stem.to_string());
    Ok(single(&name, tracks.into_iter().map(external_row).collect()))
}

fn parse_records(text: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();

    while let Some(character) = chars.next() {
        if quoted {
            if character == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quoted = false;
                }
            } else {
                field.push(character);
            }
        } else if character == '"' && field.is_empty() {
            quoted = true;
        } else if character == delimiter {
            record.push(std::mem::take(&mut field));
        } else if character == '\n' || character == '\r' {
            if character == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            record.push(std::mem::take(&mut field));
            if record.iter().any(|value| !value.trim().is_empty()) {
                records.push(std::mem::take(&mut record));
                if records.len() > MAX_ROWS {
                    return records;
                }
            } else {
                record.clear();
            }
        } else {
            field.push(character);
        }
    }
    record.push(field);
    if record.iter().any(|value| !value.trim().is_empty()) {
        records.push(record);
    }
    records
}

fn column(header: &[String], names: &[&str]) -> Option<usize> {
    names
        .iter()
        .find_map(|name| header.iter().position(|value| value == name))
}

/// Encabezados con otras palabras ("Nombre de la canción", "Track Title"...).
fn column_like(header: &[String], words: &[&str], avoid: &[&str]) -> Option<usize> {
    header.iter().position(|value| {
        words.iter().any(|word| value.contains(word)) && !avoid.iter().any(|word| value.contains(word))
    })
}

fn parse_duration_field(value: &str, header: &str) -> f64 {
    let value = value.trim();
    if value.contains(':') {
        return value
            .split(':')
            .try_fold(0.0, |total, part| part.trim().parse::<f64>().ok().map(|n| total * 60.0 + n))
            .unwrap_or(0.0);
    }
    let number = value.parse::<f64>().unwrap_or(0.0).max(0.0);
    if header.ends_with("ms") || number >= 10_000.0 {
        number / 1000.0
    } else {
        number
    }
}

fn parse_table(text: &str, stem: &str) -> Option<Vec<Collection>> {
    let first_line = text.lines().next()?;
    let delimiter = ['\t', ';', ',']
        .into_iter()
        .max_by_key(|candidate| first_line.matches(*candidate).count())
        .filter(|candidate| first_line.contains(*candidate))?;

    let records = parse_records(text, delimiter);
    let (header, rows) = records.split_first()?;
    let header: Vec<String> = header.iter().map(|value| tokens(value).join("")).collect();

    const NOT_TITLE: [&str; 9] = ["uri", "url", "id", "number", "numero", "album", "artist", "playlist", "isrc"];
    let title = column(&header, &["title", "trackname", "track", "songname", "song", "name", "titulo", "nombre", "cancion"])
        .or_else(|| column_like(&header, &["cancion", "song", "track", "title", "titulo", "tema"], &NOT_TITLE))?;
    let artist = column(&header, &["artist", "artistnames", "artistname", "artists", "artista", "artistas", "creator", "albumartistnames"])
        .or_else(|| column_like(&header, &["artist", "interprete", "autor"], &["id", "uri", "album"]));
    let album = column(&header, &["album", "albumname", "albumtitle"])
        .or_else(|| column_like(&header, &["album"], &["artist", "date", "fecha", "id", "uri"]));
    let duration = column(&header, &["durationseconds", "durationms", "trackdurationms", "duration", "duracion", "time", "tiempo"])
        .or_else(|| column_like(&header, &["duration", "duracion"], &[]));
    let playlist = column(&header, &["playlist", "playlistname", "collection", "lista"]);
    let kind = column(&header, &["type", "tipo"]);
    let video = column(&header, &["videoid", "youtubeid"]);
    let thumbnail = column(&header, &["thumbnail", "thumbnailurl"]);
    let playlist_id = column(&header, &["playlistid"]);
    let source = column(&header, &["playlistsource"]);
    let link = column(&header, &["playlistlink"]);

    let cell = |record: &[String], index: Option<usize>| -> String {
        index
            .and_then(|index| record.get(index))
            .map(|value| unguard(value.trim()).to_string())
            .unwrap_or_default()
    };

    let mut collections: Vec<Collection> = Vec::new();
    let mut positions: HashMap<String, usize> = HashMap::new();

    for record in rows {
        let row_kind = cell(record, kind).to_lowercase();
        let (kind_name, default_name) = match row_kind.as_str() {
            "like" | "liked" | "favorite" | "favorites" | "favorito" | "favoritos" => ("likes", "Me gusta"),
            "download" => ("playlist", "Descargadas"),
            _ => ("playlist", stem),
        };
        let listed = cell(record, playlist);
        let name = if listed.is_empty() { default_name.to_string() } else { listed };
        let key = format!("{kind_name}\u{1f}{}", name.to_lowercase());

        let position = *positions.entry(key).or_insert_with(|| {
            let mut collection = new_collection(&name);
            collection.kind = kind_name.to_string();
            let saved_id = cell(record, playlist_id);
            if !saved_id.is_empty() {
                collection.id = saved_id;
            }
            let saved_source = cell(record, source);
            if !saved_source.is_empty() {
                collection.source = saved_source;
            }
            let saved_link = cell(record, link);
            collection.source_link = (!saved_link.is_empty()).then_some(saved_link);
            collections.push(collection);
            collections.len() - 1
        });

        let track_title = cell(record, Some(title));
        if track_title.is_empty() {
            continue;
        }
        let video_id = cell(record, video);
        collections[position].rows.push(Row {
            title: track_title,
            artist: cell(record, artist),
            album: cell(record, album),
            duration_sec: duration.map_or(0.0, |index| {
                parse_duration_field(&cell(record, Some(index)), &header[index])
            }),
            video_id: if super::server::valid_video_id(&video_id) { video_id } else { String::new() },
            thumbnail: cell(record, thumbnail),
        });
    }
    Some(collections)
}

fn parse_lines(text: &str, stem: &str) -> Vec<Collection> {
    let rows = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .take(MAX_ROWS)
        .map(split_artist_title)
        .filter(|row| !row.title.is_empty())
        .collect();
    single(stem, rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: &str, title: &str) -> Track {
        Track {
            video_id: id.to_string(),
            title: title.to_string(),
            artist: "Banda, Otra".to_string(),
            album: "Disco".to_string(),
            duration_sec: 200.0,
            thumbnail_url: Some("https://img.test/a.jpg".to_string()),
        }
    }

    #[test]
    fn export_round_trips_collections() {
        let csv = export_csv(&ExportRequest {
            playlists: vec![
                ExportPlaylist {
                    id: "local:1".to_string(),
                    title: "Mi, lista".to_string(),
                    source: "Mi playlist".to_string(),
                    source_link: None,
                    tracks: vec![track("abcdefghijk", "=Canción \"uno\"")],
                },
                ExportPlaylist {
                    id: "local:2".to_string(),
                    title: "Vacía".to_string(),
                    source: "Mi playlist".to_string(),
                    source_link: None,
                    tracks: vec![],
                },
            ],
            likes: vec![track("bcdefghijkl", "Dos")],
            downloads: vec![],
        });
        assert!(csv.contains("'=Canción"));

        let parsed = parse_file("biblioteca.csv", &csv).unwrap();
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].kind, "likes");
        assert_eq!(parsed[1].id, "local:1");
        assert_eq!(parsed[1].name, "Mi, lista");
        assert_eq!(parsed[1].rows[0].title, "=Canción \"uno\"");
        assert_eq!(parsed[1].rows[0].video_id, "abcdefghijk");
        assert_eq!(parsed[2].name, "Vacía");
        assert!(parsed[2].rows.is_empty());
    }

    #[test]
    fn reads_spreadsheets_from_other_apps() {
        let exportify = "\"Track Name\",\"Artist Name(s)\",\"Album Name\",\"Duration (ms)\"\n\"Flaca\",\"Andrés Calamaro\",\"Alta Suciedad\",\"273000\"\n";
        let rows = &parse_file("Rock.csv", exportify).unwrap()[0];
        assert_eq!(rows.name, "Rock");
        assert_eq!(rows.rows[0].artist, "Andrés Calamaro");
        assert_eq!(rows.rows[0].duration_sec, 273.0);

        // Exportify actual (más columnas, con BOM y artistas separados por coma).
        let exportify_new = "\u{feff}\"Track URI\",\"Track Name\",\"Album Name\",\"Artist Name(s)\",\"Release Date\",\"Duration (ms)\",\"Popularity\",\"Explicit\",\"Added By\",\"Added At\",\"Genres\",\"Record Label\"\r\n\"spotify:track:1\",\"Rakata\",\"Pa'l Mundo\",\"Wisin & Yandel\",\"2005\",\"173000\",\"70\",\"false\",\"\",\"2024-01-01T00:00:00Z\",\"reggaeton\",\"Machete\"\r\n";
        let rows = &parse_file("Mi_playlist.csv", exportify_new).unwrap()[0];
        assert_eq!(rows.rows[0].title, "Rakata");
        assert_eq!(rows.rows[0].artist, "Wisin & Yandel");

        // TuneMyMusic.
        let tune = "Track name,Artist name,Album,Playlist name,Type,ISRC,Spotify - id\nRakata,Wisin & Yandel,Pa'l Mundo,Fiesta,Playlist,USUM7,1\n";
        assert_eq!(parse_file("x.csv", tune).unwrap()[0].name, "Fiesta");

        // Soundiiz y Chosic.
        let soundiiz = "title,artist,album,isrc\nRakata,Wisin & Yandel,Pa'l Mundo,USUM7\n";
        assert_eq!(parse_file("x.csv", soundiiz).unwrap()[0].rows.len(), 1);
        let chosic = "#,Song,Artist,Popularity,BPM,Genres,Parent Genres,Album,Album Date,Time\n1,Rakata,Wisin & Yandel,70,98,reggaeton,Latin,Pa'l Mundo,2005,02:53\n";
        assert_eq!(parse_file("x.csv", chosic).unwrap()[0].rows[0].duration_sec, 173.0);

        // Encabezados en español con otras palabras.
        let spanish = "Nombre de la canción;Nombre del artista;Nombre del álbum;Duración (ms)\nRakata;Wisin & Yandel;Pa'l Mundo;173000\n";
        let rows = &parse_file("x.csv", spanish).unwrap()[0].rows[0];
        assert_eq!((rows.title.as_str(), rows.artist.as_str()), ("Rakata", "Wisin & Yandel"));
        assert_eq!(rows.duration_sec, 173.0);

        // "Descargar tus datos" de Spotify: biblioteca y playlists en JSON.
        let library = r#"{"tracks":[{"artist":"Wisin & Yandel","album":"Pa'l Mundo","track":"Rakata","uri":"spotify:track:1"}]}"#;
        assert_eq!(parse_file("YourLibrary.json", library).unwrap()[0].rows[0].title, "Rakata");
        let lists = r#"{"playlists":[{"name":"Fiesta","lastModifiedDate":"2024-01-01","items":[{"track":{"trackName":"Rakata","artistName":"Wisin & Yandel","albumName":"Pa'l Mundo","trackUri":"spotify:track:1"},"episode":null,"localTrack":null,"addedDate":"2024-01-01"}]}]}"#;
        assert_eq!(parse_file("Playlist1.json", lists).unwrap()[0].rows[0].artist, "Wisin & Yandel");

        let grouped = "Título;Artista;Playlist\nUno;A;Lista 1\nDos;B;Lista 2\n";
        assert_eq!(parse_file("x.csv", grouped).unwrap().len(), 2);
    }

    #[test]
    fn reads_playlist_files() {
        let m3u = "#EXTM3U\n#PLAYLIST:Viaje\n#EXTINF:215,Soda Stereo - Persiana Americana\nmusica/a.mp3\nhttps://youtu.be/abcdefghijk\n";
        let parsed = parse_file("a.m3u8", m3u).unwrap();
        assert_eq!(parsed[0].name, "Viaje");
        assert_eq!(parsed[0].rows[0].artist, "Soda Stereo");
        assert_eq!(parsed[0].rows[0].duration_sec, 215.0);
        assert_eq!(parsed[0].rows[1].video_id, "abcdefghijk");

        let xspf = "<playlist><title>Mix &amp; más</title><trackList><track><title>Uno</title><creator>A</creator><duration>180000</duration></track></trackList></playlist>";
        let parsed = parse_file("a.xspf", xspf).unwrap();
        assert_eq!(parsed[0].name, "Mix & más");
        assert_eq!(parsed[0].rows[0].duration_sec, 180.0);
    }

    #[test]
    fn reads_json_and_plain_text() {
        let json = r#"{"playlists":[{"name":"Spotify","items":[{"track":{"trackName":"Uno","artistName":"A","albumName":"B"}}]}]}"#;
        let parsed = parse_file("Playlist1.json", json).unwrap();
        assert_eq!(parsed[0].name, "Spotify");
        assert_eq!(parsed[0].rows[0].title, "Uno");

        let parsed = parse_file("favoritas.txt", "Queen - Bohemian Rhapsody\n\nSolo título\n").unwrap();
        assert_eq!(parsed[0].rows.len(), 2);
        assert_eq!(parsed[0].rows[0].title, "Bohemian Rhapsody");
    }

    #[test]
    fn rejects_files_without_songs() {
        assert!(parse_file("vacio.csv", "   ").is_err());
        assert!(parse_file("a.json", "{\"hola\":1}").is_err());
    }
}
