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

/** Aleatorio normal o inteligente (mezcla recomendaciones parecidas). */
export type ShuffleMode = "off" | "on" | "smart";

/** Próxima canción: añadida a mano, de la lista que suena o recomendada. */
export interface QueueItem {
  track: YoutubeTrack;
  kind: "manual" | "context" | "smart";
  /** Posición dentro de su grupo, para saltar directamente a ella. */
  index: number;
}

/** Tarjeta de descubrimiento: playlist, álbum o canción de YouTube Music. */
export interface DiscoverItem {
  kind: "playlist" | "album" | "song" | "artist";
  id: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  track: YoutubeTrack | null;
}

export interface DiscoverShelf {
  title: string;
  items: DiscoverItem[];
}

export interface DiscoverChip {
  title: string;
  params: string;
}

export interface DiscoverPage {
  chips: DiscoverChip[];
  shelves: DiscoverShelf[];
  header: { title: string; thumbnailUrl: string | null } | null;
}

export interface MoodItem {
  title: string;
  browseId: string;
  params: string;
  color: string | null;
}

export interface MoodGroup {
  title: string;
  items: MoodItem[];
}

/** Lo que se abre desde Inicio: una playlist pública o una categoría. */
export type DiscoverTarget =
  | { kind: "remote"; id: string; title: string; subtitle: string; thumbnailUrl: string | null }
  | { kind: "category"; browseId: string; params: string; title: string; color: string | null }
  | { kind: "artist"; browseId: string; title: string; thumbnailUrl: string | null };

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
