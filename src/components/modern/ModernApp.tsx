import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { DesignToggle } from "../DesignToggle";
import { ResizeGrip, WindowControls } from "../WindowControls";
import type { IpodDisplayProps, IpodView } from "../ipod/IpodDisplay";
import { TrackProgress } from "../ipod/TrackProgress";
import type { ArtworkPalette } from "../../hooks/useArtworkAccent";
import { looksLikeLink } from "../../hooks/usePlaylists";
import { IS_ANDROID } from "../../services/mediaBridge";
import type { SavedPlaylist, YoutubeTrack } from "../../types/youtube";
import {
  countLabel,
  formatDuration,
  formatSize,
  formatTotalDuration,
} from "../../utils/format";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/outfit/latin-600.css";
import "@fontsource/outfit/latin-700.css";
import "../../styles/modern.css";

const PAGE_SIZE = 100;

export interface ModernAppProps extends IpodDisplayProps {
  browseView: IpodView;
  optionsTrack: YoutubeTrack | null;
  onOpenTrackOptions: (track: YoutubeTrack) => void;
  onCloseTrackOptions: () => void;
  onOpenMenu: () => void;
  onBack: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  palette: ArtworkPalette;
  shuffle: boolean;
  repeat: boolean;
  onToggleShuffle: () => void;
  onToggleRepeat: () => void;
}

function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}

function hiResArtwork(url: string | null): string | null {
  if (!url) return null;
  return url
    .replace(/=w\d+-h\d+[^/]*$/, "=w720-h720-l90-rj")
    .replace(
      /^(https:\/\/i\.ytimg\.com\/vi\/[^/]+)\/[^/]+$/,
      "$1/hq720.jpg",
    );
}

function closeKeyboard() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function Artwork({ url, label }: { url: string | null; label?: string }) {
  return (
    <span className="m-art">
      {url ? (
        <img src={url} alt={label ?? ""} loading="lazy" />
      ) : (
        <Icon name="note" />
      )}
    </span>
  );
}

/** Usa la portada grande y vuelve a la original si YouTube no la tiene. */
function PlayerArtwork({ url, label }: { url: string | null; label: string }) {
  const hiRes = hiResArtwork(url);
  const [failed, setFailed] = useState<string | null>(null);
  const src = hiRes && hiRes !== failed ? hiRes : url;

  return (
    <span className="m-art">
      {src ? (
        <img
          src={src}
          alt={label}
          onError={() => setFailed(hiRes)}
          onLoad={(event) => {
            if (src === hiRes && event.currentTarget.naturalWidth <= 120) {
              setFailed(hiRes);
            }
          }}
        />
      ) : (
        <Icon name="note" />
      )}
    </span>
  );
}

function PlaylistCover({ playlist }: { playlist: SavedPlaylist }) {
  const covers = [
    ...new Set(
      playlist.tracks
        .map((track) => track.thumbnailUrl)
        .filter((url): url is string => Boolean(url)),
    ),
  ].slice(0, 4);

  if (covers.length < 4) return <Artwork url={covers[0] ?? null} />;
  return (
    <span className="m-art m-collage">
      {covers.map((url) => (
        <img key={url} src={url} alt="" loading="lazy" />
      ))}
    </span>
  );
}

interface TrackListProps {
  tracks: YoutubeTrack[];
  sizes?: Map<string, number>;
  emptyText?: string;
  currentVideoId: string | null;
  playing: boolean;
  likedIds: Set<string>;
  downloadedIds: Set<string>;
  downloadingId: string | null;
  onPlay: (track: YoutubeTrack, queue?: YoutubeTrack[]) => void;
  onToggleLike: (track: YoutubeTrack) => void;
  onMore: (track: YoutubeTrack) => void;
}

