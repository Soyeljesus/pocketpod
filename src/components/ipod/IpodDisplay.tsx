import { useState } from "react";
import type { FormEvent } from "react";
import type { HistoryEntry, MediaState } from "../../types/media";
import type {
  AudioSource,
  OfflineTrack,
  SavedPlaylist,
  YoutubeTrack,
} from "../../types/youtube";
import { countLabel, formatDuration, formatSize } from "../../utils/format";
import { looksLikeLink } from "../../hooks/usePlaylists";
import { DesignToggle } from "../DesignToggle";
import type { AppDesign } from "../DesignToggle";
import { ConnectionStatus } from "./ConnectionStatus";
import { TrackProgress } from "./TrackProgress";

const COLLECTION_PAGE_SIZE = 100;

export type IpodView =
  | "nowPlaying"
  | "menu"
  | "search"
  | "likes"
  | "downloads"
  | "playlists"
  | "playlist"
  | "settings"
  | "remote"
  | "category"
  | "artist"
  | "genres";

export interface IpodDisplayProps {
  design: AppDesign;
  state: MediaState;
  positionSec: number;
  view: IpodView;
  history: HistoryEntry[];
  source: AudioSource;
  currentVideoId: string | null;
  ytCurrent: YoutubeTrack | null;
  ytQueue: YoutubeTrack[];
  ytResults: YoutubeTrack[];
  ytQuery: string;
  ytSearching: boolean;
  ytLoading: boolean;
  ytError: string | null;
  ytLikes: YoutubeTrack[];
  ytDownloads: OfflineTrack[];
  ytDownloadingId: string | null;
  ytDownloadError: string | null;
  playlists: SavedPlaylist[];
  selectedPlaylist: SavedPlaylist | null;
  playlistImporting: boolean;
  playlistError: string | null;
  playlistNotice: string | null;
  libraryBusy: boolean;
  cloudAvailable: boolean;
  onOpenAccount: () => void;
  onExportLibrary: () => void;
  onImportLibrary: () => void;
  onSeek: (seconds: number) => void;
  onToggleDesign: () => void;
  onOpenSearch: () => void;
  onOpenNowPlaying: () => void;
  onOpenLikes: () => void;
  onOpenDownloads: () => void;
  onOpenPlaylists: () => void;
  onOpenPlaylist: (id: string) => void;
  /** Importa si recibe un enlace; si recibe un nombre, crea la playlist. */
  onImportPlaylist: (linkOrName: string) => Promise<boolean>;
  onDeletePlaylist: (id: string) => void;
  onAddToPlaylist: (track: YoutubeTrack) => void;
  onRemoveFromPlaylist: (id: string, videoId: string) => void;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onPlayTrack: (track: YoutubeTrack, queue?: YoutubeTrack[]) => void;
  onToggleLike: (track: YoutubeTrack) => void;
  onDownload: (track: YoutubeTrack) => void;
  onRemoveDownload: (videoId: string) => void;
}

function trackKey(track: { title: string; artist: string }): string {
  return `${track.title}::${track.artist}`.toLowerCase();
}

function RowArt({ url }: { url: string | null | undefined }) {
  return (
    <div className="ipod-menu-art">
      {url ? <img src={url} alt="" loading="lazy" /> : <span>♪</span>}
    </div>
  );
}

interface TrackRowProps {
  track: YoutubeTrack;
  isCurrent: boolean;
  liked: boolean;
  downloaded: boolean;
  downloading: boolean;
  detail?: string;
  onPlay: () => void;
  onToggleLike: (track: YoutubeTrack) => void;
  onDownload: (track: YoutubeTrack) => void;
  onRemoveDownload: (videoId: string) => void;
  onAddToPlaylist: (track: YoutubeTrack) => void;
  onRemoveFromList?: () => void;
}

/**
 * Fila de canción con acciones. El botón principal reproduce; los dos botones
 * laterales (corazón y descarga) quedan fuera de él para no anidar `<button>`
 * dentro de otro `<button>`, que es HTML inválido.
 */
