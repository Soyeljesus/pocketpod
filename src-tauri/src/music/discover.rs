//! Inicio y descubrimiento: estantes públicos de YouTube Music.
//!
//! Son las mismas secciones que YouTube Music muestra sin cuenta: listas de la
//! comunidad más escuchadas, estados de ánimo y géneros. YouTube ya las ordena
//! por lo que la gente escucha y guarda; FoYu solo las lee y las presenta.

use serde::Serialize;
use serde_json::Value;

use super::innertube::{is_spoken_content, parse_tracks};
use super::Track;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverItem {
    /// "playlist", "album" o "song".
    pub kind: String,
    /// Id de playlist (también para álbumes) o videoId.
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub thumbnail_url: Option<String>,
    pub track: Option<Track>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverShelf {
    pub title: String,
    pub items: Vec<DiscoverItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverChip {
    pub title: String,
    pub params: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageHeader {
    pub title: String,
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverPage {
    pub chips: Vec<DiscoverChip>,
    pub shelves: Vec<DiscoverShelf>,
    pub header: Option<PageHeader>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoodItem {
    pub title: String,
    pub browse_id: String,
    pub params: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoodGroup {
    pub title: String,
    pub items: Vec<MoodItem>,
}

const MAX_SHELF_ITEMS: usize = 30;

fn collect<'a>(value: &'a Value, key: &str, out: &mut Vec<&'a Value>) {
    match value {
        Value::Object(map) => {
            if let Some(item) = map.get(key) {
                out.push(item);
                return;
            }
            for child in map.values() {
                collect(child, key, out);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect(child, key, out);
            }
        }
        _ => {}
    }
}

fn runs_text(value: Option<&Value>) -> String {
    value
        .and_then(|runs| runs.get("runs"))
        .and_then(Value::as_array)
        .map(|runs| {
            runs.iter()
                .filter_map(|run| run.get("text").and_then(Value::as_str))
                .collect::<String>()
        })
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn first_key<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    let mut found = Vec::new();
    collect(value, key, &mut found);
    found.into_iter().next()
}

fn last_thumbnail(item: &Value) -> Option<String> {
    first_key(item, "thumbnails")
        .and_then(Value::as_array)
        .and_then(|list| list.last())
        .and_then(|thumb| thumb.get("url"))
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("https://"))
        .map(str::to_string)
}

fn valid_id(id: &str) -> bool {
    (6..=128).contains(&id.len())
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Quita del subtítulo el tipo ("Lista de reproducción", "Álbum"...).
fn clean_subtitle(text: &str) -> String {
    const KINDS: [&str; 10] = [
        "lista de reproducción", "playlist", "álbum", "album", "single", "ep", "sencillo", "canción",
        "artista", "artist",
    ];
    text.split(" • ")
        .map(str::trim)
        .filter(|part| !part.is_empty() && !KINDS.contains(&part.to_lowercase().as_str()))
        .collect::<Vec<_>>()
        .join(" • ")
}

fn parse_two_row(item: &Value) -> Option<DiscoverItem> {
    let title = runs_text(item.get("title"));
    let subtitle = clean_subtitle(&runs_text(item.get("subtitle")));
    if title.is_empty() || is_spoken_content(&title, &subtitle, "") {
        return None;
    }
    let navigation = item.get("navigationEndpoint")?;
    let thumbnail_url = last_thumbnail(item);

    if let Some(video_id) = navigation
        .pointer("/watchEndpoint/videoId")
        .and_then(Value::as_str)
        .filter(|id| valid_id(id))
    {
        let artist = subtitle
            .split(" • ")
            .find(|part| !part.is_empty())
            .unwrap_or_default()
            .to_string();
        return Some(DiscoverItem {
            kind: "song".to_string(),
            id: video_id.to_string(),
            title: title.clone(),
            subtitle: subtitle.clone(),
            thumbnail_url: thumbnail_url.clone(),
            track: Some(Track {
                video_id: video_id.to_string(),
                title,
                artist,
                album: String::new(),
                duration_sec: 0.0,
                thumbnail_url,
            }),
        });
    }

    let browse = navigation.get("browseEndpoint")?;
    let page_type = browse
        .pointer("/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let browse_id = browse.get("browseId").and_then(Value::as_str).unwrap_or_default();

    let (kind, id) = match page_type {
        "MUSIC_PAGE_TYPE_ARTIST" => ("artist", browse_id.to_string()),
        "MUSIC_PAGE_TYPE_PLAYLIST" => ("playlist", browse_id.strip_prefix("VL").unwrap_or(browse_id).to_string()),
        "MUSIC_PAGE_TYPE_ALBUM" => {
            // El álbum se reproduce por su lista de audio (OLAK5uy_...).
            let playlist = first_key(item, "watchPlaylistEndpoint")
                .and_then(|endpoint| endpoint.get("playlistId"))
                .and_then(Value::as_str)?;
            ("album", playlist.to_string())
        }
        _ => return None,
    };
    if !valid_id(&id) || (id.starts_with("RD") && !id.starts_with("RDCLAK")) {
        return None;
    }

    Some(DiscoverItem {
        kind: kind.to_string(),
        id,
        title,
        subtitle,
        thumbnail_url,
        track: None,
    })
}

fn song_item(track: Track) -> DiscoverItem {
    DiscoverItem {
        kind: "song".to_string(),
        id: track.video_id.clone(),
        title: track.title.clone(),
        subtitle: track.artist.clone(),
        thumbnail_url: track.thumbnail_url.clone(),
        track: Some(track),
    }
}

fn parse_shelf(shelf: &Value) -> Option<DiscoverShelf> {
    let title = runs_text(
        shelf
            .pointer("/header/musicCarouselShelfBasicHeaderRenderer/title")
            .or_else(|| shelf.pointer("/header/gridHeaderRenderer/title"))
            .or_else(|| shelf.get("title")),
    );
    let entries = shelf
        .get("contents")
        .or_else(|| shelf.get("items"))
        .and_then(Value::as_array)?;

    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::new();
    for entry in entries {
        if let Some(two_row) = entry.get("musicTwoRowItemRenderer") {
            if let Some(item) = parse_two_row(two_row) {
                if seen.insert(item.id.clone()) {
                    items.push(item);
                }
            }
        } else if entry.get("musicResponsiveListItemRenderer").is_some() {
            for track in parse_tracks(entry, 1, &mut seen) {
                items.push(song_item(track));
            }
        }
        if items.len() >= MAX_SHELF_ITEMS {
            break;
        }
    }
    if title.is_empty() || items.is_empty() {
        return None;
    }
    Some(DiscoverShelf { title, items })
}

/// Estantes de una página de YouTube Music (inicio o categoría).
pub fn parse_page(value: &Value) -> DiscoverPage {
    // En orden de aparición: en la página de un artista las canciones van primero.
    let mut shelves = Vec::new();
    let mut found = Vec::new();
    collect_any(
        value,
        &["musicShelfRenderer", "musicCarouselShelfRenderer", "gridRenderer"],
        &mut found,
    );
    shelves.extend(found.into_iter().filter_map(parse_shelf));

    let header = ["musicImmersiveHeaderRenderer", "musicVisualHeaderRenderer"]
        .iter()
        .find_map(|key| value.get("header")?.get(*key))
        .and_then(|header| {
            let title = runs_text(header.get("title"));
            (!title.is_empty()).then(|| PageHeader {
                title,
                thumbnail_url: last_thumbnail(header),
            })
        });

    let mut chips = Vec::new();
    let mut found = Vec::new();
    collect(value, "chipCloudChipRenderer", &mut found);
    for chip in found {
        let title = runs_text(chip.get("text"));
        let params = chip
            .pointer("/navigationEndpoint/browseEndpoint/params")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let lower = title.to_lowercase();
        if title.is_empty() || params.is_empty() || lower.contains("podcast") || lower.contains("pódcast") {
            continue;
        }
        chips.push(DiscoverChip {
            title,
            params: params.to_string(),
        });
    }

    DiscoverPage { chips, shelves, header }
}

fn collect_any<'a>(value: &'a Value, keys: &[&str], out: &mut Vec<&'a Value>) {
    match value {
        Value::Object(map) => {
            if let Some(item) = keys.iter().find_map(|key| map.get(*key)) {
                out.push(item);
                return;
            }
            for child in map.values() {
                collect_any(child, keys, out);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_any(child, keys, out);
            }
        }
        _ => {}
    }
}

/// "Resultado principal" de una búsqueda: casi siempre el artista más escuchado.
pub fn parse_top(value: &Value) -> Option<DiscoverItem> {
    let card = first_key(value, "musicCardShelfRenderer")?;
    let title = runs_text(card.get("title"));
    let subtitle = clean_subtitle(&runs_text(card.get("subtitle")));
    let run = card.pointer("/title/runs/0")?;
    let browse = run.pointer("/navigationEndpoint/browseEndpoint");
    let page_type = browse
        .and_then(|endpoint| {
            endpoint.pointer(
                "/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType",
            )
        })
        .and_then(Value::as_str);
    if page_type != Some("MUSIC_PAGE_TYPE_ARTIST") || title.is_empty() {
        return None;
    }
    let id = browse?.get("browseId")?.as_str()?.to_string();
    valid_id(&id).then(|| DiscoverItem {
        kind: "artist".to_string(),
        id,
        title,
        subtitle,
        thumbnail_url: last_thumbnail(card),
        track: None,
    })
}

/// Primer álbum o artista de una búsqueda filtrada.
pub fn parse_lookup(value: &Value, kind: &str) -> Option<DiscoverItem> {
    let mut rows = Vec::new();
    collect(value, "musicResponsiveListItemRenderer", &mut rows);
    rows.into_iter().find_map(|row| {
        let browse = row.pointer("/navigationEndpoint/browseEndpoint")?;
        let page_type = browse
            .pointer("/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType")
            .and_then(Value::as_str)?;
        let column = |index: usize| {
            runs_text(row.pointer(&format!(
                "/flexColumns/{index}/musicResponsiveListItemFlexColumnRenderer/text"
            )))
        };
        let title = column(0);
        if title.is_empty() {
            return None;
        }
        let id = match (kind, page_type) {
            ("artist", "MUSIC_PAGE_TYPE_ARTIST") => browse.get("browseId")?.as_str()?.to_string(),
            ("album", "MUSIC_PAGE_TYPE_ALBUM") => first_key(row, "watchPlaylistEndpoint")?
                .get("playlistId")?
                .as_str()?
                .to_string(),
            _ => return None,
        };
        valid_id(&id).then(|| DiscoverItem {
            kind: kind.to_string(),
            id,
            title,
            subtitle: clean_subtitle(&column(1)),
            thumbnail_url: last_thumbnail(row),
            track: None,
        })
    })
}

/// Estados de ánimo y géneros.
pub fn parse_moods(value: &Value) -> Vec<MoodGroup> {
    let mut grids = Vec::new();
    collect(value, "gridRenderer", &mut grids);
    grids
        .into_iter()
        .filter_map(|grid| {
            let title = runs_text(grid.pointer("/header/gridHeaderRenderer/title"));
            let items: Vec<MoodItem> = grid
                .get("items")?
                .as_array()?
                .iter()
                .filter_map(|entry| {
                    let button = entry.get("musicNavigationButtonRenderer")?;
                    let browse = button.pointer("/clickCommand/browseEndpoint")?;
                    let title = runs_text(button.get("buttonText"));
                    let lower = title.to_lowercase();
                    if title.is_empty() || lower.contains("podcast") || lower.contains("pódcast") {
                        return None;
                    }
                    let color = button
                        .pointer("/solid/leftStripeColor")
                        .and_then(Value::as_u64)
                        .map(|argb| format!("#{:06x}", argb & 0xff_ffff));
                    Some(MoodItem {
                        title,
                        browse_id: browse.get("browseId")?.as_str()?.to_string(),
                        params: browse.get("params")?.as_str()?.to_string(),
                        color,
                    })
                })
                .collect();
            (!title.is_empty() && !items.is_empty()).then_some(MoodGroup { title, items })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn playlist_card(id: &str, title: &str) -> Value {
        json!({ "musicTwoRowItemRenderer": {
            "title": { "runs": [{ "text": title }] },
            "subtitle": { "runs": [{ "text": "Autor" }, { "text": " • " }, { "text": "622 K visualizaciones" }] },
            "thumbnailRenderer": { "musicThumbnailRenderer": { "thumbnail": { "thumbnails": [
                { "url": "https://yt3.ggpht.com/a=s192" }, { "url": "https://yt3.ggpht.com/a=s576" }
            ]}}},
            "navigationEndpoint": { "browseEndpoint": {
                "browseId": format!("VL{id}"),
                "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": {
                    "pageType": "MUSIC_PAGE_TYPE_PLAYLIST"
                }}
            }}
        }})
    }

    #[test]
    fn reads_community_shelves_and_chips() {
        let page = json!({
            "header": { "chipCloudRenderer": { "chips": [
                { "chipCloudChipRenderer": { "text": { "runs": [{ "text": "Pódcasts" }] },
                  "navigationEndpoint": { "browseEndpoint": { "params": "p1" } } } },
                { "chipCloudChipRenderer": { "text": { "runs": [{ "text": "Relax" }] },
                  "navigationEndpoint": { "browseEndpoint": { "params": "p2" } } } }
            ]}},
            "contents": [{ "musicCarouselShelfRenderer": {
                "header": { "musicCarouselShelfBasicHeaderRenderer": {
                    "title": { "runs": [{ "text": "Listas de la comunidad" }] } } },
                "contents": [
                    playlist_card("PLabcdef12345", "viejitas pero bonitas"),
                    playlist_card("PLabcdef12345", "repetida"),
                    playlist_card("RDAMVMxyz12345", "mezcla automática")
                ]
            }}]
        });
        let parsed = parse_page(&page);
        assert_eq!(parsed.chips.len(), 1);
        assert_eq!(parsed.chips[0].title, "Relax");
        assert_eq!(parsed.shelves.len(), 1);
        let items = &parsed.shelves[0].items;
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "PLabcdef12345");
        assert_eq!(items[0].kind, "playlist");
        assert_eq!(items[0].thumbnail_url.as_deref(), Some("https://yt3.ggpht.com/a=s576"));
    }

    #[test]
    fn finds_album_playlist_and_artist_page() {
        let row = |page: &str, browse: &str, title: &str, play: Option<&str>| {
            let mut item = json!({ "musicResponsiveListItemRenderer": {
                "flexColumns": [
                    { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": title }] } } },
                    { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [
                        { "text": "Álbum" }, { "text": " • " }, { "text": "Wisin & Yandel" }] } } }
                ],
                "navigationEndpoint": { "browseEndpoint": {
                    "browseId": browse,
                    "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": { "pageType": page } }
                }}
            }});
            if let Some(list) = play {
                item["musicResponsiveListItemRenderer"]["overlay"] =
                    json!({ "watchPlaylistEndpoint": { "playlistId": list } });
            }
            item
        };
        let albums = json!({ "contents": [
            row("MUSIC_PAGE_TYPE_ALBUM", "MPREb_abc", "Pa'l Mundo", Some("OLAK5uy_abcdefgh"))
        ]});
        let album = parse_lookup(&albums, "album").unwrap();
        assert_eq!(album.id, "OLAK5uy_abcdefgh");
        assert_eq!(album.subtitle, "Wisin & Yandel");
        let artists = json!({ "contents": [
            row("MUSIC_PAGE_TYPE_ARTIST", "UCJ0-R-v3CaJNYMqfp9tivqA", "Wisin & Yandel", None)
        ]});
        assert_eq!(parse_lookup(&artists, "artist").unwrap().id, "UCJ0-R-v3CaJNYMqfp9tivqA");
        assert!(parse_lookup(&artists, "album").is_none());
    }

    #[test]
    fn reads_moods_with_colors() {
        let page = json!({ "contents": [{ "gridRenderer": {
            "header": { "gridHeaderRenderer": { "title": { "runs": [{ "text": "Géneros" }] } } },
            "items": [{ "musicNavigationButtonRenderer": {
                "buttonText": { "runs": [{ "text": "Bachata" }] },
                "solid": { "leftStripeColor": 4294901760u64 },
                "clickCommand": { "browseEndpoint": {
                    "browseId": "FEmusic_moods_and_genres_category", "params": "abc" } }
            }}]
        }}]});
        let groups = parse_moods(&page);
        assert_eq!(groups[0].title, "Géneros");
        assert_eq!(groups[0].items[0].title, "Bachata");
        assert_eq!(groups[0].items[0].color.as_deref(), Some("#ff0000"));
    }
}
