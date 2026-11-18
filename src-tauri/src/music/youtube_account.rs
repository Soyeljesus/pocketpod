//! Lee la biblioteca de la cuenta con la API oficial de YouTube.
//!
//! Usa un token temporal de solo lectura que Android entrega tras el permiso
//! de la persona. El token no se guarda ni se envía a otro servicio.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use super::importers::parse_iso_duration;
use super::innertube::is_spoken_content;
use super::Track;

const API: &str = "https://www.googleapis.com/youtube/v3";
const MUSIC_CATEGORY: &str = "10";
const PAGE_SIZE: &str = "50";
const MAX_PLAYLISTS: usize = 200;
const MAX_TRACKS_PER_PLAYLIST: usize = 2000;
const MAX_TOTAL_VIDEOS: usize = 5000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeList {
    pub id: String,
    pub title: String,
    pub tracks: Vec<Track>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeLibrary {
    pub playlists: Vec<YoutubeList>,
    pub likes: Vec<Track>,
    pub skipped: usize,
}

pub async fn fetch_library(token: &str) -> Result<YoutubeLibrary, String> {
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "youtube_network".to_string())?;

    let likes = fetch_likes(&http, token).await?;
    let playlists = fetch_playlists(&http, token).await?;

    let mut wanted = Vec::new();
    let mut seen = HashSet::new();
    let mut lists = Vec::new();
    for (id, title) in playlists {
        let video_ids = fetch_playlist_items(&http, token, &id).await?;
        for video_id in &video_ids {
            if wanted.len() < MAX_TOTAL_VIDEOS && seen.insert(video_id.clone()) {
                wanted.push(video_id.clone());
            }
        }
        lists.push((id, title, video_ids));
    }

    let videos = fetch_videos(&http, token, &wanted).await?;
    let mut skipped = 0;
    let playlists = lists
        .into_iter()
        .filter_map(|(id, title, video_ids)| {
            let mut tracks = Vec::new();
            for video_id in video_ids {
                match videos.get(&video_id) {
                    Some(track) => tracks.push(track.clone()),
                    None => skipped += 1,
                }
            }
            (!tracks.is_empty()).then_some(YoutubeList { id, title, tracks })
        })
        .collect();

    Ok(YoutubeLibrary {
        playlists,
        likes,
        skipped,
    })
}

async fn get_json(
    http: &reqwest::Client,
    token: &str,
    path: &str,
    query: &[(&str, &str)],
) -> Result<Value, String> {
    let response = http
        .get(format!("{API}/{path}"))
        .bearer_auth(token)
        .query(query)
        .send()
        .await
        .map_err(|_| "youtube_network".to_string())?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|_| "youtube_invalid_response".to_string())?;
    if status.is_success() {
        Ok(value)
    } else {
        Err(error_code(status.as_u16(), &value))
    }
}

fn error_code(status: u16, value: &Value) -> String {
    let reason = value
        .pointer("/error/errors/0/reason")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let detail = value
        .pointer("/error/details")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find_map(|item| item.get("reason")?.as_str())
        .unwrap_or_default();

    if status == 403
        && !matches!(
            reason,
            "quotaExceeded"
                | "dailyLimitExceeded"
                | "rateLimitExceeded"
                | "youtubeSignupRequired"
                | "channelNotFound"
                | "accessNotConfigured"
                | "insufficientPermissions"
        )
        && !matches!(detail, "SERVICE_DISABLED" | "ACCESS_TOKEN_SCOPE_INSUFFICIENT")
    {
        // Solo un código técnico: nunca incluye tokens ni datos de la cuenta.
        let code: String = [detail, reason]
            .into_iter()
            .find(|text| !text.is_empty())
            .unwrap_or("UNKNOWN")
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
            .take(48)
            .collect();
        return format!("youtube_forbidden:{code}");
    }

    match (status, reason) {
        (_, "quotaExceeded" | "dailyLimitExceeded" | "rateLimitExceeded") => "youtube_quota",
        (_, "youtubeSignupRequired" | "channelNotFound") => "youtube_no_channel",
        (_, "accessNotConfigured") => "youtube_api_disabled",
        (_, "insufficientPermissions") => "youtube_consent_required",
        _ if detail == "SERVICE_DISABLED" => "youtube_api_disabled",
        _ if detail == "ACCESS_TOKEN_SCOPE_INSUFFICIENT" => "youtube_consent_required",
        (401, _) => "youtube_consent_required",
        _ => "youtube_unavailable",
    }
    .to_string()
}

