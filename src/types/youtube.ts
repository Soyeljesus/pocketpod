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

/** Playlist importada por enlace. */
export interface ImportedPlaylist {
  id: string;
  title: string;
  source: string;
  skipped: number;
  tracks: YoutubeTrack[];
}

/** Playlist importada o creada, guardada en este dispositivo. */
export interface SavedPlaylist {
  id: string;
  title: string;
  source: string;
  sourceLink: string | null;
  tracks: YoutubeTrack[];
  importedAt: number;
  updatedAt: number;
  /** La lista viene de la cuenta de YouTube Music conectada. */
  youtubeSynced: boolean;
}

export interface YoutubeList {
  id: string;
  title: string;
  tracks: YoutubeTrack[];
}

/** Lectura de la biblioteca de la cuenta de YouTube Music. */
export interface YoutubeLibrary {
  playlists: YoutubeList[];
  likes: YoutubeTrack[];
  skipped: number;
}

/** Grupo de canciones leído de un archivo importado. */
export interface ImportedCollection {
  id: string;
  name: string;
  kind: "playlist" | "likes";
  source: string;
  sourceLink: string | null;
  tracks: YoutubeTrack[];
}

export interface LibraryImportResult {
  collections: ImportedCollection[];
  imported: number;
  skipped: number;
}

/** Datos del servidor local que expone `/search` y `/stream/{videoId}`. */
export interface MusicBridgeInfo {
  baseUrl: string;
  token: string;
  engine: string;
  available: boolean;
  message: string | null;
}
