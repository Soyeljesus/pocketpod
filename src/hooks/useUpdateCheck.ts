import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { AvailableUpdate } from "../services/updates";
import {
  checkForUpdate,
  downloadUpdate,
  installDownloadedUpdate,
  openUpdatePage,
  rememberDismissed,
  wasDismissed,
} from "../services/updates";

export type UpdateStatus = "idle" | "checking" | "current" | "available" | "error";

/** Pasos de la instalación dentro de la app. */
export type InstallPhase =
  | "idle"
  | "downloading"
  | "ready"
  | "permission"
  | "installing"
  | "failed";

export interface UseUpdateCheckResult {
  /** Versión nueva publicada, aunque se haya pospuesto el aviso. */
  update: AvailableUpdate | null;
  /** Aviso al abrir la app: solo si no se pospuso esta versión. */
  prompt: AvailableUpdate | null;
  status: UpdateStatus;
  version: string;
  /** Pantalla de actualización abierta. */
  sheetOpen: boolean;
  phase: InstallPhase;
  progress: number;
  check: () => void;
  openSheet: () => void;
  dismiss: () => void;
  install: () => void;
}

/**
 * Consulta GitHub al arrancar. En Android descarga la versión nueva dentro de
 * la app y abre el instalador del sistema; en Windows abre la descarga.
 * Nada se instala sin que la persona toque "Instalar".
 */
export function useUpdateCheck(): UseUpdateCheckResult {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [phase, setPhase] = useState<InstallPhase>("idle");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
  }, []);

  // El código nativo avisa el avance de la descarga.
  useEffect(() => {
    const host = window as Window & { __foyuUpdate?: (percent: number) => void };
    host.__foyuUpdate = (percent) => setProgress(Math.max(0, Math.min(100, percent)));
    return () => {
      delete host.__foyuUpdate;
    };
  }, []);

  const check = useCallback(() => {
    setStatus("checking");
    checkForUpdate()
      .then((found) => {
        setUpdate(found);
        setStatus(found ? "available" : "current");
        // Al abrir FoYu se muestra la pantalla, salvo que ya se pospusiera.
        if (found && !wasDismissed(found.version)) setSheetOpen(true);
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(() => {
    // Pequeña espera para no competir con el arranque del reproductor.
    const timer = window.setTimeout(check, 2500);
    return () => window.clearTimeout(timer);
  }, [check]);

  const dismiss = useCallback(() => {
    if (update) rememberDismissed(update.version);
    setSheetOpen(false);
  }, [update]);

  const openSheet = useCallback(() => setSheetOpen(true), []);

  const runInstaller = useCallback(async (next: AvailableUpdate) => {
    try {
      const result = await installDownloadedUpdate(next.version);
      setPhase(result === "permission" ? "permission" : "installing");
    } catch {
      setPhase("failed");
    }
  }, []);

  const install = useCallback(() => {
    if (!update) return;
    if (!update.apkUrl) {
      rememberDismissed(update.version);
      setSheetOpen(false);
      void openUpdatePage(update.downloadUrl).catch(() => {});
      return;
    }
    if (phase === "downloading") return;
    if (phase === "ready" || phase === "permission" || phase === "installing") {
      void runInstaller(update);
      return;
    }
    setPhase("downloading");
    setProgress(0);
    downloadUpdate(update)
      .then(() => {
        setPhase("ready");
        return runInstaller(update);
      })
      .catch(() => setPhase("failed"));
  }, [phase, runInstaller, update]);

  // Al volver de los ajustes, la pantalla queda lista para tocar "Instalar".
  useEffect(() => {
    if (phase !== "permission") return;
    const resume = () => {
      if (document.visibilityState === "visible") setPhase("ready");
    };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, [phase]);

  const prompt = update && !wasDismissed(update.version) ? update : null;

  return {
    update,
    prompt,
    status,
    version,
    sheetOpen: sheetOpen && update !== null,
    phase,
    progress,
    check,
    openSheet,
    dismiss,
    install,
  };
}
