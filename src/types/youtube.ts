/** Fuente de audio activa del iPod. */
export type AudioSource = "system" | "youtube";

/** Canción devuelta por el puente de YouTube Music. */
export interface YoutubeTrack {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  thumbnailUrl: string | null;
}

/** Canción descargada para escuchar sin conexión. */
export interface OfflineTrack extends YoutubeTrack {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  downloadedAt: number;
}

/** Datos del servidor local que expone `/search` y `/stream/{videoId}`. */
export interface MusicBridgeInfo {
  baseUrl: string;
  token: string;
  engine: string;
  available: boolean;
  message: string | null;
}
