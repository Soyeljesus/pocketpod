import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { AvailableUpdate } from "../services/updates";
import {
  checkForUpdate,
  openUpdatePage,
  rememberDismissed,
  wasDismissed,
} from "../services/updates";

export type UpdateStatus = "idle" | "checking" | "current" | "available" | "error";

export interface UseUpdateCheckResult {
  /** Versión nueva publicada, aunque se haya pospuesto el aviso. */
  update: AvailableUpdate | null;
  /** Aviso emergente: solo si no se pospuso esta versión. */
  prompt: AvailableUpdate | null;
  status: UpdateStatus;
  version: string;
  check: () => void;
  dismiss: () => void;
  install: () => void;
}

/**
 * Consulta GitHub al arrancar. No descarga nada sola: la persona decide
 * cuándo abrir la descarga.
 */
export function useUpdateCheck(): UseUpdateCheckResult {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [promptHidden, setPromptHidden] = useState(false);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState("");

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
  }, []);

  const check = useCallback(() => {
    setStatus("checking");
    checkForUpdate()
      .then((found) => {
        setUpdate(found);
        setStatus(found ? "available" : "current");
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
    setPromptHidden(true);
  }, [update]);

  const install = useCallback(() => {
    if (!update) return;
    rememberDismissed(update.version);
    setPromptHidden(true);
    void openUpdatePage(update.downloadUrl).catch(() => {});
  }, [update]);

  const prompt =
    update && !promptHidden && !wasDismissed(update.version) ? update : null;

  return { update, prompt, status, version, check, dismiss, install };
}
