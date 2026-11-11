interface UpdatePromptProps {
  version: string;
  onInstall: () => void;
  onDismiss: () => void;
}

/**
 * Aviso de nueva versión con el mismo lenguaje visual que el iPod.
 * Nunca actualiza sola: el usuario acepta o lo pospone.
 */
export function UpdatePrompt({
  version,
  onInstall,
  onDismiss,
}: UpdatePromptProps) {
  return (
    <div
      className="update-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Actualización disponible"
    >
      <div className="update-card">
        <p className="update-eyebrow">Actualización</p>
        <p className="update-title">PocketPod {version}</p>
        <p className="update-text">
          Hay una versión nueva disponible. ¿Quieres actualizar ahora?
        </p>
        <div className="update-actions">
          <button
            type="button"
            className="update-btn update-btn-ghost"
            onClick={onDismiss}
          >
            Ahora no
          </button>
          <button
            type="button"
            className="update-btn update-btn-primary"
            onClick={onInstall}
          >
            Actualizar
          </button>
        </div>
      </div>
    </div>
  );
}
