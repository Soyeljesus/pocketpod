import type { HistoryEntry, MediaState } from "../../types/media";
import type {
  AudioSource,
  OfflineTrack,
  YoutubeTrack,
} from "../../types/youtube";
import { ConnectionStatus } from "./ConnectionStatus";
import { TrackProgress } from "./TrackProgress";

export type IpodView =
  | "nowPlaying"
  | "menu"
  | "search"
  | "likes"
  | "downloads";

interface IpodDisplayProps {
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
  onSeek: (seconds: number) => void;
  onRequestPermission?: () => void;
  onToggleSource: () => void;
  onOpenSearch: () => void;
  onOpenNowPlaying: () => void;
  onOpenLikes: () => void;
  onOpenDownloads: () => void;
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

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb.toFixed(1)} MB`;
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
  onToggleSource,
  onOpenSearch,
  onOpenNowPlaying,
  onOpenLikes,
  onOpenDownloads,
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
  | "onToggleSource"
  | "onOpenSearch"
  | "onOpenNowPlaying"
  | "onOpenLikes"
  | "onOpenDownloads"
  | "onPlayTrack"
>) {
  const sourceLabel =
    source === "youtube" ? "YouTube Music" : "Spotify / Apple Music";
  const currentKey = trackKey(state);

  const countLabel = (count: number, singular: string, plural: string) =>
    count === 0 ? "Vacío" : `${count} ${count === 1 ? singular : plural}`;

  return (
    <div className="ipod-menu">
      <div className="ipod-menu-section">Fuente</div>

      <button type="button" className="ipod-menu-row" onClick={onOpenSearch}>
        <span className="ipod-menu-icon youtube" aria-hidden>
          YT
        </span>
        <span className="ipod-menu-text">
          <span className="ipod-menu-title">YouTube Music</span>
          <span className="ipod-menu-artist">Buscar y reproducir gratis</span>
        </span>
        <span className="ipod-menu-playing" aria-hidden>
          ›
        </span>
      </button>

      <button type="button" className="ipod-menu-row" onClick={onToggleSource}>
        <span className="ipod-menu-icon" aria-hidden>
          ⇄
        </span>
        <span className="ipod-menu-text">
          <span className="ipod-menu-title">Fuente: {sourceLabel}</span>
          <span className="ipod-menu-artist">Pulsa para cambiar</span>
        </span>
      </button>

      <div className="ipod-menu-section">Biblioteca</div>

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
        {source === "youtube" ? "Cola de YouTube" : "Historial"}
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
}: Pick<
  IpodDisplayProps,
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
          placeholder="Buscar en YouTube Music"
          aria-label="Buscar en YouTube Music"
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
          />
        ))}
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
> & { tracks: YoutubeTrack[]; emptyText: string; showSize?: boolean }) {
  return (
    <div className="ipod-menu ipod-collection">
      {ytDownloadError && (
        <div className="ipod-search-status error">{ytDownloadError}</div>
      )}

      {tracks.length === 0 ? (
        <div className="ipod-menu-empty">{emptyText}</div>
      ) : (
        tracks.map((track) => {
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
            />
          );
        })
      )}
    </div>
  );
}

export function IpodDisplay({
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
  onSeek,
  onRequestPermission,
  onToggleSource,
  onOpenSearch,
  onOpenNowPlaying,
  onOpenLikes,
  onOpenDownloads,
  onQueryChange,
  onSearch,
  onPlayTrack,
  onToggleLike,
  onDownload,
  onRemoveDownload,
}: IpodDisplayProps) {
  const hasTrack = state.connected && state.title.length > 0;
  const needsPermission = state.permissionGranted === false;

  const headerTitle =
    view === "menu"
      ? "Music"
      : view === "search"
        ? "YouTube Music"
        : view === "likes"
          ? "Me gusta"
          : view === "downloads"
            ? "Descargadas"
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
          onToggleSource={onToggleSource}
          onOpenSearch={onOpenSearch}
          onOpenNowPlaying={onOpenNowPlaying}
          onOpenLikes={onOpenLikes}
          onOpenDownloads={onOpenDownloads}
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
        />
      ) : !hasTrack ? (
        needsPermission && source === "system" ? (
          <div className="ipod-display-empty">
            <p className="empty-title">Activa el acceso</p>
            <p className="empty-sub">Ajustes › Acceso a notificaciones</p>
            <button
              type="button"
              className="permission-button"
              onClick={onRequestPermission}
            >
              Permitir acceso
            </button>
          </div>
        ) : source === "youtube" ? (
          <div className="ipod-display-empty">
            <p className="empty-title">YouTube Music</p>
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
