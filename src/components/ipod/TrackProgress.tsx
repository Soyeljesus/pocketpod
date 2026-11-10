import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

interface TrackProgressProps {
  positionSec: number;
  durationSec: number;
  canSeek: boolean;
  onSeek?: (seconds: number) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Barra de progreso estilo iPod: tiempo transcurrido a la izquierda,
 * tiempo restante (con signo negativo) a la derecha.
 */
export function TrackProgress({
  positionSec,
  durationSec,
  canSeek,
  onSeek,
}: TrackProgressProps) {
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  // Sincroniza el valor de arrastre cuando cambia la posición real.
  useEffect(() => {
    if (!dragging) setDragValue(positionSec);
  }, [positionSec, dragging]);

  const displayPos = dragging ? dragValue : positionSec;
  const pct =
    durationSec > 0
      ? Math.max(0, Math.min(100, (displayPos / durationSec) * 100))
      : 0;
  const remaining = Math.max(0, durationSec - displayPos);

  const updateFromPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setDragValue(ratio * durationSec);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canSeek || durationSec <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    updateFromPointer(e);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    updateFromPointer(e);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setDragging(false);
    onSeek?.(ratio * durationSec);
  };

  return (
    <div className="track-progress">
      <span className="track-progress-time">{formatTime(displayPos)}</span>

      <div
        className={`track-progress-bar ${canSeek ? "seekable" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="track-progress-fill" style={{ width: `${pct}%` }} />
        {canSeek && (
          <div className="track-progress-handle" style={{ left: `${pct}%` }} />
        )}
      </div>

      <span className="track-progress-time track-progress-remaining">
        {durationSec > 0 ? `-${formatTime(remaining)}` : "--:--"}
      </span>
    </div>
  );
}
