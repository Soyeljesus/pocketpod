import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryEntry, MediaState } from "../types/media";
import { EMPTY_MEDIA_STATE } from "../types/media";
import {
  fetchMediaState,
  togglePlayPause,
  skipNext,
  skipPrevious,
  seekTo,
} from "../services/mediaBridge";

const HISTORY_KEY = "pocketpod.history";
const HISTORY_LIMIT = 40;

/** Margen para distinguir un pequeño retraso del backend de un seek real. */
const BACKWARD_SEEK_THRESHOLD_SEC = 3;

function trackKey(track: { title: string; artist: string }): string {
  return `${track.title}::${track.artist}`.toLowerCase();
}

function positionKey(media: MediaState): string {
  return `${trackKey(media)}::${media.album}::${media.durationSec}`.toLowerCase();
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: HistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Si localStorage está lleno o no disponible, el historial solo vive en memoria.
  }
}

/**
 * Punto de referencia para calcular la posición interpolada.
 * `position` es la última posición conocida y `at` el instante (ms) en que
 * se conoció. Mientras el estado sea "playing" se le suma el tiempo real
 * transcurrido desde entonces.
 */
interface PositionAnchor {
  position: number;
  at: number;
  key: string;
  playing: boolean;
  duration: number;
}

const EMPTY_ANCHOR: PositionAnchor = {
  position: 0,
  at: 0,
  key: "",
  playing: false,
  duration: 0,
};

export interface UseMediaSessionResult {
  state: MediaState;
  /** Posición interpolada para que la barra avance de forma fluida. */
  positionSec: number;
  /** Canciones escuchadas, de más reciente a más antigua. */
  history: HistoryEntry[];
  loading: boolean;
  error: string | null;
  playPause: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (seconds: number) => Promise<void>;
}

/**
 * Sondea el backend cada segundo para mantener frescos título, portada,
 * estado y duración. Entre sondeo y sondeo interpola la posición para que
 * la barra de progreso avance sin saltos.
 *
 * La posición nunca retrocede mientras suena la misma canción (salvo un
 * seek real hacia atrás). Esto evita el efecto "suma y resta" que producen
 * los reproductores que actualizan el timeline con retraso, como Apple Music.
 */
export function useMediaSession(): UseMediaSessionResult {
  const [state, setState] = useState<MediaState>(EMPTY_MEDIA_STATE);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<PositionAnchor>(EMPTY_ANCHOR);

  // "now" se actualiza 4 veces por segundo solo para animar la barra.
  const [now, setNow] = useState<number>(() => Date.now());
  const lastTrackRef = useRef<string>("");

  const registerHistory = useCallback((media: MediaState) => {
    if (!media.connected || media.title.length === 0) return;

    const key = trackKey(media);
    const entry: HistoryEntry = {
      title: media.title,
      artist: media.artist,
      album: media.album,
      artworkDataUrl: media.artworkDataUrl,
    };

    setHistory((prev) => {
      const existingIndex = prev.findIndex((item) => trackKey(item) === key);

      if (existingIndex === -1) {
        const updated = [entry, ...prev].slice(0, HISTORY_LIMIT);
        saveHistory(updated);
        return updated;
      }

      // La misma canción: actualiza la portada si llegó más tarde.
      if (prev[existingIndex].artworkDataUrl === entry.artworkDataUrl) {
        return prev;
      }
      const updated = [...prev];
      updated[existingIndex] = { ...updated[existingIndex], ...entry };
      saveHistory(updated);
      return updated;
    });
  }, []);

  const applyPositionSnapshot = useCallback((media: MediaState) => {
    const nowMs = Date.now();
    const key = positionKey(media);
    const playing = media.status === "playing";

    setAnchor((prev) => {
      // Canción distinta: empieza de cero con lo que diga el backend.
      if (prev.key !== key) {
        return {
          position: media.positionSec,
          at: nowMs,
          key,
          playing,
          duration: media.durationSec,
        };
      }

      // En pausa/parado se muestra exactamente la posición reportada.
      if (!playing) {
        return {
          position: media.positionSec,
          at: nowMs,
          key,
          playing: false,
          duration: media.durationSec,
        };
      }

      let position = media.positionSec;

      if (prev.playing) {
        const estimated = prev.position + (nowMs - prev.at) / 1000;

        if (media.positionSec < estimated - BACKWARD_SEEK_THRESHOLD_SEC) {
          // Retroceso grande: es un seek real, se acepta.
          position = media.positionSec;
        } else {
          // Si el backend va rezagado, se conserva la estimación para que
          // la barra no retroceda cada segundo.
          position = Math.max(media.positionSec, estimated);
        }
      }

      return {
        position,
        at: nowMs,
        key,
        playing: true,
        duration: media.durationSec,
      };
    });
  }, []);

  // Sondeo del backend.
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const next = await fetchMediaState();
        if (cancelled) return;

        setState(next);
        applyPositionSnapshot(next);
        setLoading(false);
        setError(null);

        const key = trackKey(next);
        if (next.connected && next.title && key !== lastTrackRef.current) {
          lastTrackRef.current = key;
        }
        registerHistory(next);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [applyPositionSnapshot, registerHistory]);

  // Tic para interpolar la posición.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const positionSec = anchor.playing
    ? Math.min(
        anchor.position + Math.max(0, now - anchor.at) / 1000,
        anchor.duration > 0 ? anchor.duration : Number.POSITIVE_INFINITY,
      )
    : anchor.position;

  const playPause = useCallback(async () => {
    try {
      await togglePlayPause();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const next = useCallback(async () => {
    try {
      await skipNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const previous = useCallback(async () => {
    try {
      await skipPrevious();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const seek = useCallback(async (seconds: number) => {
    // Actualización optimista para que la barra responda al instante.
    setAnchor((prev) => ({ ...prev, position: seconds, at: Date.now() }));
    setState((prev) => ({ ...prev, positionSec: seconds }));
    try {
      await seekTo(seconds);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return {
    state,
    positionSec,
    history,
    loading,
    error,
    playPause,
    next,
    previous,
    seek,
  };
}
