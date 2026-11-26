import type { UseUpdateCheckResult } from "../hooks/useUpdateCheck";
import { formatSize } from "../utils/format";

/**
 * Convierte el texto de la release en títulos, viñetas y párrafos. Las líneas
 * cortadas a mitad de frase se unen al párrafo anterior.
 */
function noteLines(notes: string) {
  const lines: Array<{ text: string; heading: boolean; bullet: boolean }> = [];
  let joinable = false;
  for (const raw of notes.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line || /^[-=*_]{3,}$/.test(line)) {
      joinable = false;
      continue;
    }
    const heading = /^#{1,6}\s+/.test(line);
    const bullet = /^[-*•]\s+/.test(line);
    const text = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*•]\s+/, "")
      .replace(/\*\*|__|`/g, "");
    const previous = lines[lines.length - 1];
    if (joinable && previous && !heading && !bullet) {
      previous.text = `${previous.text} ${text}`;
    } else {
      lines.push({ text, heading, bullet });
    }
    joinable = !heading;
  }
  return lines.slice(0, 40);
}

const PHASE_TEXT: Record<string, string> = {
  downloading: "Descargando…",
  ready: "Descarga lista. Toca Instalar.",
  permission:
    "Android pide permitir que FoYu instale actualizaciones. Activa el permiso y vuelve.",
  installing: "Sigue los pasos del instalador de Android.",
  failed: "No se pudo descargar. Revisa tu conexión e inténtalo de nuevo.",
};

/** Pantalla de actualización: novedades, tamaño y botón para instalar. */
export function UpdateSheet({ updates }: { updates: UseUpdateCheckResult }) {
  const { update, phase, progress } = updates;
  if (!update || !updates.sheetOpen) return null;
  const busy = phase === "downloading";
  const lines = noteLines(update.notes);
  const label = busy
    ? `Descargando ${progress}%`
    : phase === "installing"
      ? "Abrir instalador"
      : update.apkUrl
        ? "Instalar"
        : "Descargar";

  return (
    <div className="sheet-backdrop update-backdrop">
      <section className="sheet update-sheet" role="dialog" aria-modal="true" aria-label="Actualización">
        <div className="update-head">
          <img src="/favicon.png" alt="" />
          <div>
            <small>Actualización disponible</small>
            <strong>FoYu {update.version}</strong>
            {update.sizeBytes > 0 && <small>{formatSize(update.sizeBytes)}</small>}
          </div>
        </div>

        <div className="update-notes">
          {lines.length > 0 ? (
            lines.map((line, index) =>
              line.heading ? (
                <h4 key={index}>{line.text}</h4>
              ) : (
                <p key={index} className={line.bullet ? "bullet" : ""}>
                  {line.text}
                </p>
              ),
            )
          ) : (
            <p>Mejoras y correcciones.</p>
          )}
        </div>

        {phase !== "idle" && (
          <div className="update-status">
            {busy && (
              <span className="update-bar">
                <i style={{ width: `${progress}%` }} />
              </span>
            )}
            <p>{PHASE_TEXT[phase]}</p>
          </div>
        )}

        <div className="update-actions">
          <button type="button" className="update-install" disabled={busy} onClick={updates.install}>
            {label}
          </button>
          <button type="button" className="update-later" disabled={busy} onClick={updates.dismiss}>
            Más tarde
          </button>
        </div>
        <p className="update-hint">Tu música, playlists y descargas se conservan al actualizar.</p>
      </section>
    </div>
  );
}
