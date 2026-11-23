//! Inicio de sesión con Google en Windows.
//!
//! Sigue el flujo para apps instaladas (RFC 8252): abre el navegador del
//! sistema, Google vuelve a `http://127.0.0.1:<puerto>` y FoYu cambia el
//! código por los tokens usando PKCE. La contraseña nunca pasa por FoYu, y el
//! servidor temporal solo vive hasta recibir esa única respuesta.

use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const WAIT_FOR_BROWSER: Duration = Duration::from_secs(300);

pub struct GoogleTokens {
    pub id_token: Option<String>,
    pub access_token: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    id_token: Option<String>,
}

fn random_text(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).map_err(|_| "google_unavailable".to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(buffer))
}

fn query_value(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        if name != key {
            return None;
        }
        urlencoding_decode(value)
    })
}

fn urlencoding_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => out.push(b' '),
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                index += 2;
            }
            byte => out.push(byte),
        }
        index += 1;
    }
    String::from_utf8(out).ok()
}

const DONE_PAGE: &str = "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>FoYu</title>\
<body style=\"font-family:system-ui,sans-serif;background:#090c14;color:#f5f6fb;display:grid;place-items:center;height:100vh;margin:0\">\
<div style=\"text-align:center\"><h1>Listo</h1><p>Ya puedes cerrar esta pestaña y volver a FoYu.</p></div></body></html>";

const FAILED_PAGE: &str = "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>FoYu</title>\
<body style=\"font-family:system-ui,sans-serif;background:#090c14;color:#f5f6fb;display:grid;place-items:center;height:100vh;margin:0\">\
<div style=\"text-align:center\"><h1>No se completó</h1><p>Vuelve a FoYu e inténtalo de nuevo.</p></div></body></html>";

/// Espera la vuelta del navegador y devuelve el código de autorización.
async fn wait_for_code(listener: TcpListener, state: &str) -> Result<String, String> {
    loop {
        let (mut socket, _) = listener
            .accept()
            .await
            .map_err(|_| "google_unavailable".to_string())?;
        let mut buffer = vec![0u8; 8192];
        let read = tokio::time::timeout(Duration::from_secs(10), socket.read(&mut buffer))
            .await
            .map_err(|_| "google_unavailable".to_string())?
            .map_err(|_| "google_unavailable".to_string())?;
        let request = String::from_utf8_lossy(&buffer[..read]);
        let path = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("");
        // El navegador puede pedir también /favicon.ico: se ignora.
        let Some(query) = path.strip_prefix("/?") else {
            let _ = socket
                .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .await;
            continue;
        };

        let valid_state = query_value(query, "state").as_deref() == Some(state);
        let code = query_value(query, "code").filter(|_| valid_state);
        let page = if code.is_some() { DONE_PAGE } else { FAILED_PAGE };
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{}",
            page.len(),
            page
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;

        return match code {
            Some(code) => Ok(code),
            None if query_value(query, "error").as_deref() == Some("access_denied") => {
                Err("google_cancelled".to_string())
            }
            None => Err("google_unavailable".to_string()),
        };
    }
}

/// Abre Google en el navegador y devuelve los tokens de esta sesión.
pub async fn authorize(
    app: &tauri::AppHandle,
    client_id: &str,
    client_secret: &str,
    scopes: &str,
    nonce: Option<&str>,
    login_hint: Option<&str>,
) -> Result<GoogleTokens, String> {
    use tauri_plugin_opener::OpenerExt;

    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return Err("google_not_configured".to_string());
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|_| "google_unavailable".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "google_unavailable".to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let verifier = random_text(48)?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_text(24)?;

    let mut url = reqwest::Url::parse(AUTH_URL).map_err(|_| "google_unavailable".to_string())?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", scopes)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state)
            .append_pair("prompt", "select_account");
        if let Some(nonce) = nonce {
            query.append_pair("nonce", nonce);
        }
        if let Some(hint) = login_hint.filter(|hint| !hint.is_empty()) {
            query.append_pair("login_hint", hint);
        }
    }

    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "google_unavailable".to_string())?;

    let code = tokio::time::timeout(WAIT_FOR_BROWSER, wait_for_code(listener, &state))
        .await
        .map_err(|_| "google_cancelled".to_string())??;

    let response = reqwest::Client::new()
        .post(TOKEN_URL)
        .form(&[
            ("code", code.as_str()),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|_| "google_unavailable".to_string())?;
    if !response.status().is_success() {
        return Err("google_unavailable".to_string());
    }
    let tokens: TokenResponse = response
        .json()
        .await
        .map_err(|_| "google_unavailable".to_string())?;

    Ok(GoogleTokens {
        id_token: tokens.id_token,
        access_token: tokens.access_token,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_query_values() {
        let query = "state=abc%2Bd&code=4%2F0Ab_c&scope=email+profile";
        assert_eq!(query_value(query, "state").as_deref(), Some("abc+d"));
        assert_eq!(query_value(query, "code").as_deref(), Some("4/0Ab_c"));
        assert_eq!(query_value(query, "scope").as_deref(), Some("email profile"));
        assert_eq!(query_value(query, "missing"), None);
    }

    #[test]
    fn random_text_is_url_safe_and_unique() {
        let first = random_text(32).unwrap();
        let second = random_text(32).unwrap();
        assert_ne!(first, second);
        assert!(first.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }
}
