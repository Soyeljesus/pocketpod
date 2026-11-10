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

function trackKey(track: { title: string; artist: string }): string {
  return `${track.title}::${track.artist}`.toLowerCase();
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
 */
export function useMediaSession(): UseMediaSessionResult {
  const [state, setState] = useState<MediaState>(EMPTY_MEDIA_STATE);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // "now" se actualiza 4 veces por segundo solo para animar la barra.
  const [now, setNow] = useState<number>(() => Date.now());
  const lastUpdateRef = useRef<number>(Date.now());
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

  // Sondeo del backend.
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const next = await fetchMediaState();
        if (cancelled) return;

        setState(next);
        lastUpdateRef.current = Date.now();
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
  }, [registerHistory]);

  // Tic para interpolar la posición.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const positionSec =
    state.status === "playing"
      ? Math.min(
          state.positionSec + Math.max(0, now - lastUpdateRef.current) / 1000,
          state.durationSec > 0
            ? state.durationSec
            : Number.POSITIVE_INFINITY,
        )
      : state.positionSec;

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
    setState((prev) => ({ ...prev, positionSec: seconds }));
    lastUpdateRef.current = Date.now();
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
