//! Servicio PocketAll en modo standalone (sidecar opcional).
//!
//! Uso:
//!   cargo run --bin pocketall -- 8787
//!
//! Imprime una línea JSON con `{ baseUrl, token, engine, available }`.
//! La app Tauri no lo necesita para funcionar: el servidor vive dentro del
//! proceso. Este binario existe para depurar el contrato o para quien prefiera
//! el patrón sidecar.

use std::sync::Arc;

use pocketpod_lib::music::{innertube::InnerTube, server, MusicEngine};

#[tokio::main]
async fn main() {
    let port = std::env::args()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8787);

    let engine = match InnerTube::new() {
        Ok(engine) => Arc::new(engine) as Arc<dyn MusicEngine>,
        Err(err) => {
            eprintln!("No se pudo iniciar el motor InnerTube: {err}");
            std::process::exit(1);
        }
    };

    if let Err(err) = server::run_standalone(engine, port).await {
        eprintln!("PocketAll terminó con error: {err}");
        std::process::exit(1);
    }
}
