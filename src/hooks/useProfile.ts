import { useCallback, useEffect, useRef, useState } from "react";
import type { CloudProfile, CloudUser } from "../services/cloudStore";

const PROFILE_KEY = "foyu.profile";
const PHOTO_SIZE = 256;
const PUSH_DELAY_MS = 1500;

export interface LocalProfile extends CloudProfile {}

const EMPTY: LocalProfile = { name: "", photo: "", updatedAt: 0 };

function readLocal(): LocalProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return EMPTY;
    const data = JSON.parse(raw);
    return {
      name: String(data?.name ?? "").slice(0, 60),
      photo: typeof data?.photo === "string" && data.photo.startsWith("data:image/jpeg;base64,")
        ? data.photo
        : "",
      updatedAt: Number(data?.updatedAt ?? 0) || 0,
    };
  } catch {
    return EMPTY;
  }
}

function writeLocal(profile: LocalProfile) {
  try {
    if (!profile.name && !profile.photo) localStorage.removeItem(PROFILE_KEY);
    else localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Sin almacenamiento, el perfil dura hasta cerrar la app.
  }
}

/** Recorta la imagen al centro y la guarda pequeña: unos 20-40 KB. */
async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Elige una imagen.");
  if (file.size > 25 * 1024 * 1024) throw new Error("La imagen es demasiado grande.");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("No se pudo leer la imagen."));
      element.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error("No se pudo leer la imagen.");
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo preparar la imagen.");
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      PHOTO_SIZE,
      PHOTO_SIZE,
    );
    // Al volver a dibujarla se descartan los metadatos (ubicación, cámara...).
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface UseProfileResult {
  /** Nombre que se muestra: el elegido o, si no hay, el de la cuenta. */
  displayName: string;
  /** Foto que se muestra: la elegida o, si no hay, la de la cuenta. */
  displayPhoto: string | null;
  name: string;
  hasCustomPhoto: boolean;
  error: string | null;
  busy: boolean;
  setName: (name: string) => void;
  setPhoto: (file: File) => Promise<void>;
  clearPhoto: () => void;
}

const loadStore = () => import("../services/cloudStore");

/**
 * Perfil de la persona: nombre y foto. Sin cuenta se queda en el
 * dispositivo; con cuenta se copia a la nube para verlo en el teléfono y
 * en el PC. Gana el cambio más reciente.
 */
export function useProfile(user: CloudUser | null): UseProfileResult {
  const [profile, setProfile] = useState<LocalProfile>(readLocal);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const latest = useRef(profile);

  useEffect(() => {
    latest.current = profile;
  });

  // Al entrar con la cuenta se trae el perfil de la nube.
  useEffect(() => {
    if (!user) return;
    let active = true;
    void loadStore()
      .then((store) => store.readProfile(user.uid))
      .then((remote) => {
        if (!active) return;
        const local = latest.current;
        if (remote && remote.updatedAt > local.updatedAt) {
          setProfile(remote);
          writeLocal(remote);
        } else if (local.updatedAt > (remote?.updatedAt ?? 0)) {
          pending.current = true;
          setProfile({ ...local });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);

  // Los cambios se suben a la nube poco después de hacerlos.
  useEffect(() => {
    if (!user || !pending.current) return;
    const timer = window.setTimeout(() => {
      pending.current = false;
      void loadStore()
        .then((store) => store.writeProfile(user.uid, latest.current))
        .catch(() => setError("No se pudo guardar el perfil en la nube."));
    }, PUSH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [profile, user]);

  const commit = useCallback((next: Partial<LocalProfile>) => {
    setProfile((current) => {
      const updated = { ...current, ...next, updatedAt: Date.now() };
      writeLocal(updated);
      return updated;
    });
    pending.current = true;
    setError(null);
  }, []);

  const setName = useCallback(
    (name: string) => commit({ name: name.slice(0, 60) }),
    [commit],
  );

  const setPhoto = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        commit({ photo: await compressPhoto(file) });
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo usar la imagen.");
      } finally {
        setBusy(false);
      }
    },
    [commit],
  );

  const clearPhoto = useCallback(() => commit({ photo: "" }), [commit]);

  return {
    displayName: profile.name.trim() || user?.name || "",
    displayPhoto: profile.photo || user?.photoUrl || null,
    name: profile.name,
    hasCustomPhoto: Boolean(profile.photo),
    error,
    busy,
    setName,
    setPhoto,
    clearPhoto,
  };
}
