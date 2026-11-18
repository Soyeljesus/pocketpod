import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaState } from "../types/media";
import type {
  MusicBridgeInfo,
  OfflineTrack,
  YoutubeTrack,
} from "../types/youtube";
import {
  downloadTrack as requestDownload,
  getBridgeInfo,
  getOfflineStreamUrl,
  getStreamUrl,
  listDownloads,
  removeDownload as requestRemoveDownload,
  searchYoutubeMusic,
} from "../services/youtubeMusic";

type PlaybackStatus = "playing" | "paused" | "stopped";

const LIKES_KEY = "pocketpod.youtube.likes";
const LIKES_UPDATED_KEY = "pocketpod.youtube.likes.updatedAt";

function describeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Los "me gusta" son locales: no hay cuenta de YouTube ni backend remoto. */
function loadLikes(): YoutubeTrack[] {
  try {
    const raw = localStorage.getItem(LIKES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item) =>
          item && typeof item.videoId === "string" && item.videoId !== "",
      )
      .map((item) => ({
        videoId: String(item.videoId),
        title: String(item.title ?? ""),
        artist: String(item.artist ?? ""),
        album: String(item.album ?? ""),
        durationSec: Number(item.durationSec ?? 0) || 0,
        thumbnailUrl: item.thumbnailUrl ?? null,
      }));
  } catch {
    return [];
  }
}

