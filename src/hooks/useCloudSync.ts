import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  cloudAvailable,
  googleClient,
  usesFirebaseEmulator,
} from "../services/cloudConfig";
import type { CloudUser } from "../services/cloudStore";
import {
  mergeSnapshots,
  parseSnapshot,
  serializeSnapshot,
} from "../services/librarySync";
import type { LibrarySnapshot, MergeMode } from "../services/librarySync";
import type { YoutubeLibrary } from "../types/youtube";

const SYNC_OWNER_KEY = "foyu.sync.owner";
const YOUTUBE_KEY = "foyu.youtube.connected";
const YOUTUBE_LAST_KEY = "foyu.youtube.lastSync";
const PUSH_DELAY_MS = 4000;
const YOUTUBE_REFRESH_MS = 6 * 60 * 60 * 1000;

export type CloudStatus = "idle" | "working" | "synced" | "error";

export interface UseCloudSyncResult {
  available: boolean;
  user: CloudUser | null;
  status: CloudStatus;
  message: string | null;
  youtubeMessage: string | null;
  lastSyncedAt: number | null;
  youtubeConnected: boolean;
  youtubeBusy: boolean;
  signIn: () => Promise<void>;
  signOut: (eraseDevice: boolean) => Promise<void>;
  syncNow: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  syncYoutube: () => Promise<void>;
  disconnectYoutube: () => Promise<void>;
}

interface Options {
  snapshot: LibrarySnapshot;
  onApply: (snapshot: LibrarySnapshot) => void;
  onYoutubeLibrary: (library: YoutubeLibrary) => void;
  emptySnapshot: LibrarySnapshot;
}

const loadStore = () => import("../services/cloudStore");

function readValue(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeValue(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Sin almacenamiento, la preferencia dura solo mientras la app sigue abierta.
  }
}

