import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type IpodTheme = "classic-white" | "classic-black";

interface IpodShellProps {
  children: ReactNode;
  theme?: IpodTheme;
}

/**
 * Carcasa exterior del iPod: proporciones, materiales, sombras y los
 * controles de ventana (minimizar / cerrar / redimensionar).
 */
export function IpodShell({ children, theme = "classic-white" }: IpodShellProps) {
  const minimize = () => {
    void getCurrentWindow().minimize().catch(() => {});
  };

  const close = () => {
    void getCurrentWindow().close().catch(() => {});
  };

  const startResize = () => {
    void getCurrentWindow().startResizeDragging("SouthEast").catch(() => {});
  };

  return (
    <div className={`ipod-shell ipod-${theme}`}>
      <div className="ipod-shell-inner">
        <div className="ipod-titlebar" data-tauri-drag-region>
          <span className="ipod-titlebar-grip" data-tauri-drag-region />
          <button
            type="button"
            className="window-btn window-minimize"
            aria-label="Minimizar"
            title="Minimizar"
            onClick={minimize}
          >
            −
          </button>
          <button
            type="button"
            className="window-btn window-close"
            aria-label="Cerrar"
            title="Cerrar"
            onClick={close}
          >
            ×
          </button>
        </div>
        {children}
      </div>

      <button
        type="button"
        className="resize-grip"
        aria-label="Redimensionar iPod"
        title="Arrastra para cambiar el tamaño"
        onPointerDown={(event) => {
          event.preventDefault();
          startResize();
        }}
      />
    </div>
  );
}