fn next_page(value: &Value) -> Option<String> {
    value
        .get("nextPageToken")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
}

fn items(value: &Value) -> &[Value] {
    value
        .get("items")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

async fn fetch_likes(http: &reqwest::Client, token: &str) -> Result<Vec<Track>, String> {
    let mut tracks = Vec::new();
    let mut seen = HashSet::new();
    let mut page: Option<String> = None;

    loop {
        let mut query = vec![
            ("part", "snippet,contentDetails"),
            ("myRating", "like"),
            ("maxResults", PAGE_SIZE),
        ];
        if let Some(value) = page.as_deref() {
            query.push(("pageToken", value));
        }
        let value = get_json(http, token, "videos", &query).await?;
        for item in items(&value) {
            if let Some(track) = music_track(item) {
                if seen.insert(track.video_id.clone()) {
                    tracks.push(track);
                }
            }
        }
        page = next_page(&value);
        if page.is_none() {
            return Ok(tracks);
        }
    }
}

async fn fetch_playlists(
    http: &reqwest::Client,
    token: &str,
) -> Result<Vec<(String, String)>, String> {
    let mut playlists = Vec::new();
    let mut page: Option<String> = None;

    loop {
        let mut query = vec![("part", "snippet"), ("mine", "true"), ("maxResults", PAGE_SIZE)];
        if let Some(value) = page.as_deref() {
            query.push(("pageToken", value));
        }
        let value = get_json(http, token, "playlists", &query).await?;
        playlists.extend(items(&value).iter().filter_map(parse_playlist));
        page = next_page(&value);
        if page.is_none() || playlists.len() >= MAX_PLAYLISTS {
            playlists.truncate(MAX_PLAYLISTS);
            return Ok(playlists);
        }
    }
}

async fn fetch_playlist_items(
    http: &reqwest::Client,
    token: &str,
    playlist_id: &str,
) -> Result<Vec<String>, String> {
    let mut ids = Vec::new();
    let mut seen = HashSet::new();
    let mut page: Option<String> = None;

    loop {
        let mut query = vec![
            ("part", "contentDetails"),
            ("playlistId", playlist_id),
            ("maxResults", PAGE_SIZE),
        ];
        if let Some(value) = page.as_deref() {
            query.push(("pageToken", value));
        }
        let value = get_json(http, token, "playlistItems", &query).await?;
        for item in items(&value) {
            if let Some(id) = item.pointer("/contentDetails/videoId").and_then(Value::as_str) {
                if seen.insert(id.to_string()) {
                    ids.push(id.to_string());
                }
            }
        }
        page = next_page(&value);
        if page.is_none() || ids.len() >= MAX_TRACKS_PER_PLAYLIST {
            ids.truncate(MAX_TRACKS_PER_PLAYLIST);
            return Ok(ids);
        }
    }
}

async fn fetch_videos(
    http: &reqwest::Client,
    token: &str,
    ids: &[String],
) -> Result<HashMap<String, Track>, String> {
    let mut tracks = HashMap::new();
    for chunk in ids.chunks(50) {
        let joined = chunk.join(",");
        let value = get_json(
            http,
            token,
            "videos",
            &[("part", "snippet,contentDetails"), ("id", &joined)],
        )
        .await?;
        for item in items(&value) {
            if let Some(track) = music_track(item) {
                tracks.insert(track.video_id.clone(), track);
            }
        }
    }
    Ok(tracks)
}

fn parse_playlist(item: &Value) -> Option<(String, String)> {
    let id = item.get("id")?.as_str()?.to_string();
    let title = item.pointer("/snippet/title")?.as_str()?.trim().to_string();
    (!id.is_empty() && !title.is_empty()).then_some((id, title))
}

fn music_track(item: &Value) -> Option<Track> {
    let snippet = item.get("snippet")?;
    if snippet.get("categoryId")?.as_str()? != MUSIC_CATEGORY {
        return None;
    }

    let title = snippet.get("title")?.as_str()?.trim().to_string();
    let channel = snippet.get("channelTitle")?.as_str()?.trim();
    let artist = channel.strip_suffix(" - Topic").unwrap_or(channel).to_string();
    if title.is_empty() || is_spoken_content(&title, &artist, "") {
        return None;
    }

    let duration_sec = item
        .pointer("/contentDetails/duration")
        .and_then(Value::as_str)
        .and_then(parse_iso_duration)
        .unwrap_or(0.0);
    let thumbnail_url = ["high", "medium", "default"].iter().find_map(|size| {
        snippet
            .pointer(&format!("/thumbnails/{size}/url"))?
            .as_str()
            .map(str::to_string)
    });

    Some(Track {
        video_id: item.get("id")?.as_str()?.to_string(),
        title,
        artist,
        album: String::new(),
        duration_sec,
        thumbnail_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn video(category: &str, title: &str) -> Value {
        json!({
            "id": "abcdefghijk",
            "snippet": {
                "title": title,
                "channelTitle": "Soda Stereo - Topic",
                "categoryId": category,
                "thumbnails": { "medium": { "url": "https://img.test/m.jpg" } }
            },
            "contentDetails": { "duration": "PT4M48S" }
        })
    }

    #[test]
    fn keeps_music_and_cleans_artist() {
        let track = music_track(&video("10", "Persiana Americana")).unwrap();
        assert_eq!(track.artist, "Soda Stereo");
        assert_eq!(track.duration_sec, 288.0);
        assert_eq!(track.thumbnail_url.as_deref(), Some("https://img.test/m.jpg"));
    }

    #[test]
    fn skips_videos_that_are_not_music() {
        assert!(music_track(&video("27", "Clase de historia")).is_none());
        assert!(music_track(&video("10", "Audiolibro completo")).is_none());
    }

    #[test]
    fn reads_playlists_and_pages() {
        let response = json!({
            "nextPageToken": "next",
            "items": [
                { "id": "PL1", "snippet": { "title": " Mi lista " } },
                { "id": "", "snippet": { "title": "Inválida" } }
            ]
        });
        let parsed: Vec<_> = items(&response).iter().filter_map(parse_playlist).collect();
        assert_eq!(parsed, vec![("PL1".to_string(), "Mi lista".to_string())]);
        assert_eq!(next_page(&response).as_deref(), Some("next"));
    }

    #[test]
    fn maps_api_errors_without_exposing_details() {
        let quota = json!({ "error": { "errors": [{ "reason": "quotaExceeded" }] } });
        assert_eq!(error_code(403, &quota), "youtube_quota");
        assert_eq!(error_code(401, &json!({})), "youtube_consent_required");
        let denied = json!({ "error": {
            "errors": [{ "reason": "forbidden" }],
            "details": [{ "reason": "ACCESS_DENIED" }]
        }});
        assert_eq!(error_code(403, &denied), "youtube_forbidden:ACCESS_DENIED");
        let disabled = json!({ "error": { "details": [{ "reason": "SERVICE_DISABLED" }] } });
        assert_eq!(error_code(403, &disabled), "youtube_api_disabled");
        assert_eq!(error_code(500, &json!({})), "youtube_unavailable");
    }
}