function loadLikesUpdatedAt(): number {
  try {
    return Number(localStorage.getItem(LIKES_UPDATED_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function saveLikes(likes: YoutubeTrack[], updatedAt: number) {
  try {
    localStorage.setItem(LIKES_KEY, JSON.stringify(likes));
    localStorage.setItem(LIKES_UPDATED_KEY, String(updatedAt));
  } catch {
    // Si localStorage no está disponible, los likes viven solo en memoria.
  }
}

export interface UseYoutubeMusicResult {
  /** Estado con la misma forma que el de Spotify/Apple Music. */
  state: MediaState;
  positionSec: number;
  current: YoutubeTrack | null;
  queue: YoutubeTrack[];
  results: YoutubeTrack[];
  query: string;
  searching: boolean;
  loading: boolean;
  error: string | null;
  available: boolean;
  unavailableReason: string | null;
  engine: string | null;
  likes: YoutubeTrack[];
  likesUpdatedAt: number;
  downloads: OfflineTrack[];
  downloadingId: string | null;
  downloadError: string | null;
  shuffle: boolean;
  repeat: boolean;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  setQuery: (query: string) => void;
  search: () => Promise<void>;
  playTrack: (track: YoutubeTrack, queue?: YoutubeTrack[]) => Promise<void>;
  playPause: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  pause: () => void;
  toggleLike: (track: YoutubeTrack) => void;
  addLikes: (tracks: YoutubeTrack[]) => void;
  replaceLikes: (tracks: YoutubeTrack[], updatedAt: number) => void;
  download: (track: YoutubeTrack) => void;
  removeDownload: (videoId: string) => void;
}

/**
 * Reproduce YouTube Music dentro del WebView usando un `<audio>` normal.
 *
 * El `src` no apunta a YouTube directamente: apunta al puente local
 * (`/stream/{videoId}`), que añade el token, reenvía el `Range` al CDN y evita
 * problemas de CORS o de URLs caducadas.
 */
export function useYoutubeMusic(): UseYoutubeMusicResult {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef(0);
  const currentRef = useRef<YoutubeTrack | null>(null);
  const queueRef = useRef<YoutubeTrack[]>([]);
  const resultsRef = useRef<YoutubeTrack[]>([]);
  const downloadsRef = useRef<OfflineTrack[]>([]);
  const nextRef = useRef<() => void>(() => {});
  const shuffleRef = useRef(false);
  const repeatRef = useRef(false);

  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [current, setCurrent] = useState<YoutubeTrack | null>(null);
  const [queue, setQueue] = useState<YoutubeTrack[]>([]);
  const [results, setResults] = useState<YoutubeTrack[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>("stopped");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bridge, setBridge] = useState<MusicBridgeInfo | null>(null);
  const [likes, setLikes] = useState<YoutubeTrack[]>(loadLikes);
  const [likesUpdatedAt, setLikesUpdatedAt] = useState(loadLikesUpdatedAt);
  const likesRef = useRef(likes);
  const [downloads, setDownloads] = useState<OfflineTrack[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const getAudio = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;

    const audio = new Audio();
    audio.preload = "auto";

    audio.addEventListener("play", () => setStatus("playing"));
    audio.addEventListener("pause", () => setStatus("paused"));
    audio.addEventListener("ended", () => {
      if (repeatRef.current) {
        audio.currentTime = 0;
        void audio.play().catch(() => nextRef.current());
      } else {
        nextRef.current();
      }
    });
    audio.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    });
    audio.addEventListener("error", () => {
      // Solo es un error real si había una pista cargada.
      if (audio.currentSrc) {
        setError("No se pudo reproducir el audio. Prueba con otra canción.");
        setStatus("stopped");
      }
    });

    audioRef.current = audio;
    return audio;
  }, []);

  // Disponibilidad del puente local.
  useEffect(() => {
    let alive = true;
    getBridgeInfo()
      .then((info) => {
        if (alive) setBridge(info);
      })
      .catch((err) => {
        if (!alive) return;
        setBridge({
          baseUrl: "",
          token: "",
          engine: "none",
          available: false,
          message: describeError(err),
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  // La barra de progreso lee currentTime 4 veces por segundo mientras suena.
  useEffect(() => {
    if (status !== "playing") return;
    const id = window.setInterval(() => {
      const audio = audioRef.current;
      if (audio) setPosition(audio.currentTime || 0);
    }, 250);
    return () => window.clearInterval(id);
  }, [status]);

  // Descargas persistidas en disco por Rust: se cargan al arrancar y cada vez
  // que se descarga o se borra una canción.
  const refreshDownloads = useCallback(async () => {
    try {
      const list = await listDownloads();
      downloadsRef.current = list;
      setDownloads(list);
    } catch {
      // Sin puente (o sin carpeta de datos) la sección queda vacía.
    }
  }, []);

  useEffect(() => {
    void refreshDownloads();
  }, [refreshDownloads]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const playTrack = useCallback(
    async (track: YoutubeTrack, nextQueue?: YoutubeTrack[]) => {
      const request = ++requestRef.current;

      setError(null);
      setCurrent(track);
      currentRef.current = track;
      setPosition(0);
      setDuration(track.durationSec || 0);
      setStatus("stopped");
      setLoading(true);

      if (nextQueue) {
        setQueue(nextQueue);
        queueRef.current = nextQueue;
      }

      try {
        // Si la canción está descargada, se sirve desde el disco: así suena
        // igual sin conexión y no depende de que la URL de YouTube siga viva.
        const offline = downloadsRef.current.some(
          (item) => item.videoId === track.videoId,
        );
        const src = offline
          ? await getOfflineStreamUrl(track.videoId)
          : await getStreamUrl(track.videoId);
        if (request !== requestRef.current) return;

        const audio = getAudio();
        audio.src = src;
        audio.load();
        await audio.play();
      } catch (err) {
        if (request !== requestRef.current) return;
        setError(describeError(err));
        setStatus("stopped");
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [getAudio],
  );

  const next = useCallback(() => {
    const list = queueRef.current;
    if (list.length === 0) return;

    const currentId = currentRef.current?.videoId;
    const index = list.findIndex((track) => track.videoId === currentId);
    let followingIndex = index >= 0 ? (index + 1) % list.length : 0;
    if (shuffleRef.current && list.length > 1) {
      const offset = 1 + Math.floor(Math.random() * (list.length - 1));
      followingIndex = (Math.max(index, 0) + offset) % list.length;
    }
    void playTrack(list[followingIndex]);
  }, [playTrack]);

  const toggleShuffle = useCallback(() => {
    shuffleRef.current = !shuffleRef.current;
    setShuffle(shuffleRef.current);
  }, []);

  const toggleRepeat = useCallback(() => {
    repeatRef.current = !repeatRef.current;
    setRepeat(repeatRef.current);
  }, []);

  useEffect(() => {
    nextRef.current = next;
  }, [next]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setPosition(0);
      return;
    }

    const list = queueRef.current;
    if (list.length === 0) return;

    const currentId = currentRef.current?.videoId;
    const index = list.findIndex((track) => track.videoId === currentId);
    const before = index > 0 ? list[index - 1] : list[list.length - 1];
    void playTrack(before);
  }, [playTrack]);

  const playPause = useCallback(() => {
    const audio = getAudio();

    if (!currentRef.current) {
      const first = resultsRef.current[0] ?? queueRef.current[0];
      if (first) {
        void playTrack(
          first,
          resultsRef.current.length > 0 ? resultsRef.current : queueRef.current,
        );
      }
      return;
    }

    if (audio.paused) {
      void audio.play().catch((err) => setError(describeError(err)));
    } else {
      audio.pause();
    }
  }, [getAudio, playTrack]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const commitLikes = useCallback(
    (next: YoutubeTrack[], updatedAt = Date.now()) => {
      likesRef.current = next;
      setLikes(next);
      setLikesUpdatedAt(updatedAt);
      saveLikes(next, updatedAt);
    },
    [],
  );

  const toggleLike = useCallback(
    (track: YoutubeTrack) => {
      const previous = likesRef.current;
      const exists = previous.some((item) => item.videoId === track.videoId);
      commitLikes(
        exists
          ? previous.filter((item) => item.videoId !== track.videoId)
          : [track, ...previous],
      );
    },
    [commitLikes],
  );

  const addLikes = useCallback(
    (tracks: YoutubeTrack[]) => {
      const previous = likesRef.current;
      const known = new Set(previous.map((item) => item.videoId));
      const fresh = tracks.filter((track) => !known.has(track.videoId));
      if (fresh.length > 0) commitLikes([...previous, ...fresh]);
    },
    [commitLikes],
  );

  const download = useCallback(
    (track: YoutubeTrack) => {
      if (
        downloadingId === track.videoId ||
        downloadsRef.current.some((item) => item.videoId === track.videoId)
      ) {
        return;
      }

      setDownloadError(null);
      setDownloadingId(track.videoId);
      requestDownload(track)
        .then(() => refreshDownloads())
        .catch((err) => setDownloadError(describeError(err)))
        .finally(() => setDownloadingId(null));
    },
    [downloadingId, refreshDownloads],
  );

  const removeDownload = useCallback(
    (videoId: string) => {
      setDownloadError(null);
      requestRemoveDownload(videoId)
        .then(() => refreshDownloads())
        .catch((err) => setDownloadError(describeError(err)));
    },
    [refreshDownloads],
  );

  const seek = useCallback(
    (seconds: number) => {
      const audio = getAudio();
      if (!currentRef.current || !Number.isFinite(seconds)) return;
      audio.currentTime = Math.max(0, seconds);
      setPosition(audio.currentTime);
    },
    [getAudio],
  );

  const search = useCallback(async () => {
    const text = query.trim();
    if (!text) return;

    setSearching(true);
    setError(null);

    try {
      const tracks = await searchYoutubeMusic(text, 20);
      setResults(tracks);
      resultsRef.current = tracks;
      if (tracks.length === 0) setError("Sin resultados para esa búsqueda");
    } catch (err) {
      setError(describeError(err));
      setResults([]);
      resultsRef.current = [];
    } finally {
      setSearching(false);
    }
  }, [query]);

  const state = useMemo<MediaState>(() => {
    const connected = current !== null;
    const effectiveStatus: MediaState["status"] = !current
      ? "unknown"
      : status === "playing"
        ? "playing"
        : status === "paused"
          ? "paused"
          : "stopped";

    return {
      title: current?.title ?? "",
      artist: current?.artist ?? "",
      album: current?.album || "YouTube Music",
      artworkDataUrl: current?.thumbnailUrl ?? null,
      status: effectiveStatus,
      positionSec: position,
      durationSec: duration || current?.durationSec || 0,
      canSeek: connected,
      connected,
      sourceAppId: "youtube-music",
    };
  }, [current, status, position, duration]);

  return {
    state,
    positionSec: position,
    current,
    queue,
    results,
    query,
    searching,
    loading,
    error,
    available: bridge?.available ?? true,
    unavailableReason: bridge?.message ?? null,
    engine: bridge?.engine ?? null,
    likes,
    likesUpdatedAt,
    downloads,
    downloadingId,
    downloadError,
    shuffle,
    repeat,
    toggleShuffle,
    toggleRepeat,
    setQuery,
    search,
    playTrack,
    playPause,
    next,
    previous,
    seek,
    pause,
    toggleLike,
    addLikes,
    replaceLikes: commitLikes,
    download,
    removeDownload,
  };
}