const TrackList = memo(function TrackList({
  tracks,
  sizes,
  emptyText,
  currentVideoId,
  playing,
  likedIds,
  downloadedIds,
  downloadingId,
  onPlay,
  onToggleLike,
  onMore,
}: TrackListProps) {
  const [limit, setLimit] = useState(PAGE_SIZE);

  if (tracks.length === 0) {
    return emptyText ? <p className="m-empty">{emptyText}</p> : null;
  }

  return (
    <div className="m-tracks">
      {tracks.slice(0, limit).map((track) => {
        const current = track.videoId === currentVideoId;
        const liked = likedIds.has(track.videoId);
        const downloaded = downloadedIds.has(track.videoId);
        const details = [
          track.artist,
          formatDuration(track.durationSec),
          sizes ? formatSize(sizes.get(track.videoId) ?? 0) : "",
        ].filter(Boolean);

        return (
          <div
            key={track.videoId}
            className={`m-track ${current ? "current" : ""}`}
          >
            <button
              type="button"
              className="m-track-main"
              onClick={() => onPlay(track, tracks)}
              aria-label={`Reproducir ${track.title} de ${track.artist}`}
            >
              <span className="m-track-art">
                <Artwork url={track.thumbnailUrl} />
                {current && (
                  <span className={`m-eq ${playing ? "on" : ""}`} aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </span>
              <span className="m-track-text">
                <strong>{track.title}</strong>
                <small>
                  {downloaded && <Icon name="check" />}
                  {details.join(" · ")}
                </small>
              </span>
            </button>
            <button
              type="button"
              className={`m-icon-btn ${liked ? "accent" : ""}`}
              onClick={() => onToggleLike(track)}
              aria-pressed={liked}
              aria-label={liked ? "Quitar de Me gusta" : "Añadir a Me gusta"}
            >
              <Icon name={liked ? "heartFilled" : "heart"} />
            </button>
            {downloadingId === track.videoId ? (
              <span className="m-icon-btn" aria-label="Descargando">
                <span className="m-spinner" />
              </span>
            ) : (
              <button
                type="button"
                className="m-icon-btn"
                onClick={() => onMore(track)}
                aria-label={`Más opciones de ${track.title}`}
              >
                <Icon name="more" />
              </button>
            )}
          </div>
        );
      })}
      {tracks.length > limit && (
        <button
          type="button"
          className="m-more"
          onClick={() => setLimit((value) => value + PAGE_SIZE)}
        >
          Mostrar más ({tracks.length - limit})
        </button>
      )}
    </div>
  );
});

type SharedListProps = Pick<
  TrackListProps,
  | "currentVideoId"
  | "playing"
  | "likedIds"
  | "downloadedIds"
  | "downloadingId"
  | "onPlay"
  | "onToggleLike"
  | "onMore"
>;

interface ScreenProps {
  app: ModernAppProps;
  list: SharedListProps;
}

type HomeFilter = "all" | "likes" | "downloads" | "queue";

function uniqueTracks(groups: YoutubeTrack[][]): YoutubeTrack[] {
  const seen = new Set<string>();
  return groups.flat().filter((track) => {
    if (seen.has(track.videoId)) return false;
    seen.add(track.videoId);
    return true;
  });
}

function HomeScreen({ app, list }: ScreenProps) {
  const [filter, setFilter] = useState<HomeFilter>("all");
  const pool = useMemo(() => {
    if (filter === "likes") return app.ytLikes;
    if (filter === "downloads") return app.ytDownloads;
    if (filter === "queue") return app.ytQueue;
    return uniqueTracks([
      app.ytQueue.slice(0, 40),
      app.ytLikes.slice(0, 40),
      app.ytDownloads.slice(0, 40),
      ...app.playlists.map((playlist) => playlist.tracks.slice(0, 12)),
    ]);
  }, [filter, app.ytQueue, app.ytLikes, app.ytDownloads, app.playlists]);
  const filters: Array<[HomeFilter, string, boolean]> = [
    ["all", "Para ti", true],
    ["likes", "Me gusta", app.ytLikes.length > 0],
    ["downloads", "Descargadas", app.ytDownloads.length > 0],
    ["queue", "En cola", app.ytQueue.length > 0],
  ];
  const quick = pool.slice(0, 6);
  const more = pool.slice(6, 11);
  const isEmpty = pool.length === 0 && app.playlists.length === 0;

  return (
    <>
      <h1 className="m-brand">
        <img src="/favicon.png" alt="" />
        FoYu
      </h1>

      {isEmpty ? (
        <section className="m-welcome">
          <h2>Empieza con tu música</h2>
          <p>Busca una canción o trae una playlist desde otro servicio.</p>
          <div>
            <button type="button" className="m-primary" onClick={app.onOpenSearch}>
              <Icon name="search" />
              Buscar
            </button>
            <button
              type="button"
              className="m-secondary"
              onClick={app.onOpenPlaylists}
            >
              <Icon name="link" />
              Importar
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="m-chips">
            {filters
              .filter(([, , visible]) => visible)
              .map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  className={filter === id ? "active" : ""}
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
          </div>

          {quick.length > 0 && (
            <section className="m-first">
              <h2>Acceso rápido</h2>
              <div className="m-quick">
                {quick.map((track) => {
                  const current = track.videoId === list.currentVideoId;
                  return (
                    <button
                      type="button"
                      key={track.videoId}
                      className="m-quick-tile"
                      onClick={() =>
                        current ? app.onOpenNowPlaying() : app.onPlayTrack(track, pool)
                      }
                      aria-label={`Reproducir ${track.title} de ${track.artist}`}
                    >
                      <PlayerArtwork url={track.thumbnailUrl} label="" />
                      {current && (
                        <i>
                          <Icon name={list.playing ? "pause" : "play"} />
                        </i>
                      )}
                      <span>{track.title}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {app.playlists.length > 0 && (
        <section>
          <h2>Tus playlists</h2>
          <div className="m-shelf">
            {app.playlists.slice(0, 12).map((playlist) => (
              <button
                type="button"
                key={playlist.id}
                className="m-shelf-item"
                onClick={() => app.onOpenPlaylist(playlist.id)}
              >
                <PlaylistCover playlist={playlist} />
                <strong>{playlist.title}</strong>
                <small>{playlist.tracks.length} canciones</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {more.length > 0 && (
        <section>
          <h2>Selección rápida</h2>
          <TrackList {...list} tracks={more} />
        </section>
      )}

      {app.history.length > 0 && (
        <section>
          <h2>Sonó en otras apps</h2>
          <div className="m-tracks">
            {app.history.slice(0, 5).map((track, index) => (
              <div className="m-track" key={`${track.title}-${index}`}>
                <span className="m-track-main">
                  <span className="m-track-art">
                    <Artwork url={track.artworkDataUrl} />
                  </span>
                  <span className="m-track-text">
                    <strong>{track.title}</strong>
                    <small>{track.artist}</small>
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function SearchScreen({ app, list }: ScreenProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    closeKeyboard();
    app.onSearch();
  };

  return (
    <>
      <h1 className="m-title">Buscar</h1>
      <form className="m-field" onSubmit={submit} role="search">
        <Icon name="search" />
        <input
          value={app.ytQuery}
          onChange={(event) => app.onQueryChange(event.target.value)}
          placeholder="Canción o artista"
          aria-label="Buscar canciones"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        <button type="submit" disabled={app.ytSearching}>
          Buscar
        </button>
      </form>

      {app.ytSearching ? (
        <p className="m-empty">Buscando…</p>
      ) : app.ytError ? (
        <p className="m-error">{app.ytError}</p>
      ) : (
        <TrackList
          {...list}
          tracks={app.ytResults}
          emptyText="Escribe una canción o un artista"
        />
      )}
    </>
  );
}

function LibraryTabs({ view, app }: { view: IpodView; app: ModernAppProps }) {
  const tabs: Array<[IpodView, string, () => void]> = [
    ["playlists", "Playlists", app.onOpenPlaylists],
    ["likes", "Me gusta", app.onOpenLikes],
    ["downloads", "Descargadas", app.onOpenDownloads],
  ];

  return (
    <div className="m-chips">
      {tabs.map(([id, label, open]) => (
        <button
          type="button"
          key={id}
          className={view === id ? "active" : ""}
          onClick={open}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function PlaylistsScreen({ app }: { app: ModernAppProps }) {
  const [value, setValue] = useState("");
  const isLink = looksLikeLink(value);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    closeKeyboard();
    if (await app.onImportPlaylist(value)) setValue("");
  };

  return (
    <>
      <h1 className="m-title">Biblioteca</h1>
      <LibraryTabs view="playlists" app={app} />

      <form className="m-field" onSubmit={submit}>
        <Icon name={isLink ? "link" : "plus"} />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Pega un enlace o crea una"
          aria-label="Enlace de una playlist o nombre de una nueva"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        <button type="submit" disabled={app.playlistImporting || !value.trim()}>
          {app.playlistImporting ? "Importando…" : isLink ? "Importar" : "Crear"}
        </button>
      </form>
      {app.playlistError ? (
        <p className="m-error">{app.playlistError}</p>
      ) : app.playlistNotice ? (
        <p className="m-hint">{app.playlistNotice}</p>
      ) : (
        <p className="m-hint">
          Funciona con playlists públicas de Spotify, Apple Music, Deezer y
          YouTube Music. Escribe un nombre para crear la tuya.
        </p>
      )}

      <div className="m-library-actions">
        <button
          type="button"
          disabled={app.libraryBusy}
          onClick={app.onExportLibrary}
        >
          <Icon name="download" />
          Exportar
        </button>
        <button
          type="button"
          disabled={app.libraryBusy}
          onClick={app.onImportLibrary}
        >
          {app.libraryBusy ? <span className="m-spinner" /> : <Icon name="link" />}
          {app.libraryBusy ? "Procesando…" : "Importar archivo"}
        </button>
      </div>

      <div className="m-tracks">
        {app.playlists.map((playlist) => (
          <button
            type="button"
            key={playlist.id}
            className="m-playlist-row"
            onClick={() => app.onOpenPlaylist(playlist.id)}
          >
            <span className="m-track-art">
              <PlaylistCover playlist={playlist} />
            </span>
            <span className="m-track-text">
              <strong>{playlist.title}</strong>
              <small>
                {playlist.source} · {playlist.tracks.length} canciones
              </small>
            </span>
            <Icon name="chevron" />
          </button>
        ))}
      </div>
      {app.playlists.length === 0 && (
        <p className="m-empty">Aún no has importado ninguna playlist</p>
      )}
    </>
  );
}

function PlaylistScreen({
  playlist,
  app,
  list,
}: ScreenProps & { playlist: SavedPlaylist }) {
  const [confirming, setConfirming] = useState(false);
  const total = useMemo(
    () => playlist.tracks.reduce((sum, track) => sum + track.durationSec, 0),
    [playlist.tracks],
  );
  const cover = playlist.tracks.find((track) => track.thumbnailUrl)?.thumbnailUrl;

  const playAll = (random: boolean) => {
    const queue = random ? shuffled(playlist.tracks) : playlist.tracks;
    if (queue[0]) app.onPlayTrack(queue[0], queue);
  };

  return (
    <>
      <div className="m-hero">
        <PlayerArtwork key={cover} url={cover ?? null} label="" />
      </div>

      <div className="m-hero-copy">
        <h1>{playlist.title}</h1>
        <p>
          {[
            playlist.source,
            `${playlist.tracks.length} canciones`,
            formatTotalDuration(total),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="m-actions">
        <button
          type="button"
          className="m-icon-btn filled"
          disabled={playlist.tracks.length === 0}
          onClick={() => playAll(true)}
          aria-label="Reproducir en aleatorio"
          title="Aleatorio"
        >
          <Icon name="shuffle" />
        </button>
        <button
          type="button"
          className="m-primary"
          disabled={playlist.tracks.length === 0}
          onClick={() => playAll(false)}
        >
          <Icon name="play" />
          Reproducir
        </button>
        {playlist.sourceLink && (
          <button
            type="button"
            className="m-icon-btn filled"
            disabled={app.playlistImporting}
            onClick={() => void app.onImportPlaylist(playlist.sourceLink ?? "")}
            aria-label="Actualizar playlist"
            title="Actualizar playlist"
          >
            {app.playlistImporting ? (
              <span className="m-spinner" />
            ) : (
              <Icon name="refresh" />
            )}
          </button>
        )}
        {confirming ? (
          <button
            type="button"
            className="m-danger"
            onClick={() => app.onDeletePlaylist(playlist.id)}
          >
            ¿Borrar?
          </button>
        ) : (
          <button
            type="button"
            className="m-icon-btn filled"
            onClick={() => setConfirming(true)}
            aria-label="Borrar playlist"
            title="Borrar playlist"
          >
            <Icon name="trash" />
          </button>
        )}
      </div>

      {app.playlistError && <p className="m-error">{app.playlistError}</p>}
      {app.playlistNotice && <p className="m-hint">{app.playlistNotice}</p>}
      <TrackList
        key={playlist.id}
        {...list}
        tracks={playlist.tracks}
        emptyText="Busca una canción, abre sus opciones y añádela aquí"
      />
    </>
  );
}

function TrackOptions({
  track,
  app,
  playlist,
  onClose,
}: {
  track: YoutubeTrack;
  app: ModernAppProps;
  playlist: SavedPlaylist | null;
  onClose: () => void;
}) {
  const downloaded = app.ytDownloads.some(
    (item) => item.videoId === track.videoId,
  );
  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Opciones de ${track.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-header">
          <div>
            <strong>{track.title}</strong>
            <small>{track.artist}</small>
          </div>
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
        </header>
        <div className="sheet-list">
          <button type="button" onClick={() => run(() => app.onAddToPlaylist(track))}>
            <span>Añadir a una playlist</span>
          </button>
          <button
            type="button"
            onClick={() =>
              run(() =>
                downloaded
                  ? app.onRemoveDownload(track.videoId)
                  : app.onDownload(track),
              )
            }
          >
            <span>{downloaded ? "Eliminar descarga" : "Descargar"}</span>
          </button>
          {playlist && (
            <button
              type="button"
              onClick={() =>
                run(() => app.onRemoveFromPlaylist(playlist.id, track.videoId))
              }
            >
              <span>Quitar de esta playlist</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function FullPlayer({
  app,
  list,
  onClose,
}: ScreenProps & { onClose: () => void }) {
  const { state, ytCurrent } = app;
  const [queueOpen, setQueueOpen] = useState(false);
  const isYoutube = app.source === "youtube" && ytCurrent !== null;
  const playing = state.status === "playing";
  const liked =
    isYoutube && app.ytLikes.some((item) => item.videoId === ytCurrent.videoId);
  const downloaded =
    isYoutube &&
    app.ytDownloads.some((item) => item.videoId === ytCurrent.videoId);
  const downloading = isYoutube && app.ytDownloadingId === ytCurrent.videoId;
  const message = isYoutube ? (app.ytError ?? app.ytDownloadError) : null;

  return (
    <>
      <section className="m-player" aria-label="Reproductor">
        <div className="m-player-top">
          <button
            type="button"
            className="m-icon-btn filled"
            onClick={onClose}
            aria-label="Cerrar reproductor"
          >
            <Icon name="down" />
          </button>
          <div>
            <small>Sonando desde</small>
            <strong>{state.album || "FoYu"}</strong>
          </div>
          <span aria-hidden />
        </div>

        <div className={`m-player-art ${playing ? "" : "paused"}`}>
          <PlayerArtwork
            key={state.artworkDataUrl}
            url={state.artworkDataUrl}
            label={state.album || state.title}
          />
        </div>

        <div className="m-player-info">
          <div className="m-track-text">
            <strong>{state.title}</strong>
            <small>{state.artist}</small>
          </div>
          {isYoutube && (
            <div className="m-player-actions">
              <button
                type="button"
                className={`m-icon-btn filled ${downloaded ? "accent" : ""}`}
                disabled={downloaded || downloading}
                onClick={() => app.onDownload(ytCurrent)}
                aria-label={downloaded ? "Descargada" : "Descargar"}
              >
                {downloading ? (
                  <span className="m-spinner" />
                ) : (
                  <Icon name={downloaded ? "check" : "download"} />
                )}
              </button>
              <button
                type="button"
                className={`m-icon-btn filled ${liked ? "accent" : ""}`}
                onClick={() => app.onToggleLike(ytCurrent)}
                aria-pressed={liked}
                aria-label={liked ? "Quitar de Me gusta" : "Añadir a Me gusta"}
              >
                <Icon name={liked ? "heartFilled" : "heart"} />
              </button>
            </div>
          )}
        </div>

        {message && <p className="m-error">{message}</p>}

        <TrackProgress
          positionSec={app.positionSec}
          durationSec={state.durationSec}
          canSeek={state.canSeek}
          onSeek={app.onSeek}
        />

        <div className="m-transport">
          <button type="button" onClick={app.onPrevious} aria-label="Anterior">
            <Icon name="previous" />
          </button>
          <button
            type="button"
            className="m-transport-main"
            onClick={app.onPlayPause}
            aria-label={playing ? "Pausar" : "Reproducir"}
          >
            {app.ytLoading && isYoutube ? (
              <span className="m-spinner" />
            ) : (
              <>
                <Icon name={playing ? "pause" : "play"} />
                {playing ? "Pausa" : "Play"}
              </>
            )}
          </button>
          <button type="button" onClick={app.onNext} aria-label="Siguiente">
            <Icon name="next" />
          </button>
        </div>

        {isYoutube && (
          <div className="m-player-extras">
            <button
              type="button"
              className={app.shuffle ? "active" : ""}
              onClick={app.onToggleShuffle}
              aria-pressed={app.shuffle}
              aria-label="Aleatorio"
            >
              <Icon name="shuffle" />
            </button>
            <button
              type="button"
              className={app.repeat ? "active" : ""}
              onClick={app.onToggleRepeat}
              aria-pressed={app.repeat}
              aria-label="Repetir canción"
            >
              <Icon name="repeat" />
            </button>
            <button
              type="button"
              onClick={() => app.onAddToPlaylist(ytCurrent)}
              aria-label="Añadir a una playlist"
            >
              <Icon name="plus" />
            </button>
            <button
              type="button"
              onClick={() => setQueueOpen(true)}
              aria-label="Ver cola"
            >
              <Icon name="queue" />
            </button>
          </div>
        )}
      </section>

      {queueOpen && (
        <div className="sheet-backdrop" onClick={() => setQueueOpen(false)}>
          <section
            className="sheet m-queue"
            role="dialog"
            aria-modal="true"
            aria-label="Cola de reproducción"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="sheet-header">
              <div>
                <strong>Cola</strong>
                <small>{countLabel(app.ytQueue.length, "canción", "canciones")}</small>
              </div>
              <button type="button" onClick={() => setQueueOpen(false)}>
                Cerrar
              </button>
            </header>
            <div className="m-queue-list">
              <TrackList
                {...list}
                tracks={app.ytQueue}
                emptyText="La cola está vacía"
              />
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function MiniPlayer({ app }: { app: ModernAppProps }) {
  const { state } = app;
  const playing = state.status === "playing";
  const isYoutube = app.source === "youtube";
  const progress =
    state.durationSec > 0
      ? Math.min(100, (app.positionSec / state.durationSec) * 100)
      : 0;
  const detail = isYoutube && app.ytError ? app.ytError : state.artist;

  return (
    <div className="m-mini">
      <button
        type="button"
        className="m-mini-main"
        onClick={app.onOpenNowPlaying}
        aria-label={`Abrir reproductor: ${state.title}`}
      >
        <Artwork url={state.artworkDataUrl} />
        <span className="m-track-text">
          <strong>{state.title}</strong>
          <small>{detail}</small>
        </span>
      </button>
      <button
        type="button"
        className="m-icon-btn"
        onClick={app.onPlayPause}
        aria-label={playing ? "Pausar" : "Reproducir"}
      >
        {app.ytLoading && isYoutube ? (
          <span className="m-spinner" />
        ) : (
          <Icon name={playing ? "pause" : "play"} />
        )}
      </button>
      <button
        type="button"
        className="m-icon-btn"
        onClick={app.onNext}
        aria-label="Siguiente"
      >
        <Icon name="next" />
      </button>
      <span className="m-mini-progress" style={{ width: `${progress}%` }} />
    </div>
  );
}

export function ModernApp(props: ModernAppProps) {
  const { state, browseView, view } = props;
  const hasTrack = state.connected && state.title.length > 0;
  const playerOpen = view === "nowPlaying" && hasTrack;
  const onMore = useStableCallback(props.onOpenTrackOptions);

  const onPlay = useStableCallback(props.onPlayTrack);
  const onToggleLike = useStableCallback(props.onToggleLike);

  const likedIds = useMemo(
    () => new Set(props.ytLikes.map((track) => track.videoId)),
    [props.ytLikes],
  );
  const downloadedIds = useMemo(
    () => new Set(props.ytDownloads.map((track) => track.videoId)),
    [props.ytDownloads],
  );
  const sizes = useMemo(
    () =>
      new Map(
        props.ytDownloads.map((track) => [track.videoId, track.sizeBytes]),
      ),
    [props.ytDownloads],
  );

  const list: SharedListProps = {
    currentVideoId: props.currentVideoId,
    playing: state.status === "playing",
    likedIds,
    downloadedIds,
    downloadingId: props.ytDownloadingId,
    onPlay,
    onToggleLike,
    onMore,
  };

  const screen: IpodView =
    browseView === "playlist" && !props.selectedPlaylist
      ? "playlists"
      : browseView;
  const activeTab =
    screen === "menu" || screen === "nowPlaying"
      ? "menu"
      : screen === "search"
        ? "search"
        : "library";

  const tabs: Array<[string, string, IconName, () => void]> = [
    ["menu", "Inicio", "home", props.onOpenMenu],
    ["search", "Buscar", "search", props.onOpenSearch],
    ["library", "Biblioteca", "library", props.onOpenPlaylists],
  ];

  return (
    <div
      className={`m-root ${hasTrack ? "has-track" : ""} ${
        screen === "playlist" ? "on-playlist" : ""
      }`}
      style={
        {
          "--m-accent": props.palette.accent,
          "--m-tint": props.palette.tint,
          "--m-deep": props.palette.deep,
        } as CSSProperties
      }
    >
      <div className="m-ambient" aria-hidden />

      <header className="m-header" data-tauri-drag-region>
        {screen === "playlist" && (
          <button
            type="button"
            className="m-icon-btn filled"
            onClick={props.onBack}
            aria-label="Volver"
          >
            <Icon name="back" />
          </button>
        )}
        <DesignToggle design="modern" onToggle={props.onToggleDesign} />
        <span
          className={`m-source ${props.source}`}
          title={
            props.source === "youtube"
              ? "Sonando en la app"
              : "Sonando en Spotify o Apple Music"
          }
        >
          {props.source === "youtube" ? "YT" : "SP"}
        </span>
        <span className="m-header-space" data-tauri-drag-region />
        {props.cloudAvailable && (
          <button
            type="button"
            className="m-icon-btn filled"
            onClick={props.onOpenAccount}
            aria-label="Cuenta"
            title="Cuenta"
          >
            <Icon name="user" />
          </button>
        )}
        {!IS_ANDROID && <WindowControls />}
      </header>

      <main className="m-main" key={`${screen}-${props.selectedPlaylist?.id}`}>
        {screen === "search" ? (
          <SearchScreen app={props} list={list} />
        ) : screen === "playlists" ? (
          <PlaylistsScreen app={props} />
        ) : screen === "playlist" && props.selectedPlaylist ? (
          <PlaylistScreen
            app={props}
            list={list}
            playlist={props.selectedPlaylist}
          />
        ) : screen === "likes" ? (
          <>
            <h1 className="m-title">Biblioteca</h1>
            <LibraryTabs view="likes" app={props} />
            <TrackList
              {...list}
              tracks={props.ytLikes}
              emptyText="Toca el corazón de una canción para guardarla aquí"
            />
          </>
        ) : screen === "downloads" ? (
          <>
            <h1 className="m-title">Biblioteca</h1>
            <LibraryTabs view="downloads" app={props} />
            {props.ytDownloadError && (
              <p className="m-error">{props.ytDownloadError}</p>
            )}
            <TrackList
              {...list}
              sizes={sizes}
              tracks={props.ytDownloads}
              emptyText="Descarga una canción para escucharla sin conexión"
            />
          </>
        ) : (
          <HomeScreen app={props} list={list} />
        )}
      </main>

      <div className="m-dock">
        {hasTrack && <MiniPlayer app={props} />}
        <nav className="m-nav" aria-label="Navegación principal">
          {tabs.map(([id, label, icon, open]) => (
            <button
              type="button"
              key={id}
              className={activeTab === id ? "active" : ""}
              aria-current={activeTab === id ? "page" : undefined}
              onClick={open}
            >
              <Icon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>

      {playerOpen && (
        <FullPlayer app={props} list={list} onClose={props.onBack} />
      )}
      {props.optionsTrack && (
        <TrackOptions
          track={props.optionsTrack}
          app={props}
          playlist={screen === "playlist" ? props.selectedPlaylist : null}
          onClose={props.onCloseTrackOptions}
        />
      )}
      {!IS_ANDROID && <ResizeGrip />}
    </div>
  );
}