function describe(error: unknown): string {
  const text = String((error as any)?.code ?? (error as any)?.message ?? error);
  const forbiddenCode = text.match(/youtube_forbidden:([A-Za-z0-9_]+)/)?.[1];
  if (forbiddenCode) {
    return `YouTube no permitió leer la biblioteca (${forbiddenCode}).`;
  }
  const known: Array<[string, string]> = [
    ["google_cancelled", ""],
    ["google_not_configured", "Esta versión no tiene configurado el inicio de sesión."],
    ["youtube_cancelled", ""],
    ["youtube_consent_required", "Vuelve a autorizar YouTube Music para actualizarla."],
    ["youtube_no_channel", "Tu cuenta de Google no tiene un canal de YouTube activo."],
    ["youtube_quota", "YouTube limitó las consultas por hoy. Inténtalo mañana."],
    ["youtube_api_disabled", "Falta habilitar YouTube Data API v3 en el proyecto."],
    ["youtube_forbidden", "YouTube no permitió leer la biblioteca de esta cuenta."],
    ["youtube_", "No se pudo conectar con YouTube Music."],
    ["google_", "No se pudo iniciar sesión con Google."],
    ["cloud_busy", "Otro dispositivo está guardando. Se reintentará pronto."],
    ["cloud_too_large", "Tu biblioteca es demasiado grande para sincronizarla."],
    ["permission-denied", "La nube rechazó el acceso a estos datos."],
    ["unavailable", "No hay conexión con la nube. Tus datos siguen en este dispositivo."],
    ["network-request-failed", "Revisa tu conexión a internet."],
    ["requires-recent-login", "Vuelve a confirmar tu cuenta para continuar."],
  ];
  const match = known.find(([code]) => text.includes(code));
  return match ? match[1] : "No se pudo completar la acción. Inténtalo de nuevo.";
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Abre el selector nativo; en desarrollo usa una cuenta falsa del emulador. */
async function requestGoogleToken() {
  const rawNonce = randomNonce();
  if (import.meta.env.DEV && usesFirebaseEmulator) {
    const uid = (window as any).__foyuTestUser ?? "usuario-prueba";
    const idToken = JSON.stringify({
      sub: uid,
      email: `${uid}@example.com`,
      email_verified: true,
      name: "Persona de prueba",
    });
    return { idToken, rawNonce };
  }
  const { clientId, clientSecret } = googleClient();
  const idToken = await invoke<string>("google_sign_in", {
    clientId,
    clientSecret,
    nonce: await sha256(rawNonce),
  });
  return { idToken, rawNonce };
}

export function useCloudSync({
  snapshot,
  onApply,
  onYoutubeLibrary,
  emptySnapshot,
}: Options): UseCloudSyncResult {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [status, setStatus] = useState<CloudStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [youtubeMessage, setYoutubeMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [youtubeConnected, setYoutubeConnected] = useState(
    () => readValue(YOUTUBE_KEY) === "1",
  );
  const [youtubeBusy, setYoutubeBusy] = useState(false);

  const serialized = useMemo(() => serializeSnapshot(snapshot), [snapshot]);
  const latest = useRef({ snapshot, serialized, onApply, onYoutubeLibrary });
  const syncedText = useRef<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const userRef = useRef<CloudUser | null>(null);

  useEffect(() => {
    latest.current = { snapshot, serialized, onApply, onYoutubeLibrary };
  });

  const runSync = useCallback(() => {
    const run = async () => {
      const current = userRef.current;
      if (!current) return;
      setStatus("working");
      setMessage(null);
      try {
        const store = await loadStore();
        const stored = await store.readLibrary(current.uid);
        const remote = stored === null ? null : parseSnapshot(stored);

        const owner = readValue(SYNC_OWNER_KEY);
        const mode: MergeMode =
          owner === current.uid ? "sync" : owner ? "replace" : "first";
        const local = latest.current.snapshot;
        const merged = mergeSnapshots(local, remote, mode);
        const mergedText = serializeSnapshot(merged);

        if (mergedText !== latest.current.serialized) {
          syncedText.current = mergedText;
          latest.current.onApply(merged);
        }
        if (!remote || serializeSnapshot(remote) !== mergedText) {
          await store.writeLibrary(current.uid, mergedText);
        }
        syncedText.current = mergedText;
        writeValue(SYNC_OWNER_KEY, current.uid);
        setLastSyncedAt(Date.now());
        setStatus("synced");
      } catch (error) {
        setStatus("error");
        setMessage(describe(error));
      }
    };
    queue.current = queue.current.then(run, run);
    return queue.current;
  }, []);

  const fetchYoutube = useCallback(async (interactive: boolean) => {
    const current = userRef.current;
    if (!current) return;
    setYoutubeBusy(true);
    setYoutubeMessage(null);
    try {
      const { clientId, clientSecret } = googleClient();
      const library = await invoke<YoutubeLibrary>("youtube_library_fetch", {
        email: current.email,
        interactive,
        clientId,
        clientSecret,
      });
      latest.current.onYoutubeLibrary(library);
      writeValue(YOUTUBE_KEY, "1");
      writeValue(YOUTUBE_LAST_KEY, String(Date.now()));
      setYoutubeConnected(true);
      setYoutubeMessage(
        `YouTube Music actualizado: ${library.playlists.length} ${
          library.playlists.length === 1 ? "playlist" : "playlists"
        } y ${library.likes.length} Me gusta.`,
      );
    } catch (error) {
      if (interactive) setYoutubeMessage(describe(error) || null);
    } finally {
      setYoutubeBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!cloudAvailable) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void loadStore()
      .then((store) => {
        if (!active) return;
        unsubscribe = store.watchUser((next) => {
          userRef.current = next;
          setUser(next);
          if (!next) {
            syncedText.current = null;
            setStatus("idle");
            setLastSyncedAt(null);
            return;
          }
          void runSync();
          const last = Number(readValue(YOUTUBE_LAST_KEY) ?? 0);
          if (
            readValue(YOUTUBE_KEY) === "1" &&
            Date.now() - last > YOUTUBE_REFRESH_MS
          ) {
            void fetchYoutube(false);
          }
        });
      })
      .catch(() => {
        if (active) setMessage("No se pudo preparar la cuenta.");
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [fetchYoutube, runSync]);

  useEffect(() => {
    if (!user || serialized === syncedText.current) return;
    const timer = window.setTimeout(() => void runSync(), PUSH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [runSync, serialized, user]);

  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [runSync, user]);

  const signIn = useCallback(async () => {
    setStatus("working");
    setMessage(null);
    try {
      const { idToken, rawNonce } = await requestGoogleToken();
      const store = await loadStore();
      await store.signInWithGoogleToken(idToken, rawNonce);
    } catch (error) {
      setStatus("error");
      setMessage(describe(error));
    }
  }, []);

  const finishSession = useCallback(async () => {
    const store = await loadStore();
    await store.signOutCloud();
    if (!usesFirebaseEmulator) {
      await invoke("google_clear_credential").catch(() => {});
    }
  }, []);

  const signOut = useCallback(
    async (eraseDevice: boolean) => {
      setStatus("working");
      setMessage(null);
      try {
        await queue.current;
        userRef.current = null;
        await finishSession();
        if (eraseDevice) {
          latest.current.onApply(emptySnapshot);
          writeValue(SYNC_OWNER_KEY, null);
          writeValue(YOUTUBE_KEY, null);
          writeValue(YOUTUBE_LAST_KEY, null);
          setYoutubeConnected(false);
        }
      } catch (error) {
        setStatus("error");
        setMessage(describe(error));
      }
    },
    [emptySnapshot, finishSession],
  );

  const disconnectYoutube = useCallback(async () => {
    const current = userRef.current;
    if (!current) return;
    setYoutubeBusy(true);
    setYoutubeMessage(null);
    try {
      await invoke("youtube_disconnect", { email: current.email });
      writeValue(YOUTUBE_KEY, null);
      writeValue(YOUTUBE_LAST_KEY, null);
      setYoutubeConnected(false);
      setYoutubeMessage("YouTube Music se desconectó de FoYu.");
    } catch (error) {
      setYoutubeMessage(describe(error) || null);
    } finally {
      setYoutubeBusy(false);
    }
  }, []);

  const deleteAccount = useCallback(async () => {
    const current = userRef.current;
    if (!current) return;
    setStatus("working");
    setMessage(null);
    try {
      await queue.current;
      if (readValue(YOUTUBE_KEY) === "1" && !usesFirebaseEmulator) {
        await invoke("youtube_disconnect", { email: current.email }).catch(() => {});
      }
      const { idToken, rawNonce } = await requestGoogleToken();
      const store = await loadStore();
      userRef.current = null;
      await store.deleteCloudAccount(idToken, rawNonce);
      if (!usesFirebaseEmulator) {
        await invoke("google_clear_credential").catch(() => {});
      }
      writeValue(SYNC_OWNER_KEY, null);
      writeValue(YOUTUBE_KEY, null);
      writeValue(YOUTUBE_LAST_KEY, null);
      setYoutubeConnected(false);
      setMessage("Tu cuenta y tus datos en la nube se borraron.");
      setStatus("idle");
    } catch (error) {
      userRef.current = current;
      setStatus("error");
      setMessage(describe(error));
    }
  }, []);

  return {
    available: cloudAvailable,
    user,
    status,
    message,
    youtubeMessage,
    lastSyncedAt,
    youtubeConnected,
    youtubeBusy,
    signIn,
    signOut,
    syncNow: runSync,
    deleteAccount,
    syncYoutube: () => fetchYoutube(true),
    disconnectYoutube,
  };
}
