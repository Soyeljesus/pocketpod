// Contrato de datos entre el backend Rust y el frontend React.
// Refleja exactamente lo que GSMTC puede entregar, ya normalizado.

export type PlaybackStatus =
  | "playing"
  | "paused"
  | "stopped"
  | "changing"
  | "unknown";

export interface MediaState {
  /** Título de la canción. Vacío si no hay sesión activa. */
  title: string;
  /** Artista(s). Vacío si no disponible. */
  artist: string;
  /** Álbum. Vacío si no disponible. */
  album: string;
  /**
   * Portada como data URL ("data:image/png;base64,...").
   * null cuando Spotify no expone miniatura.
   */
  artworkDataUrl: string | null;
  /** Estado del transporte. */
  status: PlaybackStatus;
  /** Posición estimada en segundos (interpolada por el backend). */
  positionSec: number;
  /** Duración total en segundos. 0 si desconocida. */
  durationSec: number;
  /** ¿La sesión permite hacer seek? Derivado de IsPlaybackPositionEnabled. */
  canSeek: boolean;
  /** ¿Hay una sesión de Spotify detectada ahora mismo? */
  connected: boolean;
  /** AppID crudo, útil para depurar. */
  sourceAppId: string | null;
  /**
   * En Android indica si la app tiene acceso a las notificaciones, necesario
   * para leer y controlar Spotify/Apple Music. En escritorio es siempre true.
   */
  permissionGranted: boolean;
}

/** Canción que ya se ha reproducido durante esta instalación. */
export interface HistoryEntry {
  title: string;
  artist: string;
  album: string;
  artworkDataUrl: string | null;
}

export const EMPTY_MEDIA_STATE: MediaState = {
  title: "",
  artist: "",
  album: "",
  artworkDataUrl: null,
  status: "unknown",
  positionSec: 0,
  durationSec: 0,
  canSeek: false,
  connected: false,
  sourceAppId: null,
  permissionGranted: true,
};
