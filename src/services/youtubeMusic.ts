import { invoke } from "@tauri-apps/api/core";
import type {
  ImportedCollection,
  ImportedPlaylist,
  LibraryImportResult,
  MusicBridgeInfo,
  OfflineTrack,
  SavedPlaylist,
  YoutubeTrack,
} from "../types/youtube";

/**
 * Cliente del puente local de música.
 *
 * El backend Rust arranca un servidor en 127.0.0.1 con un puerto efímero y un
 * token. El token viaja en la query porque un `<audio>` no puede añadir
 * cabeceras a su petición.
 */
let bridgePromise: Promise<MusicBridgeInfo> | null = null;

function describeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function getBridgeInfo(): Promise<MusicBridgeInfo> {
  if (!bridgePromise) {
    bridgePromise = invoke<MusicBridgeInfo>("music_bridge_info").catch((error) => {
      bridgePromise = null;
      throw new Error(describeError(error));
    });
  }
  return bridgePromise;
}

function authQuery(info: MusicBridgeInfo): string {
  return `t=${encodeURIComponent(info.token)}`;
}

export function normalizeTrack(raw: any): YoutubeTrack {
  return {
    videoId: String(raw?.videoId ?? raw?.video_id ?? ""),
    title: String(raw?.title ?? ""),
    artist: String(raw?.artist ?? ""),
    album: String(raw?.album ?? ""),
    durationSec: Number(raw?.durationSec ?? raw?.duration_sec ?? 0) || 0,
    thumbnailUrl: raw?.thumbnailUrl ?? raw?.thumbnail_url ?? null,
  };
}

export async function searchYoutubeMusic(
  query: string,
  limit = 20,
): Promise<YoutubeTrack[]> {
  const info = await getBridgeInfo();
  if (!info.available) {
    throw new Error(info.message ?? "YouTube Music no está disponible");
  }

  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });
  const url = `${info.baseUrl}/search?${params.toString()}&${authQuery(info)}`;

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? `El puente respondió ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.map(normalizeTrack).filter((track) => track.videoId !== "");
}

/** Lee una playlist pública de YouTube Music, Spotify, Apple Music, Deezer u otra web. */
export async function fetchPlaylist(link: string): Promise<ImportedPlaylist> {
  const info = await getBridgeInfo();
  if (!info.available) {
    throw new Error(info.message ?? "YouTube Music no está disponible");
  }

  const params = new URLSearchParams({ link });
  const response = await fetch(
    `${info.baseUrl}/playlist?${params.toString()}&${authQuery(info)}`,
    { headers: { Accept: "application/json" } },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? `El puente respondió ${response.status}`);
  }

  return {
    id: String(data?.id ?? ""),
    title: String(data?.title ?? "Playlist importada"),
    source: String(data?.source ?? "Enlace"),
    skipped: Number(data?.skipped ?? 0) || 0,
    tracks: (Array.isArray(data?.tracks) ? data.tracks : [])
      .map(normalizeTrack)
      .filter((track: YoutubeTrack) => track.videoId !== ""),
  };
}

async function postLibrary(path: string, body: unknown): Promise<Response> {
  const info = await getBridgeInfo();
  if (!info.available) {
    throw new Error(info.message ?? "La música no está disponible");
  }
  const response = await fetch(`${info.baseUrl}${path}?${authQuery(info)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? `El puente respondió ${response.status}`);
  }
  return response;
}

export async function exportLibraryCsv(library: {
  playlists: SavedPlaylist[];
  likes: YoutubeTrack[];
  downloads: YoutubeTrack[];
}): Promise<string> {
  const response = await postLibrary("/library/export", library);
  return response.text();
}

export async function importLibraryFile(
  fileName: string,
  content: string,
): Promise<LibraryImportResult> {
  const response = await postLibrary("/library/import", { fileName, content });
  const data = await response.json();
  return {
    imported: Number(data?.imported ?? 0) || 0,
    skipped: Number(data?.skipped ?? 0) || 0,
    collections: (Array.isArray(data?.collections) ? data.collections : []).map(
      (item: any): ImportedCollection => ({
        id: String(item?.id ?? ""),
        name: String(item?.name ?? "Playlist importada"),
        kind: item?.kind === "likes" ? "likes" : "playlist",
        source: String(item?.source ?? "Archivo"),
        sourceLink: item?.sourceLink ?? null,
        tracks: (Array.isArray(item?.tracks) ? item.tracks : []).map(normalizeTrack),
      }),
    ),
  };
}

/** URL que se asigna directamente al elemento `<audio>`. */
export async function getStreamUrl(videoId: string): Promise<string> {
  const info = await getBridgeInfo();
  if (!info.available) {
    throw new Error(info.message ?? "YouTube Music no está disponible");
  }
  return `${info.baseUrl}/stream/${encodeURIComponent(videoId)}?${authQuery(info)}`;
}

function normalizeOffline(raw: any): OfflineTrack {
  return {
    ...normalizeTrack(raw),
    fileName: String(raw?.fileName ?? raw?.file_name ?? ""),
    mimeType: String(raw?.mimeType ?? raw?.mime_type ?? ""),
    sizeBytes: Number(raw?.sizeBytes ?? raw?.size_bytes ?? 0) || 0,
    downloadedAt: Number(raw?.downloadedAt ?? raw?.downloaded_at ?? 0) || 0,
  };
}

async function offlineRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const info = await getBridgeInfo();
  if (!info.available) {
    throw new Error(info.message ?? "YouTube Music no está disponible");
  }

  const response = await fetch(
    `${info.baseUrl}${path}?${authQuery(info)}`,
    init,
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(
      detail?.error ?? `El puente respondió ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

/** Lista de canciones descargadas (persistida por Rust en disco). */
export async function listDownloads(): Promise<OfflineTrack[]> {
  const data = await offlineRequest<unknown>("/offline");
  if (!Array.isArray(data)) return [];
  return data.map(normalizeOffline).filter((track) => track.videoId !== "");
}

/** Descarga una canción completa al almacenamiento privado de la app. */
export async function downloadTrack(
  track: YoutubeTrack,
): Promise<OfflineTrack> {
  const data = await offlineRequest<unknown>(
    `/download/${encodeURIComponent(track.videoId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(track),
    },
  );
  return normalizeOffline(data);
}

/** Borra una descarga del disco y del índice. */
export async function removeDownload(videoId: string): Promise<void> {
  await offlineRequest<unknown>(`/offline/${encodeURIComponent(videoId)}`, {
    method: "DELETE",
  });
}

/** URL local de una canción descargada; funciona sin conexión. */
export async function getOfflineStreamUrl(videoId: string): Promise<string> {
  const info = await getBridgeInfo();
  if (!info.available) {
    throw new Error(info.message ?? "YouTube Music no está disponible");
  }
  return `${info.baseUrl}/offline/${encodeURIComponent(videoId)}?${authQuery(
    info,
  )}`;
}