function TrackRow({
  track,
  isCurrent,
  liked,
  downloaded,
  downloading,
  detail,
  onPlay,
  onToggleLike,
  onDownload,
  onRemoveDownload,
  onAddToPlaylist,
  onRemoveFromList,
}: TrackRowProps) {
  return (
    <div className={`ipod-menu-row ipod-track ${isCurrent ? "current" : ""}`}>
      <button
        type="button"
        className="ipod-track-main"
        onClick={onPlay}
        aria-label={`Reproducir ${track.title} de ${track.artist}`}
      >
        <RowArt url={track.thumbnailUrl} />
        <span className="ipod-menu-text">
          <span className="ipod-menu-title">{track.title}</span>
          <span className="ipod-menu-artist">
            {track.artist}
            {track.durationSec > 0
              ? ` · ${formatDuration(track.durationSec)}`
              : ""}
            {detail ? ` · ${detail}` : ""}
          </span>
        </span>
        {isCurrent && (
          <span className="ipod-menu-playing" aria-hidden>
            ▶
          </span>
        )}
      </button>

      <button
        type="button"
        className={`ipod-row-action like ${liked ? "active" : ""}`}
        onClick={() => onToggleLike(track)}
        aria-pressed={liked}
        aria-label={liked ? "Quitar de Me gusta" : "Añadir a Me gusta"}
        title={liked ? "Quitar de Me gusta" : "Me gusta"}
      >
        {liked ? "♥" : "♡"}
      </button>

      {downloading ? (
        <span className="ipod-row-action busy" aria-label="Descargando">
          …
        </span>
      ) : downloaded ? (
        <button
          type="button"
          className="ipod-row-action remove"
          onClick={() => onRemoveDownload(track.videoId)}
          aria-label="Eliminar descarga"
          title="Eliminar descarga"
        >
          ✕
        </button>
      ) : (
        <button
          type="button"
          className="ipod-row-action"
          onClick={() => onDownload(track)}
          aria-label="Descargar para escuchar sin conexión"
          title="Descargar"
        >
          ↓
        </button>
      )}

      {onRemoveFromList ? (
        <button
          type="button"
          className="ipod-row-action remove"
          onClick={onRemoveFromList}
          aria-label="Quitar de esta playlist"
          title="Quitar de esta playlist"
        >
          −
        </button>
      ) : (
        <button
          type="button"
          className="ipod-row-action"
          onClick={() => onAddToPlaylist(track)}
          aria-label="Añadir a una playlist"
          title="Añadir a playlist"
        >
          +
        </button>
      )}
    </div>
  );
}

