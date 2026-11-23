import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaState } from "../types/media";
import type {
  MusicBridgeInfo,
  OfflineTrack,
  QueueItem,
  ShuffleMode,
  YoutubeTrack,
} from "../types/youtube";
import {
  downloadTrack as requestDownload,
  fetchRadio,
  getBridgeInfo,
  getOfflineStreamUrl,
  getStreamUrl,
  listDownloads,
  removeDownload as requestRemoveDownload,
  searchYoutubeMusic,
  suggestYoutubeMusic,
} from "../services/youtubeMusic";
import type { SearchSuggestions } from "../services/youtubeMusic";

type PlaybackStatus = "playing" | "paused" | "stopped";

const LIKES_KEY = "pocketpod.youtube.likes";
const LIKES_UPDATED_KEY = "pocketpod.youtube.likes.updatedAt";
/** En aleatorio inteligente suena una recomendación cada 3 canciones. */
const SMART_EVERY = 3;
const SMART_SEEDS = 4;
const VOLUME_KEY = "foyu.volume";
const HISTORY_KEY = "foyu.history";
const PLAYED_LIMIT = 60;

/** Lo último que escuchaste, solo en este dispositivo. */
function loadPlayed(): YoutubeTrack[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter((item) => item && typeof item.videoId === "string" && item.videoId)
          .slice(0, PLAYED_LIMIT)
      : [];
  } catch {
    return [];
  }
}
const UP_NEXT_LIMIT = 60;
const HISTORY_LIMIT = 100;
const SUGGEST_DELAY_MS = 180;
const LIVE_SEARCH_DELAY_MS = 550;
const EMPTY_SUGGESTIONS: SearchSuggestions = { queries: [], tracks: [] };

function describeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/** Los "me gusta" se guardan en el dispositivo y, con cuenta, en la nube. */
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
  /** Lista desde la que se está reproduciendo. */
  queue: YoutubeTrack[];
  /** Lo que sonará después, en orden. */
  upNext: QueueItem[];
  results: YoutubeTrack[];
  suggestions: SearchSuggestions;
  query: string;
  searching: boolean;
  loading: boolean;
  error: string | null;
  available: boolean;
  unavailableReason: string | null;
  engine: string | null;
  likes: YoutubeTrack[];
  likesUpdatedAt: number;
  /** Lo último que sonó, más reciente primero. */
  played: YoutubeTrack[];
  downloads: OfflineTrack[];
  downloadingId: string | null;
  downloadError: string | null;
  shuffleMode: ShuffleMode;
  smartLoading: boolean;
  repeat: boolean;
  cycleShuffle: () => void;
  setShuffleMode: (mode: ShuffleMode) => void;
  toggleRepeat: () => void;
  setQuery: (query: string) => void;
  search: (text?: string) => Promise<void>;
  playTrack: (track: YoutubeTrack, queue?: YoutubeTrack[]) => Promise<void>;
  playCollection: (list: YoutubeTrack[], mode: ShuffleMode) => void;
  addToQueue: (track: YoutubeTrack) => void;
  playNext: (track: YoutubeTrack) => void;
  removeFromQueue: (item: QueueItem) => void;
  jumpTo: (item: QueueItem) => void;
  playPause: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  volume: number;
  setVolume: (volume: number) => void;
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
 *
 * La cola tiene tres partes: lo añadido a mano (suena primero), la lista
 * desde la que se pulsó (en orden o mezclada) y, en aleatorio inteligente,
 * una recomendación cada 3 canciones. Las recomendaciones se buscan siempre a
 * partir de la lista donde se activó, no de la última recomendación.
 */
