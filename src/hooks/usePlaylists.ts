import { useCallback, useRef, useState } from "react";
import { normalizePlaylist } from "../services/librarySync";
import { fetchPlaylist } from "../services/youtubeMusic";
import type {
  ImportedCollection,
  ImportedPlaylist,
  SavedPlaylist,
  YoutubeList,
  YoutubeTrack,
} from "../types/youtube";

const PLAYLISTS_KEY = "pocketpod.playlists";
const DELETED_KEY = "pocketpod.playlists.deleted";
export const OWN_PLAYLIST_SOURCE = "Mi playlist";

export function looksLikeLink(text: string): boolean {
  const value = text.trim();
  return (
    /https?:\/\//i.test(value) ||
    /^(www\.|open\.spotify\.com\/|music\.apple\.com\/|deezer\.com\/)/i.test(value) ||
    /^(PL|OLAK5uy_|RDCLAK)[\w-]{10,}$/.test(value)
  );
}

function loadPlaylists(): SavedPlaylist[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePlaylist).filter(Boolean) as SavedPlaylist[];
  } catch {
    return [];
  }
}

function loadDeleted(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(DELETED_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveLibrary(
  playlists: SavedPlaylist[],
  deleted: Record<string, number>,
): boolean {
  try {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
    localStorage.setItem(DELETED_KEY, JSON.stringify(deleted));
    return true;
  } catch {
    return false;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameTracks(first: YoutubeTrack[], second: YoutubeTrack[]) {
  return (
    first.length === second.length &&
    first.every((track, index) => track.videoId === second[index].videoId)
  );
}

export interface UsePlaylistsResult {
  playlists: SavedPlaylist[];
  deleted: Record<string, number>;
  importing: boolean;
  error: string | null;
  notice: string | null;
  importFromLink: (link: string) => Promise<string | null>;
  saveImported: (playlist: ImportedPlaylist, title: string) => string;
  create: (name: string) => string | null;
  addTrack: (id: string, track: YoutubeTrack) => void;
  removeTrack: (id: string, videoId: string) => void;
  remove: (id: string) => void;
  mergeCollections: (collections: ImportedCollection[]) => void;
  replaceAll: (
    playlists: SavedPlaylist[],
    deleted: Record<string, number>,
  ) => void;
  applyYoutubeLists: (lists: YoutubeList[]) => void;
}

export function usePlaylists(): UsePlaylistsResult {
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>(loadPlaylists);
  const [deleted, setDeleted] = useState<Record<string, number>>(loadDeleted);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const playlistsRef = useRef(playlists);
  const deletedRef = useRef(deleted);
  const importingRef = useRef(false);

  const commit = useCallback(
    (next: SavedPlaylist[], nextDeleted = deletedRef.current) => {
      playlistsRef.current = next;
      deletedRef.current = nextDeleted;
      setPlaylists(next);
      setDeleted(nextDeleted);
      if (!saveLibrary(next, nextDeleted)) {
        setError("No hay espacio para guardar las playlists en este dispositivo");
      }
    },
    [],
  );

  const withoutTombstone = useCallback((id: string) => {
    const { [id]: _removed, ...rest } = deletedRef.current;
    return rest;
  }, []);

  const importFromLink = useCallback(
    async (link: string) => {
      const text = link.trim();
      if (!text || importingRef.current) return null;

      importingRef.current = true;
      setImporting(true);
      setError(null);
      setNotice(null);

      try {
        const playlist = await fetchPlaylist(text);
        const now = Date.now();
        commit(
          [
            {
              id: playlist.id,
              title: playlist.title,
              source: playlist.source,
              sourceLink: text,
              tracks: playlist.tracks,
              importedAt: now,
              updatedAt: now,
              youtubeSynced: false,
            },
            ...playlistsRef.current.filter((item) => item.id !== playlist.id),
          ],
          withoutTombstone(playlist.id),
        );
        if (playlist.skipped > 0) {
          setNotice(
            `${playlist.skipped} ${
              playlist.skipped === 1 ? "canción no se encontró" : "canciones no se encontraron"
            } en YouTube Music`,
          );
        }
        return playlist.id;
      } catch (err) {
        setError(describeError(err));
        return null;
      } finally {
        importingRef.current = false;
        setImporting(false);
      }
    },
    [commit, withoutTombstone],
  );

  /** Guarda en la biblioteca una playlist que ya se abrió desde Inicio. */
  const saveImported = useCallback(
    (playlist: ImportedPlaylist, title: string) => {
      const now = Date.now();
      commit(
        [
          {
            id: playlist.id,
            title: title || playlist.title,
            source: playlist.source,
            sourceLink: `https://music.youtube.com/playlist?list=${playlist.id}`,
            tracks: playlist.tracks,
            importedAt: now,
            updatedAt: now,
            youtubeSynced: false,
          },
          ...playlistsRef.current.filter((item) => item.id !== playlist.id),
        ],
        withoutTombstone(playlist.id),
      );
      return playlist.id;
    },
    [commit, withoutTombstone],
  );

  const create = useCallback(
    (name: string) => {
      const title = name.trim();
      if (!title) return null;

      const now = Date.now();
      const id = `local:${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      setError(null);
      setNotice(null);
      commit([
        {
          id,
          title,
          source: OWN_PLAYLIST_SOURCE,
          sourceLink: null,
          tracks: [],
          importedAt: now,
          updatedAt: now,
          youtubeSynced: false,
        },
        ...playlistsRef.current,
      ]);
      return id;
    },
    [commit],
  );

  const addTrack = useCallback(
    (id: string, track: YoutubeTrack) => {
      commit(
        playlistsRef.current.map((item) =>
          item.id === id &&
          !item.tracks.some((entry) => entry.videoId === track.videoId)
            ? { ...item, tracks: [...item.tracks, track], updatedAt: Date.now() }
            : item,
        ),
      );
    },
    [commit],
  );

  const removeTrack = useCallback(
    (id: string, videoId: string) => {
      commit(
        playlistsRef.current.map((item) =>
          item.id === id
            ? {
                ...item,
                tracks: item.tracks.filter((entry) => entry.videoId !== videoId),
                updatedAt: Date.now(),
              }
            : item,
        ),
      );
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      setError(null);
      setNotice(null);
      commit(
        playlistsRef.current.filter((item) => item.id !== id),
        { ...deletedRef.current, [id]: Date.now() },
      );
    },
    [commit],
  );

  // Importar nunca borra: las canciones nuevas se suman a las que ya existen.
  const mergeCollections = useCallback(
    (collections: ImportedCollection[]) => {
      const next = [...playlistsRef.current];
      let nextDeleted = deletedRef.current;
      const now = Date.now();
      for (const collection of collections) {
        if (collection.kind !== "playlist") continue;
        const { [collection.id]: _removed, ...rest } = nextDeleted;
        nextDeleted = rest;
        const index = next.findIndex((item) => item.id === collection.id);
        if (index < 0) {
          next.unshift({
            id: collection.id,
            title: collection.name,
            source: collection.source,
            sourceLink: collection.sourceLink,
            tracks: collection.tracks,
            importedAt: now,
            updatedAt: now,
            youtubeSynced: false,
          });
          continue;
        }
        const known = new Set(next[index].tracks.map((item) => item.videoId));
        next[index] = {
          ...next[index],
          tracks: [
            ...next[index].tracks,
            ...collection.tracks.filter((item) => !known.has(item.videoId)),
          ],
          updatedAt: now,
        };
      }
      setError(null);
      setNotice(null);
      commit(next, nextDeleted);
    },
    [commit],
  );

  const replaceAll = useCallback(
    (nextPlaylists: SavedPlaylist[], nextDeleted: Record<string, number>) => {
      commit(nextPlaylists, nextDeleted);
    },
    [commit],
  );

  /** YouTube Music manda en sus listas; las demás no se tocan. */
  const applyYoutubeLists = useCallback(
    (lists: YoutubeList[]) => {
      const now = Date.now();
      const incoming = new Map(lists.map((list) => [list.id, list]));
      const nextDeleted = { ...deletedRef.current };
      const next: SavedPlaylist[] = [];

      for (const item of playlistsRef.current) {
        const list = incoming.get(item.id);
        if (list) {
          incoming.delete(item.id);
          const changed =
            item.title !== list.title || !sameTracks(item.tracks, list.tracks);
          next.push({
            ...item,
            title: list.title,
            tracks: list.tracks,
            source: "YouTube Music",
            sourceLink: list.id,
            youtubeSynced: true,
            updatedAt: changed || !item.youtubeSynced ? now : item.updatedAt,
          });
        } else if (item.youtubeSynced) {
          nextDeleted[item.id] = now;
        } else {
          next.push(item);
        }
      }

      for (const list of incoming.values()) {
        delete nextDeleted[list.id];
        next.push({
          id: list.id,
          title: list.title,
          source: "YouTube Music",
          sourceLink: list.id,
          tracks: list.tracks,
          importedAt: now,
          updatedAt: now,
          youtubeSynced: true,
        });
      }
      commit(next, nextDeleted);
    },
    [commit],
  );

  return {
    playlists,
    deleted,
    importing,
    error,
    notice,
    importFromLink,
    saveImported,
    create,
    addTrack,
    removeTrack,
    remove,
    mergeCollections,
    replaceAll,
    applyYoutubeLists,
  };
}