function MenuView({
  state,
  history,
  source,
  currentVideoId,
  ytQueue,
  ytLikes,
  ytDownloads,
  playlists,
  libraryBusy,
  cloudAvailable,
  onOpenAccount,
  onExportLibrary,
  onImportLibrary,
  onOpenSearch,
  onOpenNowPlaying,
  onOpenLikes,
  onOpenDownloads,
  onOpenPlaylists,
  onPlayTrack,
}: Pick<
  IpodDisplayProps,
  | "state"
  | "history"
  | "source"
  | "currentVideoId"
  | "ytQueue"
  | "ytLikes"
  | "ytDownloads"
  | "playlists"
  | "libraryBusy"
  | "cloudAvailable"
  | "onOpenAccount"
  | "onExportLibrary"
  | "onImportLibrary"
  | "onOpenSearch"
  | "onOpenNowPlaying"
  | "onOpenLikes"
  | "onOpenDownloads"
  | "onOpenPlaylists"
  | "onPlayTrack"
>) {
  const currentKey = trackKey(state);

  return (
    <div className="ipod-menu">
      <div className="ipod-menu-section">Música</div>

      <button type="button" className="ipod-menu-row" onClick={onOpenSearch}>
        <span className="ipod-menu-icon youtube" aria-hidden>
          ♪
        </span>
        <span className="ipod-menu-text">
          <span className="ipod-menu-title">Buscar música</span>
          <span className="ipod-menu-artist">Canciones y artistas</span>
        </span>
        <span className="ipod-menu-playing" aria-hidden>
          ›
        </span>
      </button>

      {cloudAvailable && (
        <button type="button" className="ipod-menu-row" onClick={onOpenAccount}>
          <span className="ipod-menu-icon" aria-hidden>
            ◉
          </span>
          <span className="ipod-menu-text">
            <span className="ipod-menu-title">Cuenta</span>
            <span className="ipod-menu-artist">Sincronizar tu biblioteca</span>
          </span>
        </button>
      )}

      <div className="ipod-menu-section">Biblioteca</div>

      <button type="button" className="ipod-menu-row" onClick={onOpenPlaylists}>
        <span className="ipod-menu-icon" aria-hidden>
          ≡
        </span>
        <span className="ipod-menu-text">
          <span className="ipod-menu-title">Playlists</span>
          <span className="ipod-menu-artist">
            {countLabel(playlists.length, "lista", "listas")}
          </span>
        </span>
        <span className="ipod-menu-playing" aria-hidden>
          ›
        </span>
      </button>

      <button type="button" className="ipod-menu-row" onClick={onOpenLikes}>
        <span className="ipod-menu-icon likes" aria-hidden>
          ♥
        </span>
        <span className="ipod-menu-text">
          <span className="ipod-menu-title">Me gusta</span>
          <span className="ipod-menu-artist">
            {countLabel(ytLikes.length, "canción", "canciones")}
          </span>
        </span>
        <span className="ipod-menu-playing" aria-hidden>
          ›
        </span>
      </button>

      <button type="button" className="ipod-menu-row" onClick={onOpenDownloads}>
        <span className="ipod-menu-icon downloads" aria-hidden>
          ↓
        </span>
        <span className="ipod-menu-text">
          <span className="ipod-menu-title">Descargadas</span>
          <span className="ipod-menu-artist">
            {countLabel(ytDownloads.length, "canción", "canciones")}
            {ytDownloads.length > 0 ? " · sin conexión" : ""}
          </span>
        </span>
        <span className="ipod-menu-playing" aria-hidden>
          ›
        </span>
      </button>

      <button
        type="button"
        className="ipod-menu-row"
        disabled={libraryBusy}
        onClick={onExportLibrary}
      >
        <span className="ipod-menu-icon" aria-hidden>
          ↗
        </span>
        <span className="ipod-menu-text">
          <span className="ipod-menu-title">Exportar biblioteca</span>
          <span className="ipod-menu-artist">Archivo CSV</span>
        </span>
      </button>

      <button
        type="button"
        className="ipod-menu-row"
        disabled={libraryBusy}
        onClick={onImportLibrary}
      >
        <span className="ipod-menu-icon" aria-hidden>
          ↙
        </span>
        <span className="ipod-menu-text">
          <span className="ipod-menu-title">
            {libraryBusy ? "Procesando…" : "Importar archivo"}
          </span>
          <span className="ipod-menu-artist">CSV, M3U, XSPF, JSON o TXT</span>
        </span>
      </button>

      {state.connected && (
        <button type="button" className="ipod-menu-row" onClick={onOpenNowPlaying}>
          <RowArt url={state.artworkDataUrl} />
          <span className="ipod-menu-text">
            <span className="ipod-menu-title">Ahora suena</span>
            <span className="ipod-menu-artist">{state.title}</span>
          </span>
          <span className="ipod-menu-playing" aria-hidden>
            ▶
          </span>
        </button>
      )}

      <div className="ipod-menu-section">
        {source === "youtube" ? "En cola" : "Historial"}
      </div>

      {source === "youtube" ? (
        ytQueue.length === 0 ? (
          <div className="ipod-menu-empty">Busca una canción para llenar la cola</div>
        ) : (
          ytQueue.map((track) => {
            const isCurrent =
              state.connected && currentVideoId === track.videoId;
            return (
              <button
                type="button"
                key={track.videoId}
                className={`ipod-menu-row ${isCurrent ? "current" : ""}`}
                onClick={() => onPlayTrack(track)}
              >
                <RowArt url={track.thumbnailUrl} />
                <span className="ipod-menu-text">
                  <span className="ipod-menu-title">{track.title}</span>
                  <span className="ipod-menu-artist">
                    {track.artist}
                    {track.durationSec > 0
                      ? ` · ${formatDuration(track.durationSec)}`
                      : ""}
                  </span>
                </span>
                {isCurrent && (
                  <span className="ipod-menu-playing" aria-hidden>
                    ▶
                  </span>
                )}
              </button>
            );
          })
        )
      ) : history.length === 0 ? (
        <div className="ipod-menu-empty">Las canciones aparecerán aquí</div>
      ) : (
        history.map((track, index) => {
          const isCurrent =
            state.connected &&
            state.title.length > 0 &&
            trackKey(track) === currentKey;

          return (
            <div
              key={`${track.title}-${track.artist}-${index}`}
              className={`ipod-menu-row ${isCurrent ? "current" : ""}`}
            >
              <RowArt url={track.artworkDataUrl} />
              <div className="ipod-menu-text">
                <span className="ipod-menu-title">{track.title}</span>
                <span className="ipod-menu-artist">{track.artist}</span>
              </div>
              {isCurrent && (
                <span className="ipod-menu-playing" aria-hidden>
                  ▶
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function SearchView({
  ytQuery,
  ytResults,
  ytSearching,
  ytLoading,
  ytError,
  currentVideoId,
  ytLikes,
  ytDownloads,
  ytDownloadingId,
  onQueryChange,
  onSearch,
  onPlayTrack,
  onToggleLike,
  onDownload,
  onRemoveDownload,
  onAddToPlaylist,
}: Pick<
  IpodDisplayProps,
  | "onAddToPlaylist"
  | "ytQuery"
  | "ytResults"
  | "ytSearching"
  | "ytLoading"
  | "ytError"
  | "currentVideoId"
  | "ytLikes"
  | "ytDownloads"
  | "ytDownloadingId"
  | "onQueryChange"
  | "onSearch"
  | "onPlayTrack"
  | "onToggleLike"
  | "onDownload"
  | "onRemoveDownload"
>) {
  return (
    <div className="ipod-search">
      <form
        className="ipod-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <input
          className="ipod-search-input"
          value={ytQuery}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Buscar música"
          aria-label="Buscar música"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        <button type="submit" className="ipod-search-btn">
          Ir
        </button>
      </form>

      {ytSearching || ytLoading ? (
        <div className="ipod-search-status">Buscando…</div>
      ) : ytError ? (
        <div className="ipod-search-status error">{ytError}</div>
      ) : ytResults.length === 0 ? (
        <div className="ipod-search-status">Escribe y pulsa Ir</div>
      ) : null}

      <div className="ipod-menu ipod-search-results">
        {ytResults.map((track) => (
          <TrackRow
            key={track.videoId}
            track={track}
            isCurrent={currentVideoId === track.videoId}
            liked={ytLikes.some((item) => item.videoId === track.videoId)}
            downloaded={ytDownloads.some(
              (item) => item.videoId === track.videoId,
            )}
            downloading={ytDownloadingId === track.videoId}
            onPlay={() => onPlayTrack(track, ytResults)}
            onToggleLike={onToggleLike}
            onDownload={onDownload}
            onRemoveDownload={onRemoveDownload}
            onAddToPlaylist={onAddToPlaylist}
          />
        ))}
      </div>
    </div>
  );
}

function PlaylistsView({
  playlists,
  playlistImporting,
  playlistError,
  playlistNotice,
  onImportPlaylist,
  onOpenPlaylist,
  onDeletePlaylist,
}: Pick<
  IpodDisplayProps,
  | "playlists"
  | "playlistImporting"
  | "playlistError"
  | "playlistNotice"
  | "onImportPlaylist"
  | "onOpenPlaylist"
  | "onDeletePlaylist"
>) {
  const [link, setLink] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onImportPlaylist(link)) setLink("");
  };

  return (
    <div className="ipod-search">
      <form className="ipod-search-form" onSubmit={submit}>
        <input
          className="ipod-search-input"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="Enlace o nombre nuevo"
          aria-label="Enlace de una playlist o nombre de una nueva"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        <button
          type="submit"
          className="ipod-search-btn"
          disabled={playlistImporting || !link.trim()}
        >
          {playlistImporting ? "…" : looksLikeLink(link) ? "Importar" : "Crear"}
        </button>
      </form>

      {playlistError ? (
        <div className="ipod-search-status error">{playlistError}</div>
      ) : playlistNotice ? (
        <div className="ipod-search-status">{playlistNotice}</div>
      ) : null}

      <div className="ipod-menu ipod-search-results">
        {playlists.length === 0 ? (
          <div className="ipod-menu-empty">
            Pega un enlace de Spotify, Apple Music, Deezer o YouTube Music, o
            escribe un nombre
          </div>
        ) : (
          playlists.map((playlist) => (
            <div className="ipod-menu-row ipod-track" key={playlist.id}>
              <button
                type="button"
                className="ipod-track-main"
                onClick={() => onOpenPlaylist(playlist.id)}
              >
                <RowArt url={playlist.tracks[0]?.thumbnailUrl} />
                <span className="ipod-menu-text">
                  <span className="ipod-menu-title">{playlist.title}</span>
                  <span className="ipod-menu-artist">
                    {countLabel(playlist.tracks.length, "canción", "canciones")}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="ipod-row-action remove"
                onClick={() =>
                  confirmingId === playlist.id
                    ? onDeletePlaylist(playlist.id)
                    : setConfirmingId(playlist.id)
                }
                aria-label={
                  confirmingId === playlist.id
                    ? `Confirmar borrado de ${playlist.title}`
                    : `Borrar ${playlist.title}`
                }
                title={confirmingId === playlist.id ? "Confirmar" : "Borrar"}
              >
                {confirmingId === playlist.id ? "?" : "✕"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CollectionView({
  tracks,
  emptyText,
  showSize,
  currentVideoId,
  ytLikes,
  ytDownloads,
  ytDownloadingId,
  ytDownloadError,
  onPlayTrack,
  onToggleLike,
  onDownload,
  onRemoveDownload,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  playlistId,
}: Pick<
  IpodDisplayProps,
  | "currentVideoId"
  | "ytLikes"
  | "ytDownloads"
  | "ytDownloadingId"
  | "ytDownloadError"
  | "onPlayTrack"
  | "onToggleLike"
  | "onDownload"
  | "onRemoveDownload"
  | "onAddToPlaylist"
  | "onRemoveFromPlaylist"
> & {
  tracks: YoutubeTrack[];
  emptyText: string;
  showSize?: boolean;
  playlistId?: string;
}) {
  const [limit, setLimit] = useState(COLLECTION_PAGE_SIZE);

  return (
    <div className="ipod-menu ipod-collection">
      {ytDownloadError && (
        <div className="ipod-search-status error">{ytDownloadError}</div>
      )}

      {tracks.length === 0 ? (
        <div className="ipod-menu-empty">{emptyText}</div>
      ) : (
        tracks.slice(0, limit).map((track) => {
          const saved = ytDownloads.find(
            (item) => item.videoId === track.videoId,
          );
          return (
            <TrackRow
              key={track.videoId}
              track={track}
              isCurrent={currentVideoId === track.videoId}
              liked={ytLikes.some((item) => item.videoId === track.videoId)}
              downloaded={saved !== undefined}
              downloading={ytDownloadingId === track.videoId}
              detail={
                showSize && saved ? formatSize(saved.sizeBytes) : undefined
              }
              onPlay={() => onPlayTrack(track, tracks)}
              onToggleLike={onToggleLike}
              onDownload={onDownload}
              onRemoveDownload={onRemoveDownload}
              onAddToPlaylist={onAddToPlaylist}
              onRemoveFromList={
                playlistId
                  ? () => onRemoveFromPlaylist(playlistId, track.videoId)
                  : undefined
              }
            />
          );
        })
      )}

      {tracks.length > limit && (
        <button
          type="button"
          className="ipod-menu-row ipod-show-more"
          onClick={() => setLimit((value) => value + COLLECTION_PAGE_SIZE)}
        >
          Mostrar más ({tracks.length - limit})
        </button>
      )}
    </div>
  );
}

export function IpodDisplay({
  design,
  state,
  positionSec,
  view,
  history,
  source,
  currentVideoId,
  ytCurrent,
  ytQueue,
  ytResults,
  ytQuery,
  ytSearching,
  ytLoading,
  ytError,
  ytLikes,
  ytDownloads,
  ytDownloadingId,
  ytDownloadError,
  playlists,
  selectedPlaylist,
  playlistImporting,
  playlistError,
  playlistNotice,
  libraryBusy,
  cloudAvailable,
  onOpenAccount,
  onExportLibrary,
  onImportLibrary,
  onSeek,
  onToggleDesign,
  onOpenSearch,
  onOpenNowPlaying,
  onOpenLikes,
  onOpenDownloads,
  onOpenPlaylists,
  onOpenPlaylist,
  onImportPlaylist,
  onDeletePlaylist,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onQueryChange,
  onSearch,
  onPlayTrack,
  onToggleLike,
  onDownload,
  onRemoveDownload,
}: IpodDisplayProps) {
  const hasTrack = state.connected && state.title.length > 0;

  const headerTitle =
    view === "menu"
      ? "Music"
      : view === "search"
        ? "Buscar"
        : view === "likes"
          ? "Me gusta"
          : view === "downloads"
            ? "Descargadas"
            : view === "playlists"
              ? "Playlists"
              : view === "playlist"
                ? (selectedPlaylist?.title ?? "Playlist")
                : "Now Playing";

  const liked = ytCurrent
    ? ytLikes.some((item) => item.videoId === ytCurrent.videoId)
    : false;
  const downloaded = ytCurrent
    ? ytDownloads.some((item) => item.videoId === ytCurrent.videoId)
    : false;
  const downloading = ytCurrent
    ? ytDownloadingId === ytCurrent.videoId
    : false;

  return (
    <div className="ipod-display">
      <div className="ipod-display-header">
        <span className="ipod-display-title">{headerTitle}</span>
        <div className="ipod-display-header-right">
          <DesignToggle design={design} onToggle={onToggleDesign} />
          <span
            className={`source-badge ${source}`}
            title={
              source === "youtube" ? "YouTube Music" : "Spotify / Apple Music"
            }
          >
            {source === "youtube" ? "YT" : "SP"}
          </span>
          <ConnectionStatus connected={state.connected} />
          {state.status === "playing" && (
            <span className="header-play" aria-hidden />
          )}
          <span className="battery" aria-label="Batería">
            <span className="battery-fill" />
          </span>
        </div>
      </div>

      {view === "menu" ? (
        <MenuView
          state={state}
          history={history}
          source={source}
          currentVideoId={currentVideoId}
          ytQueue={ytQueue}
          ytLikes={ytLikes}
          ytDownloads={ytDownloads}
          playlists={playlists}
          libraryBusy={libraryBusy}
          cloudAvailable={cloudAvailable}
          onOpenAccount={onOpenAccount}
          onExportLibrary={onExportLibrary}
          onImportLibrary={onImportLibrary}
          onOpenSearch={onOpenSearch}
          onOpenNowPlaying={onOpenNowPlaying}
          onOpenLikes={onOpenLikes}
          onOpenDownloads={onOpenDownloads}
          onOpenPlaylists={onOpenPlaylists}
          onPlayTrack={onPlayTrack}
        />
      ) : view === "search" ? (
        <SearchView
          ytQuery={ytQuery}
          ytResults={ytResults}
          ytSearching={ytSearching}
          ytLoading={ytLoading}
          ytError={ytError}
          currentVideoId={currentVideoId}
          ytLikes={ytLikes}
          ytDownloads={ytDownloads}
          ytDownloadingId={ytDownloadingId}
          onQueryChange={onQueryChange}
          onSearch={onSearch}
          onPlayTrack={onPlayTrack}
          onToggleLike={onToggleLike}
          onDownload={onDownload}
          onRemoveDownload={onRemoveDownload}
          onAddToPlaylist={onAddToPlaylist}
        />
      ) : view === "playlists" ? (
        <PlaylistsView
          playlists={playlists}
          playlistImporting={playlistImporting}
          playlistError={playlistError}
          playlistNotice={playlistNotice}
          onImportPlaylist={onImportPlaylist}
          onOpenPlaylist={onOpenPlaylist}
          onDeletePlaylist={onDeletePlaylist}
        />
      ) : view === "playlist" ? (
        <CollectionView
          key={selectedPlaylist?.id}
          tracks={selectedPlaylist?.tracks ?? []}
          playlistId={selectedPlaylist?.id}
          emptyText="Busca una canción y pulsa + para añadirla"
          currentVideoId={currentVideoId}
          ytLikes={ytLikes}
          ytDownloads={ytDownloads}
          ytDownloadingId={ytDownloadingId}
          ytDownloadError={ytDownloadError}
          onPlayTrack={onPlayTrack}
          onToggleLike={onToggleLike}
          onDownload={onDownload}
          onRemoveDownload={onRemoveDownload}
          onAddToPlaylist={onAddToPlaylist}
          onRemoveFromPlaylist={onRemoveFromPlaylist}
        />
      ) : view === "likes" ? (
        <CollectionView
          tracks={ytLikes}
          emptyText="Toca el corazón de una canción para guardarla aquí"
          currentVideoId={currentVideoId}
          ytLikes={ytLikes}
          ytDownloads={ytDownloads}
          ytDownloadingId={ytDownloadingId}
          ytDownloadError={ytDownloadError}
          onPlayTrack={onPlayTrack}
          onToggleLike={onToggleLike}
          onDownload={onDownload}
          onRemoveDownload={onRemoveDownload}
          onAddToPlaylist={onAddToPlaylist}
          onRemoveFromPlaylist={onRemoveFromPlaylist}
        />
      ) : view === "downloads" ? (
        <CollectionView
          tracks={ytDownloads}
          emptyText="Descarga una canción para escucharla sin conexión"
          showSize
          currentVideoId={currentVideoId}
          ytLikes={ytLikes}
          ytDownloads={ytDownloads}
          ytDownloadingId={ytDownloadingId}
          ytDownloadError={ytDownloadError}
          onPlayTrack={onPlayTrack}
          onToggleLike={onToggleLike}
          onDownload={onDownload}
          onRemoveDownload={onRemoveDownload}
          onAddToPlaylist={onAddToPlaylist}
          onRemoveFromPlaylist={onRemoveFromPlaylist}
        />
      ) : !hasTrack ? (
        source === "youtube" ? (
          <div className="ipod-display-empty">
            <p className="empty-title">Música</p>
            <p className="empty-sub">
              {ytError ?? "Busca una canción para empezar"}
            </p>
            <button
              type="button"
              className="permission-button"
              onClick={onOpenSearch}
            >
              Buscar música
            </button>
          </div>
        ) : (
          <div className="ipod-display-empty">
            <p className="empty-title">Abre un reproductor</p>
            <p className="empty-sub">Spotify o Apple Music</p>
          </div>
        )
      ) : (
        <div className="now-playing">
          <div className="now-playing-main">
            <div className="ipod-artwork">
              {state.artworkDataUrl ? (
                <img
                  src={state.artworkDataUrl}
                  alt={state.album || state.title}
                />
              ) : (
                <div className="ipod-artwork-placeholder">♪</div>
              )}
            </div>
            <div className="ipod-info">
              <div className="ipod-title" title={state.title}>
                {state.title}
              </div>
              <div className="ipod-artist" title={state.artist}>
                {state.artist}
              </div>
              <div className="ipod-album" title={state.album}>
                {state.album}
              </div>
            </div>
          </div>

          {source === "youtube" && ytCurrent && (
            <>
              <div className="now-playing-actions">
                <button
                  type="button"
                  className={`np-action like ${liked ? "active" : ""}`}
                  onClick={() => onToggleLike(ytCurrent)}
                  aria-pressed={liked}
                >
                  <span aria-hidden>{liked ? "♥" : "♡"}</span>
                  {liked ? "Te gusta" : "Me gusta"}
                </button>

                {downloaded ? (
                  <span className="np-action saved">
                    <span aria-hidden>✓</span> Offline
                  </span>
                ) : (
                  <button
                    type="button"
                    className="np-action"
                    onClick={() => onDownload(ytCurrent)}
                    disabled={downloading}
                  >
                    <span aria-hidden>↓</span>
                    {downloading ? "Descargando…" : "Descargar"}
                  </button>
                )}

                <button
                  type="button"
                  className="np-action"
                  onClick={() => onAddToPlaylist(ytCurrent)}
                >
                  <span aria-hidden>+</span> Lista
                </button>
              </div>
              {ytDownloadError && (
                <div className="ipod-search-status error">
                  {ytDownloadError}
                </div>
              )}
            </>
          )}

          <div className="now-playing-progress">
            <TrackProgress
              positionSec={positionSec}
              durationSec={state.durationSec}
              canSeek={state.canSeek}
              onSeek={onSeek}
            />
          </div>
        </div>
      )}
    </div>
  );
}
