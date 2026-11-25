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
const CROSSFADE_KEY = "foyu.crossfade";
/** Segundos sin avanzar antes de reanudar el audio. */
const STALL_SECONDS = 8;
const MAX_RECOVERIES = 3;

function loadCrossfade(): number {
  try {
    const value = Number(localStorage.getItem(CROSSFADE_KEY) ?? 0);
    return [0, 3, 6, 9, 12].includes(value) ? value : 0;
  } catch {
    return 0;
  }
}

/** Interrumpir una reproducción (pausar o cambiar de canción) no es un error. */
function isInterruption(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
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
  /** Segundos de transición entre canciones (0 = sin crossfade). */
  crossfade: number;
  setCrossfade: (seconds: number) => void;
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
  const [crossfade, setCrossfadeState] = useState(loadCrossfade);
  const crossfadeRef = useRef(crossfade);
  /** Dos pistas: mientras una termina, la otra entra (crossfade). */
  const playersRef = useRef<HTMLAudioElement[]>([]);
  const activeRef = useRef(0);
  const fadeTimerRef = useRef<number | null>(null);
  const crossfadeNextRef = useRef(false);
  const fadeStartedRef = useRef(0);
  const recoverRef = useRef<(reason: "stall" | "error") => void>(() => {});
  const watchRef = useRef({ time: -1, since: 0, retries: 0 });

  const getAudio = useCallback((): HTMLAudioElement => {
    if (playersRef.current.length === 0) {
      playersRef.current = [0, 1].map(() => {
        const audio = new Audio();
        audio.preload = "auto";
        audio.volume = volumeRef.current;
        const isActive = () => playersRef.current[activeRef.current] === audio;

        audio.addEventListener("play", () => {
          if (isActive()) setStatus("playing");
        });
        audio.addEventListener("pause", () => {
          if (isActive()) setStatus("paused");
        });
        audio.addEventListener("ended", () => {
          if (!isActive()) return;
          if (repeatRef.current) {
            audio.currentTime = 0;
            void audio.play().catch(() => nextRef.current());
          } else {
            nextRef.current();
          }
        });
        audio.addEventListener("loadedmetadata", () => {
          if (isActive() && Number.isFinite(audio.duration) && audio.duration > 0) {
            setDuration(audio.duration);
          }
        });
        audio.addEventListener("error", () => {
          // Si se corta la conexión con YouTube, se reanuda donde iba.
          if (isActive() && audio.currentSrc) recoverRef.current("error");
        });
        return audio;
      });
      audioRef.current = playersRef.current[0];
    }
    return playersRef.current[activeRef.current];
  }, []);

  const stopFade = useCallback(() => {
    if (fadeTimerRef.current !== null) window.clearInterval(fadeTimerRef.current);
    fadeTimerRef.current = null;
  }, []);

  /** Para la otra pista y deja la activa con el volumen normal. */
  const silenceOther = useCallback(() => {
    stopFade();
    const players = playersRef.current;
    const other = players[1 - activeRef.current];
    if (other) {
      other.pause();
      other.removeAttribute("src");
    }
    const active = players[activeRef.current];
    if (active) active.volume = volumeRef.current;
  }, [stopFade]);

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

  // Mientras suena: barra de progreso, vigilante de atascos y crossfade.
  useEffect(() => {
    if (status !== "playing") return;
    const id = window.setInterval(() => {
      const audio = playersRef.current[activeRef.current];
      if (!audio) return;
      const time = audio.currentTime || 0;
      setPosition(time);

      // Si el audio "suena" pero no avanza, YouTube cortó la conexión.
      const watch = watchRef.current;
      if (!audio.paused && Math.abs(time - watch.time) < 0.05) {
        if (watch.since === 0) watch.since = Date.now();
        else if (Date.now() - watch.since > STALL_SECONDS * 1000) {
          watch.since = 0;
          recoverRef.current("stall");
        }
      } else {
        watch.time = time;
        watch.since = 0;
      }

      // Crossfade: la siguiente canción empieza mientras esta se apaga.
      const fade = crossfadeRef.current;
      const length = audio.duration;
      if (
        fade > 0 &&
        !repeatRef.current &&
        Number.isFinite(length) &&
        length > fade + 10 &&
        length - time <= fade &&
        fadeStartedRef.current !== requestRef.current
      ) {
        fadeStartedRef.current = requestRef.current;
        crossfadeNextRef.current = true;
        nextRef.current();
        crossfadeNextRef.current = false;
      }
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
      playersRef.current.forEach((audio) => audio.pause());
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
      setLoading(true);
      watchRef.current = { time: -1, since: 0, retries: 0 };
      refreshUpNext();

      // Con crossfade, la canción anterior sigue sonando en la otra pista.
      const outgoing = getAudio();
      const fade =
        crossfadeNextRef.current && crossfadeRef.current > 0 && !outgoing.paused;
      if (fade) {
        stopFade();
        activeRef.current = 1 - activeRef.current;
      } else {
        silenceOther();
        outgoing.pause();
        setStatus("stopped");
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
        audio.volume = fade ? 0 : volumeRef.current;
        audio.src = src;
        audio.load();
        await audio.play();

        if (fade && request === requestRef.current) {
          const seconds = crossfadeRef.current;
          const started = Date.now();
          fadeTimerRef.current = window.setInterval(() => {
            const progress = Math.min(1, (Date.now() - started) / (seconds * 1000));
            audio.volume = volumeRef.current * progress;
            outgoing.volume = volumeRef.current * (1 - progress);
            if (progress >= 1) {
              stopFade();
              outgoing.pause();
              outgoing.removeAttribute("src");
            }
          }, 80);
        }
      } catch (err) {
        if (request !== requestRef.current || isInterruption(err)) return;
        silenceOther();
        setError(describeError(err));
        setStatus("stopped");
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [getAudio, refreshUpNext, silenceOther, stopFade],
  );

  // Reanuda la canción donde iba con una conexión nueva a YouTube.
  useEffect(() => {
    recoverRef.current = (reason) => {
      const track = currentRef.current;
      const audio = playersRef.current[activeRef.current];
      if (!track || !audio) return;
      const watch = watchRef.current;
      if (watch.retries >= MAX_RECOVERIES) {
        if (reason === "error") {
          setError("Se perdió la conexión con la canción. Prueba de nuevo.");
          setStatus("stopped");
        } else {
          nextRef.current();
        }
        return;
      }
      watch.retries += 1;
      const request = requestRef.current;
      const resumeAt = audio.currentTime || 0;
      const offline = downloadsRef.current.some((item) => item.videoId === track.videoId);
      const source = offline
        ? getOfflineStreamUrl(track.videoId)
        : getStreamUrl(track.videoId).then((url) => `${url}&fresh=${Date.now()}`);
      void source
        .then((src) => {
          if (request !== requestRef.current) return;
          audio.src = src;
          audio.addEventListener(
            "loadedmetadata",
            () => {
              if (resumeAt > 0) audio.currentTime = resumeAt;
            },
            { once: true },
          );
          audio.load();
          return audio.play();
        })
        .catch(() => {});
    };
  });

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
    const audio = playersRef.current[activeRef.current];
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
      setError(null);
      if (!audio.currentSrc) {
        // La pista se vació (por ejemplo tras un crossfade cortado): se vuelve a cargar.
        void startTrack(currentRef.current);
        return;
      }
      void audio.play().catch((err) => {
        if (!isInterruption(err)) recoverRef.current("error");
      });
    } else {
      // Al pausar en medio de un crossfade, se quedan las dos pistas quietas.
      silenceOther();
      audio.pause();
    }
  }, [getAudio, playTrack, silenceOther, startTrack]);

  const pause = useCallback(() => {
    silenceOther();
    playersRef.current[activeRef.current]?.pause();
  }, [silenceOther]);

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

  const setCrossfade = useCallback((seconds: number) => {
    crossfadeRef.current = seconds;
    setCrossfadeState(seconds);
    try {
      localStorage.setItem(CROSSFADE_KEY, String(seconds));
    } catch {
      // Sin almacenamiento, el ajuste dura hasta cerrar la app.
    }
  }, []);

  const setVolume = useCallback((value: number) => {
    const clean = Math.min(1, Math.max(0, value));
    volumeRef.current = clean;
    setVolumeState(clean);
    // Durante un crossfade, el propio fundido usa el volumen nuevo.
    if (fadeTimerRef.current === null) {
      const audio = playersRef.current[activeRef.current];
      if (audio) audio.volume = clean;
    }
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
    crossfade,
    setCrossfade,
    pause,
    toggleLike,
    addLikes,
    replaceLikes: commitLikes,
    download,
    removeDownload,
  };
}
