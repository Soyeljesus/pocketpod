import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AccountPanel } from "../AccountSheet";
import type { UseCloudSyncResult } from "../../hooks/useCloudSync";
import type { UseProfileResult } from "../../hooks/useProfile";
import type { ThemePreference } from "../../hooks/useAppearance";
import type { UseUpdateCheckResult } from "../../hooks/useUpdateCheck";
import { Icon } from "./icons";

export interface ProfileSettings {
  profile: UseProfileResult;
  cloud: UseCloudSyncResult;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  updates: UseUpdateCheckResult;
  crossfade: number;
  onCrossfadeChange: (seconds: number) => void;
}

const CROSSFADES = [0, 3, 6, 9, 12];

export function Avatar({
  photo,
  name,
  className = "",
}: {
  photo: string | null;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <span className={`m-avatar ${className}`} aria-hidden>
      {photo && failed !== photo ? (
        <img
          src={photo}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(photo)}
        />
      ) : initial ? (
        <b>{initial}</b>
      ) : (
        <Icon name="user" />
      )}
    </span>
  );
}

export type ProfileSection = "account" | "settings" | "about";

const MENU: Array<[ProfileSection, string, "user" | "settings" | "info"]> = [
  ["account", "Cuenta", "user"],
  ["settings", "Configuración", "settings"],
  ["about", "Sobre FoYu", "info"],
];

