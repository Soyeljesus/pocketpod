import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { DesignToggle } from "../DesignToggle";
import { ResizeGrip, WindowControls } from "../WindowControls";
import type { IpodDisplayProps, IpodView } from "../ipod/IpodDisplay";
import { TrackProgress } from "../ipod/TrackProgress";
import type { ArtworkPalette } from "../../hooks/useArtworkAccent";
import { looksLikeLink } from "../../hooks/usePlaylists";
import { IS_ANDROID } from "../../services/mediaBridge";
import type { SearchSuggestions } from "../../services/youtubeMusic";
import type {
  DiscoverItem,
  DiscoverPage,
  DiscoverShelf,
  DiscoverTarget,
  ImportedPlaylist,
  MoodGroup,
  QueueItem,
  SavedPlaylist,
  ShuffleMode,
  YoutubeTrack,
} from "../../types/youtube";
import type { UseDiscoverResult } from "../../hooks/useDiscover";
import { fetchDiscover, fetchPlaylist, lookupMusic } from "../../services/youtubeMusic";
import type {
  HTMLAttributes,
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

const LONG_PRESS_MS = 480;

/** Dejar presionado (o clic derecho en PC) abre el menú de la canción. */
function useLongPress(onLong: () => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const latest = useRef(onLong);
  useEffect(() => {
    latest.current = onLong;
  });
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const trigger = () => {
    fired.current = true;
    navigator.vibrate?.(12);
    latest.current();
  };
  return {
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      clear();
      timer.current = window.setTimeout(trigger, LONG_PRESS_MS);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      const origin = start.current;
      if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (event: ReactMouseEvent) => {
      event.preventDefault();
      clear();
      if (!fired.current) trigger();
    },
    onClickCapture: (event: ReactMouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

function LongPressRow({
  onLong,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { onLong: () => void }) {
  const handlers = useLongPress(onLong);
  return <div {...rest} {...handlers} />;
}
import {
  formatDuration,
  formatSize,
  formatTotalDuration,
} from "../../utils/format";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { ProfileButtons, ProfilePanel } from "./ProfilePanel";
import type { ProfileSection, ProfileSettings } from "./ProfilePanel";
import type { ResolvedTheme } from "../../hooks/useAppearance";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/outfit/latin-600.css";
import "@fontsource/outfit/latin-700.css";
import "../../styles/modern.css";
import "../../styles/foyu-layout.css";

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
  shuffleMode: ShuffleMode;
  smartLoading: boolean;
  repeat: boolean;
  upNext: QueueItem[];
  suggestions: SearchSuggestions;
  onCycleShuffle: () => void;
  onToggleRepeat: () => void;
  onPlayCollection: (tracks: YoutubeTrack[], mode: ShuffleMode) => void;
  onAddToQueue: (track: YoutubeTrack) => void;
  onPlayNext: (track: YoutubeTrack) => void;
  onRemoveFromQueue: (item: QueueItem) => void;
  onJumpTo: (item: QueueItem) => void;
  onSearchText: (text: string) => void;
  settings: ProfileSettings;
  theme: ResolvedTheme;
  onOpenSettings: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  discover: UseDiscoverResult;
  discoverTarget: DiscoverTarget | null;
  ytPlayed: YoutubeTrack[];
  onOpenTarget: (target: DiscoverTarget) => void;
  onOpenGenres: () => void;
  onSaveRemote: (playlist: ImportedPlaylist, title: string) => void;
}

const SHUFFLE_LABELS: Record<ShuffleMode, string> = {
  off: "Aleatorio desactivado",
  on: "Aleatorio",
  smart: "Aleatorio inteligente",
};

/** Botones para reproducir una sección entera: en orden, mezclada o inteligente. */
function CollectionActions({
  tracks,
  app,
  children,
}: {
  tracks: YoutubeTrack[];
  app: ModernAppProps;
  children?: ReactNode;
}) {
  if (tracks.length === 0) return null;
  return (
    <div className="m-actions m-collection-actions">
      <button
        type="button"
        className="m-primary"
        onClick={() => app.onPlayCollection(tracks, "off")}
      >
        <Icon name="play" />
        Reproducir
      </button>
      <button
        type="button"
        className="m-icon-btn filled"
        onClick={() => app.onPlayCollection(tracks, "on")}
        aria-label="Reproducir en aleatorio"
        title="Aleatorio"
      >
        <Icon name="shuffle" />
      </button>
      <button
        type="button"
        className="m-icon-btn filled m-smart-btn"
        onClick={() => app.onPlayCollection(tracks, "smart")}
        aria-label="Aleatorio inteligente: mezcla canciones parecidas"
        title="Aleatorio inteligente"
      >
        <Icon name="sparkle" />
      </button>
      {children}
    </div>
  );
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
          <LongPressRow
            key={track.videoId}
            className={`m-track ${current ? "current" : ""}`}
            onLong={() => onMore(track)}
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
          </LongPressRow>
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

function greeting(name: string): string {
  const hour = new Date().getHours();
  const base = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
  const first = name.trim().split(/\s+/)[0];
  return first ? `${base}, ${first}` : base;
}

/** Tarjeta cuadrada de una canción: al tocarla suena con el resto de su sección. */
function TrackCard({
  track,
  queue,
  app,
  list,
}: {
  track: YoutubeTrack;
  queue: YoutubeTrack[];
  app: ModernAppProps;
  list: SharedListProps;
}) {
  const current = track.videoId === list.currentVideoId;
  const liked = list.likedIds.has(track.videoId);
  const press = useLongPress(() => list.onMore(track));
  return (
    <div className="m-shelf-item m-card">
      <button
        type="button"
        className="m-card-main"
        onClick={() => (current ? app.onOpenNowPlaying() : app.onPlayTrack(track, queue))}
        aria-label={`Reproducir ${track.title} de ${track.artist}`}
        {...press}
      >
        <span className="m-card-art">
          <PlayerArtwork url={track.thumbnailUrl} label="" />
          <i className={current ? "on" : ""}>
            <Icon name={current && list.playing ? "pause" : "play"} />
          </i>
        </span>
        <strong>{track.title}</strong>
        <small>{track.artist}</small>
      </button>
      <button
        type="button"
        className={`m-card-like ${liked ? "on" : ""}`}
        onClick={() => list.onToggleLike(track)}
        aria-pressed={liked}
        aria-label={liked ? "Quitar de Me gusta" : "Añadir a Me gusta"}
      >
        <Icon name={liked ? "heartFilled" : "heart"} />
      </button>
    </div>
  );
}

function DiscoverCard({
  item,
  queue,
  app,
  list,
}: {
  item: DiscoverItem;
  queue: YoutubeTrack[];
  app: ModernAppProps;
  list: SharedListProps;
}) {
  if (item.kind === "song" && item.track) {
    return <TrackCard track={item.track} queue={queue} app={app} list={list} />;
  }
  return (
    <button
      type="button"
      className={`m-shelf-item m-card ${item.kind === "artist" ? "m-card-artist" : ""}`}
      onClick={() =>
        app.onOpenTarget(
          item.kind === "artist"
            ? { kind: "artist", browseId: item.id, title: item.title, thumbnailUrl: item.thumbnailUrl }
            : {
                kind: "remote",
                id: item.id,
                title: item.title,
                subtitle: item.subtitle,
                thumbnailUrl: item.thumbnailUrl,
              },
        )
      }
    >
      <span className="m-card-art">
        <PlayerArtwork url={item.thumbnailUrl} label="" />
      </span>
      <strong>{item.title}</strong>
      <small>{item.subtitle}</small>
    </button>
  );
}

function Shelves({
  shelves,
  app,
  list,
}: {
  shelves: DiscoverShelf[];
  app: ModernAppProps;
  list: SharedListProps;
}) {
  return (
    <>
      {shelves.map((shelf) => {
        const songs = shelf.items
          .map((item) => item.track)
          .filter((track): track is YoutubeTrack => track !== null);
        return (
          <section key={shelf.title}>
            <h2>{shelf.title}</h2>
            <div className="m-shelf">
              {shelf.items.map((item) => (
                <DiscoverCard
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  queue={songs}
                  app={app}
                  list={list}
                />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

/** Columnas de 4 canciones que se deslizan de lado, como las Selecciones. */
function PicksGrid({ tracks, list }: { tracks: YoutubeTrack[]; list: SharedListProps }) {
  return (
    <div className="m-picks">
      {tracks.map((track) => {
        const current = track.videoId === list.currentVideoId;
        const liked = list.likedIds.has(track.videoId);
        return (
          <LongPressRow
            className={`m-track m-pick ${current ? "current" : ""}`}
            key={track.videoId}
            onLong={() => list.onMore(track)}
          >
            <button
              type="button"
              className="m-track-main"
              onClick={() => list.onPlay(track, tracks)}
              aria-label={`Reproducir ${track.title} de ${track.artist}`}
            >
              <span className="m-track-art">
                <Artwork url={track.thumbnailUrl} />
              </span>
              <span className="m-track-text">
                <strong>{track.title}</strong>
                <small>{track.artist}</small>
              </span>
            </button>
            <button
              type="button"
              className={`m-icon-btn ${liked ? "accent" : ""}`}
              onClick={() => list.onToggleLike(track)}
              aria-pressed={liked}
              aria-label={liked ? "Quitar de Me gusta" : "Añadir a Me gusta"}
            >
              <Icon name={liked ? "heartFilled" : "heart"} />
            </button>
            <button
              type="button"
              className="m-icon-btn"
              onClick={() => list.onMore(track)}
              aria-label={`Más opciones de ${track.title}`}
            >
              <Icon name="more" />
            </button>
          </LongPressRow>
        );
      })}
    </div>
  );
}

function MoodTiles({
  moods,
  app,
  limit,
}: {
  moods: MoodGroup[];
  app: ModernAppProps;
  limit?: number;
}) {
  return (
    <>
      {moods.map((group) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
          <div className="m-moods">
            {group.items.slice(0, limit ?? group.items.length).map((mood) => (
              <button
                type="button"
                key={mood.params}
                className="m-mood"
                style={{ "--m-mood": mood.color ?? "var(--m-accent)" } as CSSProperties}
                onClick={() =>
                  app.onOpenTarget({
                    kind: "category",
                    browseId: mood.browseId,
                    params: mood.params,
                    title: mood.title,
                    color: mood.color,
                  })
                }
              >
                {mood.title}
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function HomeScreen({ app, list }: ScreenProps) {
  const discover = app.discover;
  const recent = app.ytPlayed.slice(0, 14);
  const empty =
    !discover.chip &&
    recent.length === 0 &&
    discover.picks.length === 0 &&
    discover.shelves.length === 0 &&
    app.playlists.length === 0 &&
    !discover.shelvesLoading;

  return (
    <>
      <h1 className="m-brand">
        <img src="/favicon.png" alt="" />
        FoYu
      </h1>
      <p className="m-greeting">{greeting(app.settings.profile.displayName)}</p>

      <div className="m-chips m-chips-scroll">
        <button
          type="button"
          className={!discover.chip ? "active" : ""}
          aria-pressed={!discover.chip}
          onClick={() => discover.selectChip(null)}
        >
          Para ti
        </button>
        {discover.chips.map((chip) => (
          <button
            type="button"
            key={chip.params}
            className={discover.chip?.params === chip.params ? "active" : ""}
            aria-pressed={discover.chip?.params === chip.params}
            onClick={() => discover.selectChip(chip)}
          >
            {chip.title}
          </button>
        ))}
      </div>

      {discover.chip ? (
        <>
          {discover.shelvesLoading && <p className="m-empty">Cargando…</p>}
          {discover.shelvesError && <p className="m-error">{discover.shelvesError}</p>}
          <Shelves shelves={discover.shelves} app={app} list={list} />
        </>
      ) : (
        <>
          {empty && (
            <section className="m-welcome">
              <h2>Empieza con tu música</h2>
              <p>
                Busca una canción o dale Me gusta: con eso FoYu arma tus
                Selecciones y mezclas parecidas a lo que te gusta.
              </p>
              <div>
                <button type="button" className="m-primary" onClick={app.onOpenSearch}>
                  <Icon name="search" />
                  Buscar
                </button>
                <button type="button" className="m-secondary" onClick={app.onOpenPlaylists}>
                  <Icon name="link" />
                  Importar
                </button>
              </div>
            </section>
          )}

          {(discover.picks.length > 0 || discover.personalLoading) && (
            <section className="m-first">
              <div className="m-section-head">
                <h2>Selecciones</h2>
                <button
                  type="button"
                  className="m-icon-btn"
                  onClick={discover.refreshPersonal}
                  disabled={discover.personalLoading}
                  aria-label="Nuevas selecciones"
                  title="Nuevas selecciones"
                >
                  {discover.personalLoading ? <span className="m-spinner" /> : <Icon name="refresh" />}
                </button>
              </div>
              {discover.picks.length > 0 ? (
                <PicksGrid tracks={discover.picks} list={list} />
              ) : (
                <p className="m-hint">Buscando canciones para ti…</p>
              )}
            </section>
          )}

          {recent.length > 0 && (
            <section>
              <h2>Sigue escuchando</h2>
              <div className="m-shelf">
                {recent.map((track) => (
                  <TrackCard key={track.videoId} track={track} queue={recent} app={app} list={list} />
                ))}
              </div>
            </section>
          )}

          {discover.similar.map((mix) => (
            <section key={mix.artist}>
              <h2>
                <small className="m-overline">Similares a</small>
                {mix.artist}
              </h2>
              <div className="m-shelf">
                {mix.tracks.map((track) => (
                  <TrackCard key={track.videoId} track={track} queue={mix.tracks} app={app} list={list} />
                ))}
              </div>
            </section>
          ))}

          {discover.shelvesError && (
            <div className="m-notice">
              <span>No se pudieron cargar las listas de la comunidad.</span>
              <button type="button" onClick={discover.retry}>
                Reintentar
              </button>
            </div>
          )}
          <Shelves shelves={discover.shelves} app={app} list={list} />

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

          {discover.moods.length > 0 && (
            <>
              <MoodTiles moods={discover.moods.slice(0, 1)} app={app} limit={8} />
              <button type="button" className="m-see-all" onClick={app.onOpenGenres}>
                <Icon name="compass" />
                Ver géneros y estados de ánimo
              </button>
            </>
          )}
        </>
      )}
    </>
  );
}

const remoteCache = new Map<string, Promise<ImportedPlaylist>>();

function loadRemote(id: string) {
  let found = remoteCache.get(id);
  if (!found) {
    found = fetchPlaylist(id);
    found.catch(() => remoteCache.delete(id));
    remoteCache.set(id, found);
  }
  return found;
}

/** Playlist de la comunidad o álbum abierto desde Inicio, sin guardarlo aún. */
function RemoteScreen({
  target,
  app,
  list,
}: ScreenProps & { target: Extract<DiscoverTarget, { kind: "remote" }> }) {
  const [playlist, setPlaylist] = useState<ImportedPlaylist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = app.playlists.some((item) => item.id === target.id);

  useEffect(() => {
    let active = true;
    setPlaylist(null);
    setError(null);
    loadRemote(target.id)
      .then((found) => {
        if (active) setPlaylist(found);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [target.id]);

  const tracks = playlist?.tracks ?? [];
  const total = tracks.reduce((sum, track) => sum + track.durationSec, 0);

  return (
    <>
      <div className="m-hero">
        <PlayerArtwork key={target.thumbnailUrl} url={target.thumbnailUrl} label="" />
      </div>
      <div className="m-hero-copy">
        <h1>{target.title}</h1>
        <p>
          {[
            target.subtitle.split(" • ")[0],
            playlist ? `${tracks.length} canciones` : "",
            total > 0 ? formatTotalDuration(total) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {playlist && (
        <CollectionActions tracks={tracks} app={app}>
          <button
            type="button"
            className={`m-icon-btn filled ${saved ? "accent" : ""}`}
            disabled={saved}
            onClick={() => app.onSaveRemote(playlist, target.title)}
            aria-label={saved ? "Guardada en tu biblioteca" : "Guardar en tu biblioteca"}
            title={saved ? "Guardada" : "Guardar en biblioteca"}
          >
            <Icon name={saved ? "check" : "plus"} />
          </button>
        </CollectionActions>
      )}

      {error ? (
        <p className="m-error">{error}</p>
      ) : !playlist ? (
        <p className="m-empty">Cargando canciones…</p>
      ) : (
        <TrackList key={target.id} {...list} tracks={tracks} emptyText="Esta lista no tiene canciones" />
      )}
    </>
  );
}

const categoryCache = new Map<string, Promise<DiscoverPage>>();

function CategoryScreen({
  target,
  app,
  list,
}: ScreenProps & { target: Extract<DiscoverTarget, { kind: "category" }> }) {
  const [page, setPage] = useState<DiscoverPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let found = categoryCache.get(target.params);
    if (!found) {
      found = fetchDiscover({ browseId: target.browseId, params: target.params });
      found.catch(() => categoryCache.delete(target.params));
      categoryCache.set(target.params, found);
    }
    setPage(null);
    setError(null);
    found
      .then((next) => {
        if (active) setPage(next);
      })
      .catch(() => {
        if (active) setError("No se pudo cargar. Revisa tu conexión.");
      });
    return () => {
      active = false;
    };
  }, [target.browseId, target.params]);

  return (
    <>
      <div
        className="m-category-head"
        style={{ "--m-mood": target.color ?? "var(--m-accent)" } as CSSProperties}
      >
        <h1 className="m-title">{target.title}</h1>
      </div>
      {error && <p className="m-error">{error}</p>}
      {!page && !error && <p className="m-empty">Cargando…</p>}
      {page && <Shelves shelves={page.shelves} app={app} list={list} />}
    </>
  );
}

const artistCache = new Map<string, Promise<DiscoverPage>>();

/** Página de un artista: canciones más escuchadas, álbumes, singles y parecidos. */
function ArtistScreen({
  target,
  app,
  list,
}: ScreenProps & { target: Extract<DiscoverTarget, { kind: "artist" }> }) {
  const [page, setPage] = useState<DiscoverPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let found = artistCache.get(target.browseId);
    if (!found) {
      found = fetchDiscover({ browseId: target.browseId });
      found.catch(() => artistCache.delete(target.browseId));
      artistCache.set(target.browseId, found);
    }
    setPage(null);
    setError(null);
    found
      .then((next) => {
        if (active) setPage(next);
      })
      .catch(() => {
        if (active) setError("No se pudo cargar el artista. Revisa tu conexión.");
      });
    return () => {
      active = false;
    };
  }, [target.browseId]);

  const songs = useMemo(() => {
    const seen = new Set<string>();
    return (page?.shelves ?? [])
      .flatMap((shelf) => shelf.items)
      .map((item) => item.track)
      .filter((track): track is YoutubeTrack => {
        if (!track || seen.has(track.videoId)) return false;
        seen.add(track.videoId);
        return true;
      });
  }, [page]);
  const photo = page?.header?.thumbnailUrl ?? target.thumbnailUrl;

  return (
    <>
      <div className="m-hero m-artist-hero">
        <PlayerArtwork key={photo} url={photo} label="" />
      </div>
      <div className="m-hero-copy">
        <h1>{page?.header?.title ?? target.title}</h1>
        {songs.length > 0 && <p>{songs.length} canciones para empezar</p>}
      </div>
      {songs.length > 0 && <CollectionActions tracks={songs} app={app} />}
      {error && <p className="m-error">{error}</p>}
      {!page && !error && <p className="m-empty">Cargando…</p>}
      {page && <Shelves shelves={page.shelves} app={app} list={list} />}
    </>
  );
}

function GenresScreen({ app }: { app: ModernAppProps }) {
  return (
    <>
      <h1 className="m-title">Explorar</h1>
      {app.discover.moods.length === 0 ? (
        <p className="m-empty">Cargando géneros…</p>
      ) : (
        <MoodTiles moods={app.discover.moods} app={app} />
      )}
    </>
  );
}

const topCache = new Map<string, Promise<DiscoverItem | null>>();

function SearchScreen({ app, list }: ScreenProps) {
  const [focused, setFocused] = useState(false);
  const [top, setTop] = useState<DiscoverItem | null>(null);

  // Resultado principal: el artista más escuchado que coincide con lo escrito.
  useEffect(() => {
    const text = app.ytQuery.trim().toLowerCase();
    if (text.length < 2) {
      setTop(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      let found = topCache.get(text);
      if (!found) {
        found = lookupMusic("top", text).catch(() => null);
        topCache.set(text, found);
      }
      void found.then((item) => {
        if (active) setTop(item);
      });
    }, 500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [app.ytQuery]);
  const { queries, tracks: songMatches } = app.suggestions;
  const typed = app.ytQuery.trim().toLowerCase();
  const visibleQueries = queries.filter((item) => item.toLowerCase() !== typed);
  const showSuggestions =
    focused && typed.length >= 2 && (visibleQueries.length > 0 || songMatches.length > 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    closeKeyboard();
    app.onSearch();
  };

  const pickQuery = (text: string) => {
    closeKeyboard();
    setFocused(false);
    app.onSearchText(text);
  };

  return (
    <>
      <h1 className="m-title">Buscar</h1>
      <div className="m-search-box">
        <form className="m-field" onSubmit={submit} role="search">
          <Icon name="search" />
          <input
            value={app.ytQuery}
            onChange={(event) => app.onQueryChange(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 150)}
            placeholder="Canción o artista"
            aria-label="Buscar canciones"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          {app.ytQuery && (
            <button
              type="button"
              className="m-field-clear"
              onClick={() => app.onQueryChange("")}
              aria-label="Borrar búsqueda"
            >
              <Icon name="close" />
            </button>
          )}
        </form>

        {showSuggestions && (
          <div className="m-suggest" role="listbox" aria-label="Sugerencias">
            {songMatches.map((track) => (
              <button
                type="button"
                role="option"
                aria-selected={false}
                key={track.videoId}
                className="m-suggest-song"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  closeKeyboard();
                  setFocused(false);
                  app.onPlayTrack(track, [track, ...app.ytResults.filter(
                    (item) => item.videoId !== track.videoId,
                  )]);
                }}
              >
                <span className="m-track-art">
                  <Artwork url={track.thumbnailUrl} />
                </span>
                <span className="m-track-text">
                  <strong>{track.title}</strong>
                  <small>Canción · {track.artist}</small>
                </span>
                <Icon name="play" />
              </button>
            ))}
            {visibleQueries.map((text) => (
              <button
                type="button"
                role="option"
                aria-selected={false}
                key={text}
                className="m-suggest-query"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickQuery(text)}
              >
                <Icon name="search" />
                <span>{text}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {top && !app.ytError && (
        <button
          type="button"
          className="m-top-result"
          onClick={() =>
            app.onOpenTarget({
              kind: "artist",
              browseId: top.id,
              title: top.title,
              thumbnailUrl: top.thumbnailUrl,
            })
          }
        >
          <span className="m-top-art">
            <PlayerArtwork url={top.thumbnailUrl} label="" />
          </span>
          <span className="m-track-text">
            <small>Resultado principal</small>
            <strong>{top.title}</strong>
            <small>{top.subtitle}</small>
          </span>
          <Icon name="chevron" />
        </button>
      )}

      {app.ytError ? (
        <p className="m-error">{app.ytError}</p>
      ) : app.ytSearching && app.ytResults.length === 0 ? (
        <p className="m-empty">Buscando…</p>
      ) : (
        <div className={app.ytSearching ? "m-refreshing" : undefined}>
          <TrackList
            {...list}
            tracks={app.ytResults}
            emptyText="Escribe una canción o un artista"
          />
        </div>
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

  const playAll = (mode: ShuffleMode) => app.onPlayCollection(playlist.tracks, mode);

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
          onClick={() => playAll("on")}
          aria-label="Reproducir en aleatorio"
          title="Aleatorio"
        >
          <Icon name="shuffle" />
        </button>
        <button
          type="button"
          className="m-primary"
          disabled={playlist.tracks.length === 0}
          onClick={() => playAll("off")}
        >
          <Icon name="play" />
          Reproducir
        </button>
        <button
          type="button"
          className="m-icon-btn filled m-smart-btn"
          disabled={playlist.tracks.length === 0}
          onClick={() => playAll("smart")}
          aria-label="Aleatorio inteligente: mezcla canciones parecidas"
          title="Aleatorio inteligente"
        >
          <Icon name="sparkle" />
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

/** Primer artista de un crédito como "A, B & C". */
function mainArtistName(artist: string): string {
  return artist.split(/,|&| y | x | feat\.? | ft\.? /i)[0]?.trim() || artist;
}

/** Menú de una canción: se abre con los 3 puntos o dejándola presionada. */
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
  const [finding, setFinding] = useState<"album" | "artist" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const downloaded = app.ytDownloads.some((item) => item.videoId === track.videoId);
  const downloading = app.ytDownloadingId === track.videoId;
  const liked = app.ytLikes.some((item) => item.videoId === track.videoId);
  const run = (action: () => void) => {
    action();
    onClose();
  };

  const open = (kind: "album" | "artist") => {
    setFinding(kind);
    setError(null);
    const artist = mainArtistName(track.artist);
    const query =
      kind === "artist"
        ? artist
        : `${track.album && track.album !== "YouTube Music" ? track.album : track.title} ${artist}`;
    lookupMusic(kind, query)
      .then((item) => {
        onClose();
        app.onOpenTarget(
          kind === "artist"
            ? { kind: "artist", browseId: item.id, title: item.title, thumbnailUrl: item.thumbnailUrl }
            : {
                kind: "remote",
                id: item.id,
                title: item.title,
                subtitle: item.subtitle,
                thumbnailUrl: item.thumbnailUrl,
              },
        );
      })
      .catch(() => setError(kind === "artist" ? "No se encontró el artista." : "No se encontró el álbum."))
      .finally(() => setFinding(null));
  };

  const options: Array<[IconName, string, () => void, boolean?]> = [
    [liked ? "heartFilled" : "heart", liked ? "Quitar de Me gusta" : "Me gusta", () => run(() => app.onToggleLike(track))],
    ["playNext", "Reproducir siguiente", () => run(() => app.onPlayNext(track))],
    ["queue", "Añadir a la cola", () => run(() => app.onAddToQueue(track))],
    ["plus", "Añadir a una playlist", () => run(() => app.onAddToPlaylist(track))],
    [
      downloaded ? "trash" : "download",
      downloaded ? "Eliminar descarga" : downloading ? "Descargando…" : "Descargar",
      () => run(() => (downloaded ? app.onRemoveDownload(track.videoId) : app.onDownload(track))),
      downloading,
    ],
    ["library", finding === "album" ? "Buscando el álbum…" : "Ver álbum", () => open("album"), finding !== null],
    ["user", finding === "artist" ? "Buscando el artista…" : "Ver artista", () => open("artist"), finding !== null],
  ];

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section
        className="sheet m-track-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Opciones de ${track.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-header m-track-sheet-head">
          <span className="m-track-art">
            <Artwork url={track.thumbnailUrl} />
          </span>
          <div>
            <strong>{track.title}</strong>
            <small>{track.artist}</small>
          </div>
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
        </header>
        {error && <p className="m-error">{error}</p>}
        <div className="sheet-list m-option-list">
          {options.map(([icon, label, action, disabled]) => (
            <button
              type="button"
              key={label}
              disabled={disabled}
              onClick={action}
              className={icon === "heartFilled" ? "liked" : ""}
            >
              <Icon name={icon} />
              <span>{label}</span>
            </button>
          ))}
          {playlist?.tracks.some((item) => item.videoId === track.videoId) && (
            <button
              type="button"
              onClick={() => run(() => app.onRemoveFromPlaylist(playlist.id, track.videoId))}
            >
              <Icon name="close" />
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
              className={`${app.shuffleMode !== "off" ? "active" : ""} ${
                app.shuffleMode === "smart" ? "smart" : ""
              }`}
              onClick={app.onCycleShuffle}
              aria-label={`${SHUFFLE_LABELS[app.shuffleMode]}. Toca para cambiar`}
              title={SHUFFLE_LABELS[app.shuffleMode]}
            >
              <Icon name={app.shuffleMode === "smart" ? "sparkle" : "shuffle"} />
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
                <strong>A continuación</strong>
                <small>
                  {SHUFFLE_LABELS[app.shuffleMode]}
                  {app.smartLoading ? " · buscando canciones parecidas…" : ""}
                </small>
              </div>
              <button type="button" onClick={() => setQueueOpen(false)}>
                Cerrar
              </button>
            </header>
            <UpNextList app={app} list={list} />
          </section>
        </div>
      )}
    </>
  );
}

function UpNextList({ app, list }: ScreenProps) {
  const groups: Array<[string, QueueItem[]]> = [
    ["Añadidas por ti", app.upNext.filter((item) => item.kind === "manual")],
    ["Siguientes", app.upNext.filter((item) => item.kind !== "manual")],
  ];

  if (app.upNext.length === 0) {
    return (
      <div className="m-queue-list">
        <p className="m-empty">
          No hay más canciones en la cola. Abre las opciones de una canción y
          elige «Añadir a la cola».
        </p>
      </div>
    );
  }

  return (
    <div className="m-queue-list">
      {groups
        .filter(([, items]) => items.length > 0)
        .map(([title, items]) => (
          <section key={title}>
            <h3 className="m-queue-title">{title}</h3>
            <div className="m-tracks">
              {items.map((item) => (
                <div
                  className={`m-track ${item.kind === "smart" ? "smart" : ""}`}
                  key={`${item.kind}-${item.index}-${item.track.videoId}`}
                >
                  <button
                    type="button"
                    className="m-track-main"
                    onClick={() => app.onJumpTo(item)}
                    aria-label={`Reproducir ${item.track.title}`}
                  >
                    <span className="m-track-art">
                      <Artwork url={item.track.thumbnailUrl} />
                    </span>
                    <span className="m-track-text">
                      <strong>{item.track.title}</strong>
                      <small>
                        {item.kind === "smart" && <Icon name="sparkle" />}
                        {item.kind === "smart" ? "Recomendada · " : ""}
                        {item.track.artist}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="m-icon-btn"
                    onClick={() => list.onMore(item.track)}
                    aria-label={`Más opciones de ${item.track.title}`}
                  >
                    <Icon name="more" />
                  </button>
                  <button
                    type="button"
                    className="m-icon-btn"
                    onClick={() => app.onRemoveFromQueue(item)}
                    aria-label={`Quitar ${item.track.title} de la cola`}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
    </div>
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


/**
 * Deslizar de izquierda a derecha vuelve a la pantalla anterior. No se activa
 * dentro de filas que se desplazan de lado ni en barras de progreso.
 */
function useSwipeBack(enabled: boolean, onBack: () => void) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });

  const blocked = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(
      target.closest(
        ".m-shelf, .m-picks, .m-chips, .m-chips-scroll, input, .track-progress, .m-volume",
      ),
    );

  return {
    offset,
    handlers: enabled
      ? {
          onTouchStart: (event: ReactTouchEvent) => {
            const touch = event.touches[0];
            start.current =
              event.touches.length === 1 && !blocked(event.target)
                ? { x: touch.clientX, y: touch.clientY, at: Date.now() }
                : null;
          },
          onTouchMove: (event: ReactTouchEvent) => {
            const origin = start.current;
            if (!origin) return;
            const touch = event.touches[0];
            const dx = touch.clientX - origin.x;
            const dy = Math.abs(touch.clientY - origin.y);
            if (dy > 40 && dy > dx) {
              start.current = null;
              setOffset(0);
              return;
            }
            setOffset(dx > 0 ? Math.min(dx * 0.35, 90) : 0);
          },
          onTouchEnd: (event: ReactTouchEvent) => {
            const origin = start.current;
            start.current = null;
            setOffset(0);
            if (!origin) return;
            const touch = event.changedTouches[0];
            const dx = touch.clientX - origin.x;
            const dy = Math.abs(touch.clientY - origin.y);
            if (dx > 90 && dy < 70 && Date.now() - origin.at < 700) latest.current();
          },
          onTouchCancel: () => {
            start.current = null;
            setOffset(0);
          },
        }
      : {},
  };
}

function useDesktopLayout(): boolean {
  const query = "(min-width: 860px)";
  const [wide, setWide] = useState(
    () => !IS_ANDROID && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (IS_ANDROID) return;
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}

/** Barra inferior del PC: canción, controles con tiempo y volumen. */
function PlayerBar({
  app,
  onShowQueue,
}: {
  app: ModernAppProps;
  onShowQueue: () => void;
}) {
  const { state, ytCurrent } = app;
  const playing = state.status === "playing";
  const hasTrack = state.connected && state.title.length > 0;
  const isYoutube = app.source === "youtube" && ytCurrent !== null;
  const liked =
    isYoutube && app.ytLikes.some((item) => item.videoId === ytCurrent.videoId);

  return (
    <footer className="m-playerbar" aria-label="Reproductor">
      <div className="m-playerbar-track">
        {hasTrack ? (
          <>
            <button
              type="button"
              className="m-playerbar-art"
              onClick={app.onOpenNowPlaying}
              aria-label={`Abrir reproductor: ${state.title}`}
            >
              <Artwork url={state.artworkDataUrl} />
            </button>
            <span className="m-track-text">
              <strong>{state.title}</strong>
              <small>{state.artist}</small>
            </span>
            {isYoutube && (
              <button
                type="button"
                className={`m-icon-btn ${liked ? "accent" : ""}`}
                onClick={() => app.onToggleLike(ytCurrent)}
                aria-pressed={liked}
                aria-label={liked ? "Quitar de Me gusta" : "Añadir a Me gusta"}
              >
                <Icon name={liked ? "heartFilled" : "heart"} />
              </button>
            )}
          </>
        ) : (
          <span className="m-track-text">
            <small>Elige una canción para empezar</small>
          </span>
        )}
      </div>

      <div className="m-playerbar-center">
        <div className="m-playerbar-controls">
          <button
            type="button"
            className={`m-icon-btn ${app.shuffleMode !== "off" ? "accent" : ""}`}
            onClick={app.onCycleShuffle}
            aria-label={`${SHUFFLE_LABELS[app.shuffleMode]}. Toca para cambiar`}
            title={SHUFFLE_LABELS[app.shuffleMode]}
          >
            <Icon name={app.shuffleMode === "smart" ? "sparkle" : "shuffle"} />
          </button>
          <button
            type="button"
            className="m-icon-btn"
            onClick={app.onPrevious}
            disabled={!hasTrack}
            aria-label="Anterior"
          >
            <Icon name="previous" />
          </button>
          <button
            type="button"
            className="m-playerbar-play"
            onClick={app.onPlayPause}
            disabled={!hasTrack}
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
            disabled={!hasTrack}
            aria-label="Siguiente"
          >
            <Icon name="next" />
          </button>
          <button
            type="button"
            className={`m-icon-btn ${app.repeat ? "accent" : ""}`}
            onClick={app.onToggleRepeat}
            aria-pressed={app.repeat}
            aria-label="Repetir canción"
            title="Repetir canción"
          >
            <Icon name="repeat" />
          </button>
        </div>
        <TrackProgress
          positionSec={app.positionSec}
          durationSec={state.durationSec}
          canSeek={state.canSeek}
          onSeek={app.onSeek}
        />
      </div>

      <div className="m-playerbar-side">
        <button
          type="button"
          className="m-icon-btn"
          onClick={onShowQueue}
          aria-label="Ver cola"
          title="Cola"
        >
          <Icon name="queue" />
        </button>
        <label className="m-volume" title="Volumen">
          <Icon name="volume" />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(app.volume * 100)}
            onChange={(event) => app.onVolumeChange(Number(event.target.value) / 100)}
            aria-label="Volumen"
          />
        </label>
      </div>
    </footer>
  );
}

/** Panel derecho del PC: lo que suena y lo que viene después. */
function NowPlayingPanel({ app, list }: ScreenProps) {
  const { state } = app;
  const hasTrack = state.connected && state.title.length > 0;
  return (
    <div className="m-now">
      <h2>{hasTrack ? "Sonando" : "Cola"}</h2>
      {hasTrack && (
        <button
          type="button"
          className="m-now-art"
          onClick={app.onOpenNowPlaying}
          aria-label="Abrir reproductor"
        >
          <PlayerArtwork
            key={state.artworkDataUrl}
            url={state.artworkDataUrl}
            label={state.title}
          />
        </button>
      )}
      {hasTrack && (
        <div className="m-track-text m-now-text">
          <strong>{state.title}</strong>
          <small>{state.artist}</small>
        </div>
      )}
      <h3 className="m-queue-title">
        A continuación · {SHUFFLE_LABELS[app.shuffleMode]}
        {app.smartLoading ? " · buscando…" : ""}
      </h3>
      <UpNextList app={app} list={list} />
    </div>
  );
}

function Sidebar({ app, activeTab }: { app: ModernAppProps; activeTab: string }) {
  const items: Array<[string, string, IconName, () => void]> = [
    ["menu", "Inicio", "home", app.onOpenMenu],
    ["search", "Buscar", "search", app.onOpenSearch],
    ["library", "Biblioteca", "library", app.onOpenPlaylists],
    ["likes", "Me gusta", "heartFilled", app.onOpenLikes],
    ["downloads", "Descargadas", "download", app.onOpenDownloads],
    ["genres", "Explorar", "compass", app.onOpenGenres],
  ];
  return (
    <aside className="m-side" aria-label="Navegación principal">
      <div className="m-brand m-side-brand">
        <img src="/favicon.png" alt="" />
        FoYu
      </div>
      <nav className="m-side-nav">
        {items.map(([id, label, icon, open]) => (
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
      <div className="m-side-section">
        <span>Tus playlists</span>
        <button
          type="button"
          className="m-icon-btn"
          onClick={app.onOpenPlaylists}
          aria-label="Crear o importar playlist"
          title="Crear o importar"
        >
          <Icon name="plus" />
        </button>
      </div>
      <div className="m-side-list">
        {app.playlists.map((playlist) => (
          <button
            type="button"
            key={playlist.id}
            className={
              activeTab === "playlist" && app.selectedPlaylist?.id === playlist.id
                ? "active"
                : ""
            }
            onClick={() => app.onOpenPlaylist(playlist.id)}
          >
            <span className="m-track-art">
              <PlaylistCover playlist={playlist} />
            </span>
            <span className="m-track-text">
              <strong>{playlist.title}</strong>
              <small>{playlist.tracks.length} canciones</small>
            </span>
          </button>
        ))}
        {app.playlists.length === 0 && (
          <p className="m-hint">Crea una o pega un enlace en Biblioteca.</p>
        )}
      </div>
    </aside>
  );
}

export function ModernApp(props: ModernAppProps) {
  const { state, browseView, view } = props;
  const desktop = useDesktopLayout();
  const [rightPanel, setRightPanel] = useState<"profile" | "queue">("profile");
  const [profileSection, setProfileSection] = useState<ProfileSection>("account");
  const hasTrack = state.connected && state.title.length > 0;
  const playerOpen = view === "nowPlaying" && hasTrack;
  const onMore = useStableCallback(props.onOpenTrackOptions);
  const onPlay = useStableCallback(props.onPlayTrack);
  const onToggleLike = useStableCallback(props.onToggleLike);
  const startedTrack = useRef(false);

  // En PC, al empezar a sonar algo el panel derecho muestra la cola una vez.
  useEffect(() => {
    if (hasTrack && !startedTrack.current) {
      startedTrack.current = true;
      setRightPanel("queue");
    }
  }, [hasTrack]);

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

  let screen: IpodView =
    browseView === "playlist" && !props.selectedPlaylist
      ? "playlists"
      : browseView;
  // En PC el perfil vive en el panel derecho.
  if (desktop && screen === "settings") screen = "menu";
  const target = props.discoverTarget;
  if (
    (screen === "remote" && target?.kind !== "remote") ||
    (screen === "category" && target?.kind !== "category") ||
    (screen === "artist" && target?.kind !== "artist")
  ) {
    screen = "menu";
  }
  const heroScreen = screen === "playlist" || screen === "remote" || screen === "artist";
  const backScreen = heroScreen || screen === "settings" || screen === "category" || screen === "genres";

  const activeTab =
    screen === "menu" ||
    screen === "nowPlaying" ||
    screen === "remote" ||
    screen === "category" ||
    screen === "artist"
      ? "menu"
      : screen === "genres"
        ? desktop
          ? "genres"
          : "menu"
        : screen === "search"
          ? "search"
          : screen === "settings"
            ? "settings"
            : desktop && (screen === "likes" || screen === "downloads" || screen === "playlist")
              ? screen
              : "library";
  const screenKey = `${screen}-${props.selectedPlaylist?.id ?? ""}-${
    target?.kind === "remote"
      ? target.id
      : target?.kind === "category"
        ? target.params
        : target?.kind === "artist"
          ? target.browseId
          : ""
  }`;

  const tabs: Array<[string, string, IconName, () => void]> = [
    ["menu", "Inicio", "home", props.onOpenMenu],
    ["search", "Buscar", "search", props.onOpenSearch],
    ["library", "Biblioteca", "library", props.onOpenPlaylists],
  ];

  // En el inicio no hay "atrás": deslizar ahí no hace nada.
  const swipe = useSwipeBack(!desktop && screen !== "menu", props.onBack);

  const openProfile = (section: ProfileSection) => {
    setProfileSection(section);
    if (desktop) setRightPanel("profile");
    else props.onOpenSettings();
  };

  const content =
    screen === "search" ? (
      <SearchScreen app={props} list={list} />
    ) : screen === "playlists" ? (
      <PlaylistsScreen app={props} />
    ) : screen === "playlist" && props.selectedPlaylist ? (
      <PlaylistScreen app={props} list={list} playlist={props.selectedPlaylist} />
    ) : screen === "likes" ? (
      <>
        <h1 className="m-title">{desktop ? "Me gusta" : "Biblioteca"}</h1>
        {!desktop && <LibraryTabs view="likes" app={props} />}
        <CollectionActions tracks={props.ytLikes} app={props} />
        <TrackList
          {...list}
          tracks={props.ytLikes}
          emptyText="Toca el corazón de una canción para guardarla aquí"
        />
      </>
    ) : screen === "downloads" ? (
      <>
        <h1 className="m-title">{desktop ? "Descargadas" : "Biblioteca"}</h1>
        {!desktop && <LibraryTabs view="downloads" app={props} />}
        <CollectionActions tracks={props.ytDownloads} app={props} />
        {props.ytDownloadError && <p className="m-error">{props.ytDownloadError}</p>}
        <TrackList
          {...list}
          sizes={sizes}
          tracks={props.ytDownloads}
          emptyText="Descarga una canción para escucharla sin conexión"
        />
      </>
    ) : screen === "settings" ? (
      <>
        <h1 className="m-title">Perfil</h1>
        <ProfilePanel
          settings={props.settings}
          onToggleDesign={props.onToggleDesign}
          section={profileSection}
        />
      </>
    ) : screen === "remote" && target?.kind === "remote" ? (
      <RemoteScreen app={props} list={list} target={target} />
    ) : screen === "category" && target?.kind === "category" ? (
      <CategoryScreen app={props} list={list} target={target} />
    ) : screen === "artist" && target?.kind === "artist" ? (
      <ArtistScreen app={props} list={list} target={target} />
    ) : screen === "genres" ? (
      <GenresScreen app={props} />
    ) : (
      <HomeScreen app={props} list={list} />
    );

  const rootStyle = {
    "--m-accent": props.palette.accent,
    "--m-tint": props.palette.tint,
    "--m-deep": props.palette.deep,
  } as CSSProperties;

  const overlays = (
    <>
      {playerOpen && <FullPlayer app={props} list={list} onClose={props.onBack} />}
      {props.optionsTrack && (
        <TrackOptions
          track={props.optionsTrack}
          app={props}
          playlist={screen === "playlist" ? props.selectedPlaylist : null}
          onClose={props.onCloseTrackOptions}
        />
      )}
    </>
  );

  if (desktop) {
    return (
      <div className={`m-root m-desktop theme-${props.theme}`} style={rootStyle}>
        <div className="m-ambient" aria-hidden />
        <header className="m-titlebar" data-tauri-drag-region>
          <button
            type="button"
            className="m-icon-btn filled"
            onClick={props.onBack}
            aria-label="Volver"
            title="Volver"
          >
            <Icon name="back" />
          </button>
          <button
            type="button"
            className="m-titlebar-search"
            onClick={props.onOpenSearch}
          >
            <Icon name="search" />
            <span>¿Qué quieres escuchar?</span>
          </button>
          <span className="m-header-space" data-tauri-drag-region />
          <DesignToggle design="modern" onToggle={props.onToggleDesign} />
          <ProfileButtons settings={props.settings} onOpen={openProfile} />
          <WindowControls />
        </header>
        <Sidebar app={props} activeTab={activeTab} />
        <main className="m-main" key={screenKey}>
          {content}
        </main>
        <aside className="m-right" aria-label={rightPanel === "profile" ? "Perfil" : "Cola"}>
          {rightPanel === "profile" ? (
            <ProfilePanel
              settings={props.settings}
              onToggleDesign={props.onToggleDesign}
              section={profileSection}
              onClose={() => setRightPanel("queue")}
            />
          ) : (
            <NowPlayingPanel app={props} list={list} />
          )}
        </aside>
        <PlayerBar app={props} onShowQueue={() => setRightPanel("queue")} />
        {overlays}
        <ResizeGrip />
      </div>
    );
  }

  return (
    <div
      className={`m-root theme-${props.theme} ${hasTrack ? "has-track" : ""} ${
        heroScreen ? "on-playlist" : ""
      }`}
      style={rootStyle}
    >
      <div className="m-ambient" aria-hidden />

      <header className="m-header" data-tauri-drag-region>
        {backScreen && (
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
        {screen !== "settings" && (
          <ProfileButtons settings={props.settings} onOpen={openProfile} />
        )}
        {!IS_ANDROID && <WindowControls />}
      </header>

      <main
        className="m-main"
        key={screenKey}
        {...swipe.handlers}
        style={
          swipe.offset > 0
            ? { transform: `translateX(${swipe.offset}px)`, opacity: 1 - swipe.offset / 300 }
            : undefined
        }
      >
        {content}
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

      {overlays}
      {!IS_ANDROID && <ResizeGrip />}
    </div>
  );
}
