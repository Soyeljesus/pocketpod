import { invoke } from "@tauri-apps/api/core";
import type { MediaState } from "../types/media";
import { EMPTY_MEDIA_STATE } from "../types/media";

/**
 * En Android el layout ocupa la pantalla completa y algunas acciones del
 * sistema las resuelve un plugin Kotlin. Desde el frontend, en cualquier caso,
 * se llaman comandos Rust normales: en escritorio usan GSMTC y en Android
 * delegan en el plugin nativo.
 */
export const IS_ANDROID =
  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

// El backend devuelve los campos en snake_case (ej. artwork_data_url).
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
  // En Android FoYu solo conoce su propia reproducción.
  if (IS_ANDROID) return EMPTY_MEDIA_STATE;

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

export interface WidgetState {
  title: string;
  artist: string;
  artworkUrl: string | null;
  playing: boolean;
  tint: string;
  accent: string;
  positionMs: number;
  durationMs: number;
}

/** Actualiza los widgets de la pantalla de inicio de Android. */
export async function updateWidget(state: WidgetState): Promise<void> {
  await invoke("widget_update", { state });
}

export async function leaveApp(): Promise<void> {
  await invoke("leave_app");
}

/** Guarda un archivo de texto y devuelve false si se cancela. */
export async function saveTextFile(
  fileName: string,
  content: string,
  mimeType: string,
): Promise<boolean> {
  if (IS_ANDROID) {
    return invoke<boolean>("save_text_file", { fileName, content, mimeType });
  }

  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

export async function subscribeMediaUpdates(
  _cb: (state: MediaState) => void,
): Promise<() => void> {
  // El sondeo cada segundo de `useMediaSession` ya mantiene el estado al día.
  return () => {};
}

export { EMPTY_MEDIA_STATE };