/** Cabecera: aviso de actualización y, al tocar la foto, el menú de la cuenta. */
export function ProfileButtons({
  settings,
  onOpen,
}: {
  settings: ProfileSettings;
  onOpen: (section: ProfileSection) => void;
}) {
  const { update, install } = settings.updates;
  const [open, setOpen] = useState(false);
  const { profile, cloud } = settings;

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  return (
    <div className="m-profile-buttons">
      {update && (
        <button
          type="button"
          className="m-update-pill"
          onClick={install}
          title={`Descargar FoYu ${update.version}`}
        >
          <Icon name="download" />
          <span>Actualizar</span>
        </button>
      )}
      <button
        type="button"
        className="m-avatar-btn"
        onClick={() => setOpen((value) => !value)}
        aria-label="Menú de la cuenta"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar photo={profile.displayPhoto} name={profile.displayName} />
      </button>
      {open && (
        <>
          <div className="m-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="m-menu" role="menu">
            <div className="m-menu-head">
              <Avatar photo={profile.displayPhoto} name={profile.displayName} />
              <span>
                <strong>{profile.displayName || "Tu perfil"}</strong>
                <small>{cloud.user?.email ?? "Sin cuenta"}</small>
              </span>
            </div>
            {MENU.map(([section, label, icon]) => (
              <button
                type="button"
                role="menuitem"
                key={section}
                onClick={() => {
                  setOpen(false);
                  onOpen(section);
                }}
              >
                <Icon name={icon} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const THEMES: Array<[ThemePreference, string]> = [
  ["system", "Sistema"],
  ["dark", "Oscuro"],
  ["light", "Claro"],
];

export function ProfilePanel({
  settings,
  onToggleDesign,
  onClose,
  section = "account",
}: {
  settings: ProfileSettings;
  onToggleDesign: () => void;
  onClose?: () => void;
  section?: ProfileSection;
}) {
  const { profile, cloud, updates } = settings;
  const fileInput = useRef<HTMLInputElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState(profile.name);

  useEffect(() => setDraft(profile.name), [profile.name]);

  // Abre directamente en la sección elegida del menú.
  useEffect(() => {
    if (section === "account") return;
    root.current
      ?.querySelector(`[data-section="${section}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [section]);

  const saveName = () => {
    if (draft.trim() !== profile.name.trim()) profile.setName(draft.trim());
  };

  const updateText =
    updates.status === "checking"
      ? "Buscando…"
      : updates.status === "available" && updates.update
        ? `Disponible FoYu ${updates.update.version}`
        : updates.status === "current"
          ? "Tienes la última versión"
          : updates.status === "error"
            ? "No se pudo comprobar. Revisa tu conexión."
            : "";

  return (
    <div className="m-profile" ref={root}>
      {onClose && (
        <div className="m-profile-top">
          <h2>Perfil y ajustes</h2>
          <button
            type="button"
            className="m-icon-btn filled"
            onClick={onClose}
            aria-label="Cerrar perfil"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      <section className="m-profile-card">
        <button
          type="button"
          className="m-profile-photo"
          onClick={() => fileInput.current?.click()}
          disabled={profile.busy}
          aria-label="Cambiar foto de perfil"
        >
          <Avatar photo={profile.displayPhoto} name={profile.displayName} />
          <span className="m-profile-photo-edit">
            {profile.busy ? <span className="m-spinner" /> : <Icon name="plus" />}
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void profile.setPhoto(file);
          }}
        />
        <label className="m-profile-name">
          <span>Tu nombre</span>
          <input
            value={draft}
            maxLength={60}
            placeholder={cloud.user?.name || "Escribe cómo quieres llamarte"}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
        <small className="m-profile-email">
          {cloud.user ? cloud.user.email : "Sin cuenta: tus datos se quedan en este dispositivo"}
        </small>
        {profile.hasCustomPhoto && (
          <button type="button" className="m-link-btn" onClick={profile.clearPhoto}>
            Quitar foto
          </button>
        )}
        {profile.error && <p className="m-error">{profile.error}</p>}
      </section>

      <section className="m-settings-group">
        <h3>Cuenta</h3>
        {cloud.available ? (
          <AccountPanel cloud={cloud} />
        ) : (
          <p className="m-hint">
            Esta versión no incluye cuentas. Tu música se guarda en este
            dispositivo; usa Exportar e Importar archivo para llevarla a otro.
          </p>
        )}
      </section>

      <section className="m-settings-group" data-section="settings">
        <h3>Apariencia</h3>
        <div className="m-segmented" role="radiogroup" aria-label="Tema">
          {THEMES.map(([id, label]) => (
            <button
              type="button"
              role="radio"
              key={id}
              aria-checked={settings.theme === id}
              className={settings.theme === id ? "active" : ""}
              onClick={() => settings.onThemeChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <h3>Crossfade</h3>
        <p className="m-hint">
          La siguiente canción empieza mientras la actual se apaga.
        </p>
        <div className="m-segmented m-segmented-5" role="radiogroup" aria-label="Crossfade">
          {CROSSFADES.map((seconds) => (
            <button
              type="button"
              role="radio"
              key={seconds}
              aria-checked={settings.crossfade === seconds}
              className={settings.crossfade === seconds ? "active" : ""}
              onClick={() => settings.onCrossfadeChange(seconds)}
            >
              {seconds === 0 ? "No" : `${seconds} s`}
            </button>
          ))}
        </div>
        <button type="button" className="m-settings-row" onClick={onToggleDesign}>
          <Icon name="swap" />
          <span>
            <strong>Diseño iPod clásico</strong>
            <small>Cambia a la rueda click. Vuelve con el mismo botón.</small>
          </span>
        </button>
      </section>

      <section className="m-settings-group">
        <h3>Actualizaciones</h3>
        <p className="m-hint">
          {updates.version ? `Versión ${updates.version}` : "FoYu"}
          {updateText ? ` · ${updateText}` : ""}
        </p>
        {updates.update ? (
          <button type="button" className="m-primary" onClick={updates.install}>
            <Icon name="download" />
            Descargar {updates.update.version}
          </button>
        ) : (
          <button
            type="button"
            className="m-secondary"
            disabled={updates.status === "checking"}
            onClick={updates.check}
          >
            <Icon name="refresh" />
            Buscar actualizaciones
          </button>
        )}
      </section>

      <section className="m-settings-group m-about" data-section="about">
        <h3>Sobre FoYu</h3>
        <p className="m-hint">
          FoYu {updates.version} reúne tu música en un reproductor libre para
          Android y Windows. Tu biblioteca se guarda en tu dispositivo y, si
          inicias sesión, en tu cuenta.
        </p>
        <p className="m-hint">
          Las listas de Inicio salen de YouTube Music: listas de la comunidad,
          géneros y estados de ánimo. Selecciones y «Similares a» se arman con
          tus Me gusta y lo que escuchaste en este dispositivo.
        </p>
        <button
          type="button"
          className="m-settings-row"
          onClick={() => void openUrl("https://github.com/Soyeljesus/pocketpod").catch(() => {})}
        >
          <Icon name="link" />
          <span>
            <strong>Código y novedades</strong>
            <small>github.com/Soyeljesus/pocketpod</small>
          </span>
        </button>
        <p className="m-hint">
          FoYu no está afiliada a YouTube, Google, Spotify, Apple ni Deezer.
          Fuentes Inter y Outfit (SIL OFL). Licencia MIT.
        </p>
      </section>
    </div>
  );
}
