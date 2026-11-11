import { useCallback, useEffect, useState } from "react";
import type { AvailableUpdate } from "../services/updates";
import {
  checkForUpdate,
  openUpdatePage,
  rememberDismissed,
} from "../services/updates";

/**
 * Consulta GitHub al arrancar y expone el aviso de actualización.
 * El usuario decide si quiere actualizar o posponerlo.
 */
export function useUpdateCheck() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Pequeña espera para no competir con el arranque y la primera consulta
    // del reproductor.
    const timer = window.setTimeout(() => {
      checkForUpdate()
        .then((found) => {
          if (!cancelled && found) setUpdate(found);
        })
        .catch(() => {
          // Sin red o sin releases: la app sigue funcionando con normalidad.
        });
    }, 2500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const dismiss = useCallback(() => {
    if (update) rememberDismissed(update.version);
    setUpdate(null);
  }, [update]);

  const install = useCallback(() => {
    if (!update) return;
    rememberDismissed(update.version);
    void openUpdatePage(update.downloadUrl).catch(() => {});
    setUpdate(null);
  }, [update]);

  return { update, dismiss, install };
}
