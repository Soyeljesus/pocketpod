interface ClickWheelProps {
  isPlaying: boolean;
  onMenu?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onPlayPause?: () => void;
  onSelect?: () => void;
}

/**
 * Rueda de control con 4 zonas (arriba/abajo/izq/der) + botón central.
 *
 * La detección de clics se hace con SVG: cuatro "sectores anulares"
 * que cubren la corona de la rueda pero no el botón central.
 * El fondo y las etiquetas son capas HTML/CSS superpuestas.
 */
export function ClickWheel({
  isPlaying,
  onMenu,
  onPrevious,
  onNext,
  onPlayPause,
  onSelect,
}: ClickWheelProps) {
  return (
    <div className="click-wheel">
      <div className="click-wheel-ring" aria-hidden />

      <span className="click-wheel-label label-top">MENU</span>
      <span className="click-wheel-label label-left" aria-hidden>
        ◀◀
      </span>
      <span className="click-wheel-label label-right" aria-hidden>
        ▶▶
      </span>
      <span className="click-wheel-label label-bottom">
        {isPlaying ? "❚❚" : "▶"}
      </span>

      <svg className="click-wheel-hit" viewBox="0 0 140 140">
        <path
          className="wheel-zone"
          d="M 20.5,20.5 A 70,70 0 0 1 119.5,20.5 L 88.4,51.6 A 26,26 0 0 0 51.6,51.6 Z"
          onClick={onMenu}
          role="button"
          aria-label="Menu"
        />
        <path
          className="wheel-zone"
          d="M 119.5,20.5 A 70,70 0 0 1 119.5,119.5 L 88.4,88.4 A 26,26 0 0 0 88.4,51.6 Z"
          onClick={onNext}
          role="button"
          aria-label="Siguiente"
        />
        <path
          className="wheel-zone"
          d="M 119.5,119.5 A 70,70 0 0 1 20.5,119.5 L 51.6,88.4 A 26,26 0 0 0 88.4,88.4 Z"
          onClick={onPlayPause}
          role="button"
          aria-label="Reproducir o pausar"
        />
        <path
          className="wheel-zone"
          d="M 20.5,119.5 A 70,70 0 0 1 20.5,20.5 L 51.6,51.6 A 26,26 0 0 0 51.6,88.4 Z"
          onClick={onPrevious}
          role="button"
          aria-label="Anterior"
        />
      </svg>

      <button
        className="click-wheel-center"
        onClick={onSelect}
        aria-label="Seleccionar"
      />
    </div>
  );
}