import type { SavedPlaylist, YoutubeTrack } from "../types/youtube";
import { normalizeTrack } from "./youtubeMusic";

const TOMBSTONE_DAYS = 90;

export interface LibrarySnapshot {
  version: 1;
  playlists: SavedPlaylist[];
  /** Playlists borradas y cuándo, para que no reaparezcan desde otro equipo. */
  deleted: Record<string, number>;
  likes: YoutubeTrack[];
  likesUpdatedAt: number;
}

/**
 * first: primera vez de esta cuenta en el equipo; se conserva lo de ambos lados.
 * sync: gana el cambio más reciente de cada playlist.
 * replace: el equipo traía datos de otra cuenta; no se mezclan.
 */
export type MergeMode = "first" | "sync" | "replace";

function validTracks(value: unknown): YoutubeTrack[] {
  return (Array.isArray(value) ? value : [])
    .map(normalizeTrack)
    .filter((track) => track.videoId !== "");
}

export function normalizePlaylist(item: any): SavedPlaylist | null {
  if (!item || typeof item.id !== "string" || item.id === "") return null;
  const importedAt = Number(item.importedAt ?? 0) || 0;
  return {
    id: item.id,
    title: String(item.title ?? "Playlist"),
    source: String(item.source ?? "YouTube Music"),
    sourceLink:
      typeof item.sourceLink === "string"
        ? item.sourceLink
        : item.sourceLink === null || item.id.startsWith("local:")
          ? null
          : item.id,
    tracks: validTracks(item.tracks),
    importedAt,
    updatedAt: Number(item.updatedAt ?? importedAt) || 0,
    youtubeSynced: item.youtubeSynced === true,
  };
}

export function parseSnapshot(value: unknown): LibrarySnapshot {
  const data = value as any;
  if (data?.version !== 1) throw new Error("cloud_invalid_data");

  const deleted: Record<string, number> = {};
  for (const [id, time] of Object.entries(data.deleted ?? {})) {
    if (typeof time === "number" && Number.isFinite(time)) deleted[id] = time;
  }
  return {
    version: 1,
    playlists: (Array.isArray(data.playlists) ? data.playlists : [])
      .map(normalizePlaylist)
      .filter(Boolean) as SavedPlaylist[],
    deleted,
    likes: validTracks(data.likes),
    likesUpdatedAt: Number(data.likesUpdatedAt ?? 0) || 0,
  };
}

/** JSON estable: dos bibliotecas iguales producen exactamente el mismo texto. */
export function serializeSnapshot(snapshot: LibrarySnapshot): string {
  return JSON.stringify({
    version: 1,
    playlists: [...snapshot.playlists].sort((a, b) => a.id.localeCompare(b.id)),
    deleted: Object.fromEntries(
      Object.entries(snapshot.deleted).sort(([a], [b]) => a.localeCompare(b)),
    ),
    likes: snapshot.likes,
    likesUpdatedAt: snapshot.likesUpdatedAt,
  });
}

function unionTracks(first: YoutubeTrack[], second: YoutubeTrack[]) {
  const known = new Set(first.map((track) => track.videoId));
  return [...first, ...second.filter((track) => !known.has(track.videoId))];
}

export function mergeSnapshots(
  local: LibrarySnapshot,
  remote: LibrarySnapshot | null,
  mode: MergeMode,
  now = Date.now(),
): LibrarySnapshot {
  if (mode === "replace") {
    return (
      remote ?? {
        version: 1,
        playlists: [],
        deleted: {},
        likes: [],
        likesUpdatedAt: 0,
      }
    );
  }
  if (!remote) return local;

  const oldest = now - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
  const deleted: Record<string, number> = {};
  for (const source of [local.deleted, remote.deleted]) {
    for (const [id, time] of Object.entries(source)) {
      if (time >= oldest) deleted[id] = Math.max(deleted[id] ?? 0, time);
    }
  }

  const localById = new Map(local.playlists.map((item) => [item.id, item]));
  const remoteById = new Map(remote.playlists.map((item) => [item.id, item]));
  const playlists: SavedPlaylist[] = [];

  for (const id of new Set([...localById.keys(), ...remoteById.keys()])) {
    const mine = localById.get(id);
    const theirs = remoteById.get(id);
    let chosen = mine ?? theirs;
    if (mine && theirs) {
      const newest = theirs.updatedAt > mine.updatedAt ? theirs : mine;
      chosen =
        mode === "first"
          ? {
              ...newest,
              tracks: unionTracks(newest.tracks, mine === newest ? theirs.tracks : mine.tracks),
            }
          : newest;
    }
    if (!chosen) continue;
    if (chosen.updatedAt > (deleted[id] ?? 0)) {
      delete deleted[id];
      playlists.push(chosen);
    }
  }
  playlists.sort((a, b) => b.importedAt - a.importedAt);

  const likes =
    mode === "first"
      ? unionTracks(local.likes, remote.likes)
      : remote.likesUpdatedAt > local.likesUpdatedAt
        ? remote.likes
        : local.likes;

  return {
    version: 1,
    playlists,
    deleted,
    likes,
    likesUpdatedAt: Math.max(local.likesUpdatedAt, remote.likesUpdatedAt),
  };
}
