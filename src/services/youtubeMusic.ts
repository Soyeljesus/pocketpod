import { invoke } from "@tauri-apps/api/core";
import type {
  DiscoverChip,
  DiscoverItem,
  DiscoverPage,
  DiscoverShelf,
  MoodGroup,
  MoodItem,
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

export interface SearchSuggestions {
  queries: string[];
  tracks: YoutubeTrack[];
}

/** Sugerencias mientras se escribe: búsquedas y canciones que encajan. */
export async function suggestYoutubeMusic(
  query: string,
  signal?: AbortSignal,
): Promise<SearchSuggestions> {
  const info = await getBridgeInfo();
  if (!info.available) return { queries: [], tracks: [] };
  const params = new URLSearchParams({ q: query });
  const response = await fetch(
    `${info.baseUrl}/suggest?${params.toString()}&${authQuery(info)}`,
    { headers: { Accept: "application/json" }, signal },
  );
  if (!response.ok) return { queries: [], tracks: [] };
  const data = await response.json().catch(() => null);
  return {
    queries: (Array.isArray(data?.queries) ? data.queries : [])
      .map((item: unknown) => String(item))
      .filter(Boolean),
    tracks: (Array.isArray(data?.tracks) ? data.tracks : [])
      .map(normalizeTrack)
      .filter((track: YoutubeTrack) => track.videoId !== ""),
  };
}

/** Canciones parecidas a una dada, según YouTube Music. */
export async function fetchRadio(
  videoId: string,
  limit = 25,
): Promise<YoutubeTrack[]> {
  const info = await getBridgeInfo();
  if (!info.available) return [];
  const response = await fetch(
    `${info.baseUrl}/radio/${encodeURIComponent(videoId)}?limit=${limit}&${authQuery(info)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) return [];
  const data = await response.json().catch(() => null);
  if (!Array.isArray(data)) return [];
  return data.map(normalizeTrack).filter((track) => track.videoId !== "");
}

/** País para las listas de YouTube Music, tomado del idioma del dispositivo. */
function region(): string {
  const tag = navigator.language || "es-MX";
  const match = /[-_]([A-Za-z]{2})\b/.exec(tag);
  return (match?.[1] ?? "MX").toUpperCase();
}

function normalizeItem(raw: any): DiscoverItem | null {
  const kind = raw?.kind;
  if (kind !== "playlist" && kind !== "album" && kind !== "song" && kind !== "artist") {
    return null;
  }
  const id = String(raw?.id ?? "");
  if (!id) return null;
  return {
    kind,
    id,
    title: String(raw?.title ?? ""),
    subtitle: String(raw?.subtitle ?? ""),
    thumbnailUrl: raw?.thumbnailUrl ?? null,
    track: raw?.track ? normalizeTrack(raw.track) : null,
  };
}

async function bridgeJson(path: string, query: Record<string, string>) {
  const info = await getBridgeInfo();
  if (!info.available) throw new Error(info.message ?? "La música no está disponible");
  const params = new URLSearchParams({ ...query, gl: region() });
  const response = await fetch(
    `${info.baseUrl}${path}?${params.toString()}&${authQuery(info)}`,
    { headers: { Accept: "application/json" } },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? `El puente respondió ${response.status}`);
  return data;
}

/** Inicio de YouTube Music, o una categoría de ánimo o género. */
export async function fetchDiscover(
  target?: { browseId?: string; params?: string },
): Promise<DiscoverPage> {
  const query: Record<string, string> = {};
  if (target?.browseId) query.id = target.browseId;
  if (target?.params) query.params = target.params;
  const data = await bridgeJson("/discover", query);
  return {
    chips: (Array.isArray(data?.chips) ? data.chips : [])
      .map((chip: any) => ({ title: String(chip?.title ?? ""), params: String(chip?.params ?? "") }))
      .filter((chip: DiscoverChip) => chip.title && chip.params),
    shelves: (Array.isArray(data?.shelves) ? data.shelves : [])
      .map((shelf: any) => ({
        title: String(shelf?.title ?? ""),
        items: (Array.isArray(shelf?.items) ? shelf.items : [])
          .map(normalizeItem)
          .filter(Boolean) as DiscoverItem[],
      }))
      .filter((shelf: DiscoverShelf) => shelf.title && shelf.items.length > 0),
    header: data?.header?.title
      ? {
          title: String(data.header.title),
          thumbnailUrl:
            typeof data.header.thumbnailUrl === "string" ? data.header.thumbnailUrl : null,
        }
      : null,
  };
}

/** Busca el álbum o el artista de una canción. */
export async function lookupMusic(
  kind: "album" | "artist",
  query: string,
): Promise<DiscoverItem> {
  const data = await bridgeJson("/lookup", { kind, q: query });
  const item = normalizeItem(data);
  if (!item) throw new Error("No se encontró en YouTube Music");
  return item;
}

export async function fetchMoods(): Promise<MoodGroup[]> {
  const data = await bridgeJson("/moods", {});
  return (Array.isArray(data) ? data : [])
    .map((group: any) => ({
      title: String(group?.title ?? ""),
      items: (Array.isArray(group?.items) ? group.items : [])
        .map((item: any) => ({
          title: String(item?.title ?? ""),
          browseId: String(item?.browseId ?? ""),
          params: String(item?.params ?? ""),
          color: typeof item?.color === "string" ? item.color : null,
        }))
        .filter((item: MoodItem) => item.title && item.browseId && item.params),
    }))
    .filter((group: MoodGroup) => group.title && group.items.length > 0);
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
