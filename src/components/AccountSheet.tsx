import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { UseCloudSyncResult } from "../hooks/useCloudSync";
import { privacyPolicyUrl } from "../services/cloudConfig";

interface AccountSheetProps {
  cloud: UseCloudSyncResult;
  onClose: () => void;
}

function syncLabel(cloud: UseCloudSyncResult) {
  if (cloud.status === "working") return "Sincronizando…";
  if (cloud.status === "error") return "Sincronización pendiente";
  if (cloud.lastSyncedAt) {
    const time = new Date(cloud.lastSyncedAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `Sincronizado a las ${time}`;
  }
  return "Listo para sincronizar";
}

export function AccountSheet({ cloud, onClose }: AccountSheetProps) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section
        className="sheet account-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Cuenta"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-header">
          <div>
            <strong>{cloud.user ? cloud.user.name || "Tu cuenta" : "Tu cuenta de FoYu"}</strong>
            <small>{cloud.user ? cloud.user.email : "Lleva tu música a otros dispositivos"}</small>
          </div>
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
        </header>
        <AccountPanel cloud={cloud} />
      </section>
    </div>
  );
}

/** Opciones de la cuenta: se usa en la hoja del iPod y en Perfil. */
export function AccountPanel({ cloud }: { cloud: UseCloudSyncResult }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busy = cloud.status === "working";
  const policyUrl = privacyPolicyUrl;

  return (
        <div className="account-body">
          {cloud.message && <p className="account-message">{cloud.message}</p>}

          {!cloud.user ? (
            <>
              <ul className="account-list">
                <li>Se guardan tus playlists y tus Me gusta para recuperarlos.</li>
                <li>FoYu no recibe ni guarda tu contraseña de Google.</li>
                <li>Puedes borrar tu cuenta y tus datos cuando quieras.</li>
              </ul>
              <button
                type="button"
                className="account-primary"
                disabled={busy}
                onClick={() => void cloud.signIn()}
              >
                {busy ? "Abriendo Google…" : "Continuar con Google"}
              </button>
            </>
          ) : (
            <>
              <section>
                <h3>Biblioteca</h3>
                <p>{syncLabel(cloud)}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void cloud.syncNow()}
                >
                  Sincronizar ahora
                </button>
              </section>

              <section>
                <h3>YouTube Music</h3>
                <p>
                  Solo lectura. FoYu trae tus playlists y Me gusta de música, y
                  no cambia nada en YouTube.
                </p>
                {cloud.youtubeMessage && (
                  <p className="account-message">{cloud.youtubeMessage}</p>
                )}
                <button
                  type="button"
                  disabled={cloud.youtubeBusy}
                  onClick={() => void cloud.syncYoutube()}
                >
                  {cloud.youtubeBusy
                    ? "Leyendo YouTube Music…"
                    : cloud.youtubeConnected
                      ? "Actualizar YouTube Music"
                      : "Conectar YouTube Music"}
                </button>
                {cloud.youtubeConnected && (
                  <button
                    type="button"
                    disabled={cloud.youtubeBusy}
                    onClick={() => void cloud.disconnectYoutube()}
                  >
                    Desconectar YouTube Music
                  </button>
                )}
              </section>

              <section>
                <h3>Sesión</h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void cloud.signOut(false)}
                >
                  Cerrar sesión
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void cloud.signOut(true)}
                >
                  Cerrar sesión y quitar la biblioteca de este dispositivo
                </button>
              </section>

              <section>
                <h3>Privacidad</h3>
                {confirmDelete ? (
                  <>
                    <p>
                      Se borrarán tu cuenta y tu copia en la nube. Esta acción
                      no se puede deshacer.
                    </p>
                    <button
                      type="button"
                      className="account-danger"
                      disabled={busy}
                      onClick={() => void cloud.deleteAccount()}
                    >
                      Confirmar y borrar mi cuenta
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(true)}>
                    Borrar mi cuenta y mis datos
                  </button>
                )}
              </section>
            </>
          )}

          {policyUrl && (
            <button
              type="button"
              className="account-link"
              onClick={() => void openUrl(policyUrl).catch(() => {})}
            >
              Política de privacidad
            </button>
          )}
        </div>
  );
}