export function useYoutubeMusic(): UseYoutubeMusicResult {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef(0);
  const currentRef = useRef<YoutubeTrack | null>(null);
  const contextRef = useRef<YoutubeTrack[]>([]);
  const orderRef = useRef<YoutubeTrack[]>([]);
  const posRef = useRef(-1);
  const manualRef = useRef<YoutubeTrack[]>([]);
  const historyRef = useRef<YoutubeTrack[]>([]);
  const smartPoolRef = useRef<YoutubeTrack[]>([]);
  const smartPlayedRef = useRef<Set<string>>(new Set());
  const sinceSmartRef = useRef(0);
  const smartGenerationRef = useRef(0);
  const smartBusyRef = useRef(false);
  const resultsRef = useRef<YoutubeTrack[]>([]);
  const downloadsRef = useRef<OfflineTrack[]>([]);
  const nextRef = useRef<() => void>(() => {});
  const shuffleRef = useRef<ShuffleMode>("off");
  const repeatRef = useRef(false);
  const searchRequestRef = useRef(0);
  const lastSearchedRef = useRef("");

  const [shuffleMode, setShuffleState] = useState<ShuffleMode>("off");
  const [smartLoading, setSmartLoading] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [current, setCurrent] = useState<YoutubeTrack | null>(null);
  const [queue, setQueue] = useState<YoutubeTrack[]>([]);
  const [upNext, setUpNext] = useState<QueueItem[]>([]);
  const [results, setResults] = useState<YoutubeTrack[]>([]);
  const [suggestions, setSuggestions] =
    useState<SearchSuggestions>(EMPTY_SUGGESTIONS);
  const [query, setQueryState] = useState("");
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
  const [played, setPlayed] = useState<YoutubeTrack[]>(loadPlayed);
  const [downloads, setDownloads] = useState<OfflineTrack[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [volume, setVolumeState] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(VOLUME_KEY));
      return Number.isFinite(saved) && localStorage.getItem(VOLUME_KEY) !== null
        ? Math.min(1, Math.max(0, saved))
        : 1;
    } catch {
      return 1;
    }
  });
  const volumeRef = useRef(volume);

  const getAudio = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;

    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = volumeRef.current;

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

  /** Recalcula lo que sonará después con las mismas reglas que `next`. */
  const refreshUpNext = useCallback(() => {
    const items: QueueItem[] = manualRef.current.map((track, index) => ({
      track,
      kind: "manual",
      index,
    }));
    const order = orderRef.current;
    const smart = shuffleRef.current === "smart";
    let since = sinceSmartRef.current;
    let smartIndex = 0;
    let pos = posRef.current;
    let steps = 0;

    while (items.length < UP_NEXT_LIMIT && order.length > 0) {
      if (
        smart &&
        since >= SMART_EVERY &&
        smartIndex < smartPoolRef.current.length
      ) {
        items.push({
          track: smartPoolRef.current[smartIndex],
          kind: "smart",
          index: smartIndex,
        });
        smartIndex += 1;
        since = 0;
        continue;
      }
      // Al terminar, la lista vuelve a empezar: se muestra hasta una vuelta
      // completa (más las recomendaciones que caben entre medias).
      if (steps >= order.length) break;
      pos = (pos + 1) % order.length;
      items.push({ track: order[pos], kind: "context", index: pos });
      since += 1;
      steps += 1;
    }
    setUpNext(items);
  }, []);

  const loadSmart = useCallback(() => {
    if (shuffleRef.current !== "smart" || smartBusyRef.current) return;
    const context = contextRef.current;
    if (context.length === 0) return;

    const generation = smartGenerationRef.current;
    const seeds = shuffled(context).slice(0, SMART_SEEDS);
    const known = new Set(context.map((track) => track.videoId));
    smartBusyRef.current = true;
    setSmartLoading(true);

    void Promise.all(seeds.map((seed) => fetchRadio(seed.videoId, 15).catch(() => [])))
      .then((lists) => {
        if (generation !== smartGenerationRef.current) return;
        const pool = smartPoolRef.current;
        const taken = new Set([
          ...known,
          ...pool.map((track) => track.videoId),
          ...smartPlayedRef.current,
        ]);
        // Se intercalan las radios para no encadenar un solo artista.
        const fresh: YoutubeTrack[] = [];
        const longest = Math.max(0, ...lists.map((list) => list.length));
        for (let index = 0; index < longest; index += 1) {
          for (const list of lists) {
            const track = list[index];
            if (track && !taken.has(track.videoId)) {
              taken.add(track.videoId);
              fresh.push(track);
            }
          }
        }
        smartPoolRef.current = [...pool, ...shuffled(fresh)];
        refreshUpNext();
      })
      .finally(() => {
        if (generation === smartGenerationRef.current) {
          smartBusyRef.current = false;
          setSmartLoading(false);
        }
      });
  }, [refreshUpNext]);

  const resetSmart = useCallback(() => {
    smartGenerationRef.current += 1;
    smartBusyRef.current = false;
    smartPoolRef.current = [];
    smartPlayedRef.current = new Set();
    sinceSmartRef.current = 0;
    setSmartLoading(false);
  }, []);

  /** Ordena la lista según el modo, con `first` al principio si se da. */
  const buildOrder = useCallback((list: YoutubeTrack[], first?: YoutubeTrack) => {
    if (shuffleRef.current === "off") {
      orderRef.current = list;
      posRef.current = first
        ? list.findIndex((track) => track.videoId === first.videoId)
        : -1;
      return;
    }
    const rest = first
      ? list.filter((track) => track.videoId !== first.videoId)
      : list;
    const inList = first && rest.length !== list.length;
    orderRef.current = inList ? [first, ...shuffled(rest)] : shuffled(rest);
    posRef.current = inList ? 0 : -1;
  }, []);

  /** Carga y reproduce una canción sin tocar la cola. */
  const startTrack = useCallback(
    async (track: YoutubeTrack) => {
      const request = ++requestRef.current;
      const previous = currentRef.current;
      if (previous && previous.videoId !== track.videoId) {
        historyRef.current = [...historyRef.current.slice(-(HISTORY_LIMIT - 1)), previous];
      }

      setError(null);
      setCurrent(track);
      currentRef.current = track;
      setPlayed((list) => {
        const next = [track, ...list.filter((item) => item.videoId !== track.videoId)].slice(
          0,
          PLAYED_LIMIT,
        );
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        } catch {
          // Sin almacenamiento, el historial dura hasta cerrar la app.
        }
        return next;
      });
      setPosition(0);
      setDuration(track.durationSec || 0);
      setStatus("stopped");
      setLoading(true);
      refreshUpNext();

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
    [getAudio, refreshUpNext],
  );

  const playTrack = useCallback(
    async (track: YoutubeTrack, nextQueue?: YoutubeTrack[]) => {
      if (nextQueue) {
        const sameContext =
          nextQueue === contextRef.current ||
          (nextQueue.length === contextRef.current.length &&
            nextQueue.every(
              (item, index) => item.videoId === contextRef.current[index]?.videoId,
            ));
        contextRef.current = nextQueue;
        setQueue(nextQueue);
        if (!sameContext) {
          resetSmart();
          buildOrder(nextQueue, track);
          sinceSmartRef.current = 1;
          loadSmart();
        } else {
          const index = orderRef.current.findIndex(
            (item) => item.videoId === track.videoId,
          );
          if (index >= 0) posRef.current = index;
          else buildOrder(nextQueue, track);
        }
      }
      await startTrack(track);
    },
    [buildOrder, loadSmart, resetSmart, startTrack],
  );

  /** Reproduce una lista entera con el modo indicado (normal, mezcla o inteligente). */
  const playCollection = useCallback(
    (list: YoutubeTrack[], mode: ShuffleMode) => {
      if (list.length === 0) return;
      shuffleRef.current = mode;
      setShuffleState(mode);
      contextRef.current = list;
      setQueue(list);
      resetSmart();
      buildOrder(list);
      posRef.current = 0;
      // La primera canción ya cuenta para las 3 antes de una recomendación.
      sinceSmartRef.current = 1;
      loadSmart();
      void startTrack(orderRef.current[0]);
    },
    [buildOrder, loadSmart, resetSmart, startTrack],
  );

  const next = useCallback(() => {
    const manual = manualRef.current;
    if (manual.length > 0) {
      const [first, ...rest] = manual;
      manualRef.current = rest;
      void startTrack(first);
      return;
    }

    const pool = smartPoolRef.current;
    if (
      shuffleRef.current === "smart" &&
      sinceSmartRef.current >= SMART_EVERY &&
      pool.length > 0
    ) {
      const [first, ...rest] = pool;
      smartPoolRef.current = rest;
      smartPlayedRef.current.add(first.videoId);
      sinceSmartRef.current = 0;
      if (rest.length < 2) loadSmart();
      void startTrack(first);
      return;
    }

    const order = orderRef.current;
    if (order.length === 0) return;
    let pos = posRef.current + 1;
    if (pos >= order.length) {
      // Al terminar la lista vuelve a empezar; en aleatorio, con otra mezcla.
      if (shuffleRef.current !== "off") {
        orderRef.current = shuffled(contextRef.current);
      }
      pos = 0;
    }
    posRef.current = pos;
    sinceSmartRef.current += 1;
    if (
      shuffleRef.current === "smart" &&
      sinceSmartRef.current >= SMART_EVERY &&
      smartPoolRef.current.length === 0
    ) {
      loadSmart();
    }
    void startTrack(orderRef.current[pos]);
  }, [loadSmart, startTrack]);

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

    const history = historyRef.current;
    const before = history[history.length - 1];
    if (before) {
      historyRef.current = history.slice(0, -1);
      const index = orderRef.current.findIndex(
        (item) => item.videoId === before.videoId,
      );
      if (index >= 0) posRef.current = index;
      // Se quita la actual del historial para no volver a ella al retroceder.
      currentRef.current = null;
      void startTrack(before);
      return;
    }

    const order = orderRef.current;
    if (order.length === 0) return;
    const pos = posRef.current > 0 ? posRef.current - 1 : order.length - 1;
    posRef.current = pos;
    currentRef.current = null;
    void startTrack(order[pos]);
  }, [startTrack]);

  const setShuffleMode = useCallback(
    (mode: ShuffleMode) => {
      if (shuffleRef.current === mode) return;
      const wasSmart = shuffleRef.current === "smart";
      shuffleRef.current = mode;
      setShuffleState(mode);

      const playing = currentRef.current;
      const context = contextRef.current;
      const inContext =
        playing && context.some((track) => track.videoId === playing.videoId)
          ? playing
          : undefined;
      buildOrder(context, inContext);

      if (mode === "smart") {
        resetSmart();
        if (inContext) sinceSmartRef.current = 1;
        loadSmart();
      } else if (wasSmart) {
        resetSmart();
      }
      refreshUpNext();
    },
    [buildOrder, loadSmart, refreshUpNext, resetSmart],
  );

  const cycleShuffle = useCallback(() => {
    const order: ShuffleMode[] = ["off", "on", "smart"];
    const index = order.indexOf(shuffleRef.current);
    setShuffleMode(order[(index + 1) % order.length]);
  }, [setShuffleMode]);

  const toggleRepeat = useCallback(() => {
    repeatRef.current = !repeatRef.current;
    setRepeat(repeatRef.current);
  }, []);

  /** Si la persona añade una canción, deja de estar entre las recomendadas. */
  const dropFromSmart = (videoId: string) => {
    smartPoolRef.current = smartPoolRef.current.filter(
      (item) => item.videoId !== videoId,
    );
  };

  const addToQueue = useCallback(
    (track: YoutubeTrack) => {
      dropFromSmart(track.videoId);
      manualRef.current = [...manualRef.current, track];
      if (!currentRef.current) {
        nextRef.current();
        return;
      }
      refreshUpNext();
    },
    [refreshUpNext],
  );

  const playNext = useCallback(
    (track: YoutubeTrack) => {
      dropFromSmart(track.videoId);
      manualRef.current = [track, ...manualRef.current];
      if (!currentRef.current) {
        nextRef.current();
        return;
      }
      refreshUpNext();
    },
    [refreshUpNext],
  );

  const removeFromQueue = useCallback(
    (item: QueueItem) => {
      if (item.kind === "manual") {
        manualRef.current = manualRef.current.filter((_, index) => index !== item.index);
      } else if (item.kind === "smart") {
        smartPoolRef.current = smartPoolRef.current.filter(
          (_, index) => index !== item.index,
        );
      } else {
        const order = [...orderRef.current];
        order.splice(item.index, 1);
        orderRef.current = order;
        if (item.index < posRef.current) posRef.current -= 1;
      }
      refreshUpNext();
    },
    [refreshUpNext],
  );

  const jumpTo = useCallback(
    (item: QueueItem) => {
      if (item.kind === "manual") {
        manualRef.current = manualRef.current.filter((_, index) => index !== item.index);
      } else if (item.kind === "smart") {
        smartPoolRef.current = smartPoolRef.current.filter(
          (_, index) => index !== item.index,
        );
        smartPlayedRef.current.add(item.track.videoId);
        sinceSmartRef.current = 0;
      } else {
        posRef.current = item.index;
        sinceSmartRef.current += 1;
      }
      void startTrack(item.track);
    },
    [startTrack],
  );

  const playPause = useCallback(() => {
    const audio = getAudio();

    if (!currentRef.current) {
      const first = resultsRef.current[0] ?? contextRef.current[0];
      if (first) {
        void playTrack(
          first,
          resultsRef.current.length > 0 ? resultsRef.current : contextRef.current,
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

  const setVolume = useCallback((value: number) => {
    const clean = Math.min(1, Math.max(0, value));
    volumeRef.current = clean;
    setVolumeState(clean);
    if (audioRef.current) audioRef.current.volume = clean;
    try {
      localStorage.setItem(VOLUME_KEY, String(clean));
    } catch {
      // Sin almacenamiento, el volumen dura hasta cerrar la app.
    }
  }, []);

  const seek = useCallback(
    (seconds: number) => {
      const audio = getAudio();
      if (!currentRef.current || !Number.isFinite(seconds)) return;
      audio.currentTime = Math.max(0, seconds);
      setPosition(audio.currentTime);
    },
    [getAudio],
  );

  const runSearch = useCallback(async (text: string, live: boolean) => {
    const clean = text.trim();
    if (!clean) return;
    const request = ++searchRequestRef.current;
    lastSearchedRef.current = clean.toLowerCase();
    setSearching(true);
    setError(null);

    try {
      const tracks = await searchYoutubeMusic(clean, 20);
      if (request !== searchRequestRef.current) return;
      setResults(tracks);
      resultsRef.current = tracks;
      if (tracks.length === 0 && !live) setError("Sin resultados para esa búsqueda");
    } catch (err) {
      if (request !== searchRequestRef.current) return;
      // Mientras se escribe no se muestran errores de palabras a medias.
      if (!live) setError(describeError(err));
      if (!live) {
        setResults([]);
        resultsRef.current = [];
      }
    } finally {
      if (request === searchRequestRef.current) setSearching(false);
    }
  }, []);

  const search = useCallback(
    async (text?: string) => {
      const value = text ?? query;
      if (text !== undefined) setQueryState(text);
      setSuggestions(EMPTY_SUGGESTIONS);
      await runSearch(value, false);
    },
    [query, runSearch],
  );

  // Mientras se escribe: sugerencias casi al instante y resultados al parar.
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setSuggestions(EMPTY_SUGGESTIONS);
      return;
    }
    const controller = new AbortController();
    const suggestTimer = window.setTimeout(() => {
      suggestYoutubeMusic(text, controller.signal)
        .then(setSuggestions)
        .catch(() => {});
    }, SUGGEST_DELAY_MS);
    const searchTimer = window.setTimeout(() => {
      if (text.toLowerCase() !== lastSearchedRef.current) {
        void runSearch(text, true);
      }
    }, LIVE_SEARCH_DELAY_MS);
    return () => {
      controller.abort();
      window.clearTimeout(suggestTimer);
      window.clearTimeout(searchTimer);
    };
  }, [query, runSearch]);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    if (!value.trim()) {
      lastSearchedRef.current = "";
      setSuggestions(EMPTY_SUGGESTIONS);
    }
  }, []);

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
    upNext,
    results,
    suggestions,
    query,
    searching,
    loading,
    error,
    available: bridge?.available ?? true,
    unavailableReason: bridge?.message ?? null,
    engine: bridge?.engine ?? null,
    likes,
    likesUpdatedAt,
    played,
    downloads,
    downloadingId,
    downloadError,
    shuffleMode,
    smartLoading,
    repeat,
    cycleShuffle,
    setShuffleMode,
    toggleRepeat,
    setQuery,
    search,
    playTrack,
    playCollection,
    addToQueue,
    playNext,
    removeFromQueue,
    jumpTo,
    playPause,
    next,
    previous,
    seek,
    volume,
    setVolume,
    pause,
    toggleLike,
    addLikes,
    replaceLikes: commitLikes,
    download,
    removeDownload,
  };
}
