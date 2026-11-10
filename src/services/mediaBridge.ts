import { invoke } from "@tauri-apps/api/core";
import type { MediaState } from "../types/media";
import { EMPTY_MEDIA_STATE } from "../types/media";

// El backend Rust devuelve los campos en snake_case (ej. artwork_data_url).
// Esta función los mapea al camelCase que espera React (artworkDataUrl).
function mapToFrontend(backendData: any): MediaState {
  if (!backendData) return EMPTY_MEDIA_STATE;
  return {
    title: backendData.title || "",
    artist: backendData.artist || "",
    album: backendData.album || "",
    artworkDataUrl: backendData.artwork_data_url || null,
    status: backendData.status || "unknown",
    positionSec: backendData.position_sec || 0,
    durationSec: backendData.duration_sec || 0,
    canSeek: backendData.can_seek || false,
    connected: backendData.connected || false,
    sourceAppId: backendData.source_app_id || null,
  };
}

export async function fetchMediaState(): Promise<MediaState> {
  try {
    const raw = await invoke<any>("get_media_state");
    return mapToFrontend(raw);
  } catch (e) {
    console.error("Error fetching media state:", e);
    return EMPTY_MEDIA_STATE;
  }
}

export async function togglePlayPause(): Promise<void> {
  await invoke("toggle_play_pause");
}

export async function skipNext(): Promise<void> {
  await invoke("skip_next");
}

export async function skipPrevious(): Promise<void> {
  await invoke("skip_previous");
}

export async function seekTo(seconds: number): Promise<void> {
  await invoke("seek_to", { seconds });
}

export async function subscribeMediaUpdates(
  _cb: (state: MediaState) => void,
): Promise<() => void> {
  // Implementaremos la suscripción real (interpolación) en el Sub-paso 3.2.
  return () => {};
}

export { EMPTY_MEDIA_STATE };