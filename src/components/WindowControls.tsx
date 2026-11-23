import { getCurrentWindow } from "@tauri-apps/api/window";

export function WindowControls() {
  return (
    <div className="m-window-controls">
      <button
        type="button"
        className="window-btn window-minimize"
        aria-label="Minimizar"
        title="Minimizar"
        onClick={() => void getCurrentWindow().minimize().catch(() => {})}
      >
        −
      </button>
      <button
        type="button"
        className="window-btn window-maximize"
        aria-label="Maximizar"
        title="Maximizar"
        onClick={() => void getCurrentWindow().toggleMaximize().catch(() => {})}
      >
        ▢
      </button>
      <button
        type="button"
        className="window-btn window-close"
        aria-label="Cerrar"
        title="Cerrar"
        onClick={() => void getCurrentWindow().close().catch(() => {})}
      >
        ×
      </button>
    </div>
  );
}

export function ResizeGrip() {
  return (
    <button
      type="button"
      className="resize-grip"
      aria-label="Redimensionar ventana"
      title="Arrastra para cambiar el tamaño"
      onPointerDown={(event) => {
        event.preventDefault();
        void getCurrentWindow().startResizeDragging("SouthEast").catch(() => {});
      }}
    />
  );
}
