import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { useMediaSession } from "./hooks/useMediaSession";
import { looksLikeLink, usePlaylists } from "./hooks/usePlaylists";
import { useArtworkPalette } from "./hooks/useArtworkAccent";
import { useCloudSync } from "./hooks/useCloudSync";
import { useYoutubeMusic } from "./hooks/useYoutubeMusic";
import type { LibrarySnapshot } from "./services/librarySync";
import { AccountSheet } from "./components/AccountSheet";
import { AddToPlaylistSheet } from "./components/AddToPlaylistSheet";
import type { AppDesign } from "./components/DesignToggle";
import { IpodShell } from "./components/ipod/IpodShell";
import { IpodDisplay } from "./components/ipod/IpodDisplay";
import type {
  IpodDisplayProps,
  IpodView,
} from "./components/ipod/IpodDisplay";
import { ClickWheel } from "./components/ipod/ClickWheel";
import { UpdatePrompt } from "./components/ipod/UpdatePrompt";
import { ModernApp } from "./components/modern/ModernApp";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import {
  IS_ANDROID,
  leaveApp,
  saveTextFile,
  updateWidget,
} from "./services/mediaBridge";
import { exportLibraryCsv, importLibraryFile } from "./services/youtubeMusic";
import type { AudioSource, YoutubeTrack } from "./types/youtube";
import "./styles/ipod.css";

// Tamaño de diseño del iPod. La ventana puede encogerse hasta el mínimo
// configurado en tauri.conf.json y el contenido se escala proporcionalmente.
const IPOD_BASE_WIDTH = 380;
const IPOD_BASE_HEIGHT = 680;
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

const EMPTY_LIBRARY: LibrarySnapshot = {
  version: 1,
  playlists: [],
  deleted: {},
  likes: [],
  likesUpdatedAt: 0,
};

interface NavEntry {
  view: IpodView;
  playlistId: string | null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readTextFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  return new TextDecoder(encoding).decode(bytes);
}

function computeScale(): number {
  if (typeof window === "undefined") return 1;
  // En Android la carcasa ocupa toda la pantalla; el CSS móvil se encarga
  // de repartir el espacio sin escalar el diseño de escritorio.
  if (IS_ANDROID) return 1;
  return Math.min(
    window.innerWidth / IPOD_BASE_WIDTH,
    window.innerHeight / IPOD_BASE_HEIGHT,
    1,
  );
}

function useIpodScale(): number {
  const [scale, setScale] = useState<number>(computeScale);

  useEffect(() => {
    const update = () => setScale(computeScale());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return scale;
}

function App() {
  const system = useMediaSession();
  const youtube = useYoutubeMusic();
  const playlistStore = usePlaylists();

  // El diseño no se persiste: la app siempre arranca con el moderno.
  const [design, setDesign] = useState<AppDesign>("modern");
  const [view, setView] = useState<IpodView>("menu");
  const [browseView, setBrowseView] = useState<IpodView>("menu");
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [trackToAdd, setTrackToAdd] = useState<YoutubeTrack | null>(null);
  const [optionsTrack, setOptionsTrack] = useState<YoutubeTrack | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const navStack = useRef<NavEntry[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const backHandler = useRef<() => void>(() => {});
  const scale = useIpodScale();
  const librarySnapshot = useMemo<LibrarySnapshot>(
    () => ({
      version: 1,
      playlists: playlistStore.playlists,
      deleted: playlistStore.deleted,
      likes: youtube.likes,
      likesUpdatedAt: youtube.likesUpdatedAt,
    }),
    [
      playlistStore.playlists,
      playlistStore.deleted,
      youtube.likes,
      youtube.likesUpdatedAt,
    ],
  );
  const cloud = useCloudSync({
    snapshot: librarySnapshot,
    emptySnapshot: EMPTY_LIBRARY,
    onApply: (next) => {
      playlistStore.replaceAll(next.playlists, next.deleted);
      youtube.replaceLikes(next.likes, next.likesUpdatedAt);
    },
    onYoutubeLibrary: (library) => {
      playlistStore.applyYoutubeLists(library.playlists);
      youtube.addLikes(library.likes);
    },
  });
  const { update, dismiss: dismissUpdate, install: installUpdate } =
    useUpdateCheck();

  // Toda la música convive: se muestra lo que esté sonando, sin elegir fuente.
  const youtubePlaying = youtube.state.status === "playing";
  const systemPlaying =
    system.state.connected && system.state.status === "playing";
  const systemHasTrack =
    system.state.connected && system.state.title.length > 0;
  const source: AudioSource = youtubePlaying
    ? "youtube"
    : systemPlaying
      ? "system"
      : youtube.current
        ? "youtube"
        : systemHasTrack
          ? "system"
          : "youtube";

  const wasSystemPlaying = useRef(systemPlaying);
  useEffect(() => {
    // Si Spotify o Apple Music empiezan a sonar, la app cede para no solapar.
    if (systemPlaying && !wasSystemPlaying.current && youtubePlaying) {
      youtube.pause();
    }
    wasSystemPlaying.current = systemPlaying;
  }, [systemPlaying, youtubePlaying, youtube]);

  const isYoutube = source === "youtube";
  const state = isYoutube ? youtube.state : system.state;
  const positionSec = isYoutube ? youtube.positionSec : system.positionSec;
  const palette = useArtworkPalette(state.artworkDataUrl);
  const widgetPlaying = state.status === "playing";

  useEffect(() => {
    if (!IS_ANDROID) return;
    void updateWidget({
      title: state.title,
      artist: state.artist,
      artworkUrl: state.artworkDataUrl,
      playing: widgetPlaying,
      tint: palette.tint,
      accent: palette.accent,
    }).catch(() => {});
  }, [
    state.title,
    state.artist,
    state.artworkDataUrl,
    widgetPlaying,
    palette.tint,
    palette.accent,
  ]);

  const selectedPlaylist =
    playlistStore.playlists.find((item) => item.id === playlistId) ?? null;

  const showEntry = ({ view: next, playlistId: nextPlaylist }: NavEntry) => {
    setView(next);
    setPlaylistId(nextPlaylist);
    if (next !== "nowPlaying") setBrowseView(next);
  };

  const goTo = (next: IpodView, nextPlaylist = playlistId) => {
    if (next === view && nextPlaylist === playlistId) return;
    navStack.current = [
      ...navStack.current.slice(-49),
      { view, playlistId },
    ];
    showEntry({ view: next, playlistId: nextPlaylist });
  };

  const goBack = () => {
    if (accountOpen) {
      setAccountOpen(false);
      return;
    }
    if (trackToAdd) {
      setTrackToAdd(null);
      return;
    }
    if (optionsTrack) {
      setOptionsTrack(null);
      return;
    }

    const hasTrack = state.connected && state.title.length > 0;
    const stack = [...navStack.current];
    let previous = stack.pop();
    while (previous?.view === "nowPlaying" && !hasTrack) {
      previous = stack.pop();
    }
    navStack.current = stack;

    if (previous) {
      showEntry(previous);
    } else if (view !== "menu") {
      showEntry({ view: "menu", playlistId: null });
    } else {
      void leaveApp().catch(() => {});
    }
  };

  useEffect(() => {
    backHandler.current = goBack;
  });

  useEffect(() => {
    if (!IS_ANDROID) return;
    let active = true;
    let unregister: (() => void) | null = null;

    onBackButtonPress(() => backHandler.current())
      .then((listener) => {
        unregister = () => void listener.unregister();
        if (!active) unregister();
      })
      .catch(() => {});

    return () => {
      active = false;
      unregister?.();
    };
  }, []);

  const toggleDesign = () => {
    setDesign((current) => (current === "modern" ? "ipod" : "modern"));
  };

  const handleMenu = () => {
    goTo(view === "menu" ? "nowPlaying" : "menu");
  };

  const handleSelect = () => {
    if (view === "menu") {
      openSearch();
    } else if (view === "search") {
      void youtube.search();
    } else {
      goTo("menu");
    }
  };

  const playPause = () => {
    if (isYoutube) youtube.playPause();
    else void system.playPause();
  };

  const skipNext = () => {
    if (isYoutube) youtube.next();
    else void system.next();
  };

  const skipPrevious = () => {
    if (isYoutube) youtube.previous();
    else void system.previous();
  };

  const seek = (seconds: number) => {
    if (isYoutube) youtube.seek(seconds);
    else void system.seek(seconds);
  };

  const widgetActions = useRef({ playPause, skipNext, skipPrevious });
  useEffect(() => {
    widgetActions.current = { playPause, skipNext, skipPrevious };
  });

  useEffect(() => {
    if (!IS_ANDROID) return;
    const host = window as Window & {
      __foyuWidget?: (action: string) => void;
    };
    host.__foyuWidget = (action) => {
      if (action === "toggle") widgetActions.current.playPause();
      if (action === "next") widgetActions.current.skipNext();
      if (action === "previous") widgetActions.current.skipPrevious();
    };
    return () => {
      delete host.__foyuWidget;
    };
  }, []);

  const openSearch = () => goTo("search");
  const openLikes = () => goTo("likes");
  const openDownloads = () => goTo("downloads");
  const openPlaylists = () => goTo("playlists");

  const openPlaylist = (id: string) => goTo("playlist", id);

  const exportLibrary = async () => {
    setLibraryBusy(true);
    setLibraryError(null);
    setLibraryNotice(null);
    try {
      const csv = await exportLibraryCsv({
        playlists: playlistStore.playlists,
        likes: youtube.likes,
        downloads: youtube.downloads,
      });
      const date = new Date().toISOString().slice(0, 10);
      const saved = await saveTextFile(
        `FoYu-biblioteca-${date}.csv`,
        csv,
        "text/csv",
      );
      if (saved) setLibraryNotice("Biblioteca exportada en CSV");
    } catch (error) {
      setLibraryError(describeError(error));
    } finally {
      setLibraryBusy(false);
    }
  };

  const importLibrary = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLibraryBusy(true);
    setLibraryError(null);
    setLibraryNotice(null);
    goTo("playlists", null);
    try {
      if (file.size > MAX_IMPORT_BYTES) {
        throw new Error("El archivo es demasiado grande");
      }
      const result = await importLibraryFile(file.name, await readTextFile(file));
      playlistStore.mergeCollections(result.collections);
      youtube.addLikes(
        result.collections
          .filter((item) => item.kind === "likes")
          .flatMap((item) => item.tracks),
      );
      setLibraryNotice(
        `${result.imported} ${
          result.imported === 1 ? "canción importada" : "canciones importadas"
        }` +
          (result.skipped > 0 ? `, ${result.skipped} sin encontrar` : ""),
      );
    } catch (error) {
      setLibraryError(describeError(error));
    } finally {
      setLibraryBusy(false);
    }
  };

  const importPlaylist = async (linkOrName: string) => {
    const id = looksLikeLink(linkOrName)
      ? await playlistStore.importFromLink(linkOrName)
      : playlistStore.create(linkOrName);
    if (!id) return false;
    openPlaylist(id);
    return true;
  };

  const deletePlaylist = (id: string) => {
    playlistStore.remove(id);
    navStack.current = navStack.current.filter(
      (entry) => entry.playlistId !== id,
    );
    showEntry({ view: "playlists", playlistId: null });
  };

  const createPlaylistWithTrack = (name: string) => {
    if (!trackToAdd) return;
    const id = playlistStore.create(name);
    if (id) playlistStore.addTrack(id, trackToAdd);
    setTrackToAdd(null);
  };

  const playYoutubeTrack = (track: YoutubeTrack, playlist?: YoutubeTrack[]) => {
    if (systemPlaying) void system.playPause();

    // La cola depende de dónde se pulsó: si viene de una lista (resultados,
    // Me gusta o Descargadas), esa lista pasa a ser la cola. Si la canción ya
    // está en la cola actual se conserva para poder seguir navegando en ella.
    const inQueue = youtube.queue.some(
      (item) => item.videoId === track.videoId,
    );
    const queue =
      playlist && playlist.length > 0
        ? playlist
        : inQueue
          ? youtube.queue
          : youtube.results.length > 0
            ? youtube.results
            : [track];

    void youtube.playTrack(track, queue);
    // En el diseño moderno se sigue en la lista: suena en el minirreproductor.
    if (design === "ipod") goTo("nowPlaying");
  };

  const displayProps: IpodDisplayProps = {
    design,
    state,
    positionSec,
    view,
    history: system.history,
    source,
    currentVideoId: isYoutube ? (youtube.current?.videoId ?? null) : null,
    ytCurrent: youtube.current,
    ytQueue: youtube.queue,
    ytResults: youtube.results,
    ytQuery: youtube.query,
    ytSearching: youtube.searching,
    ytLoading: youtube.loading,
    ytError: youtube.error,
    ytLikes: youtube.likes,
    ytDownloads: youtube.downloads,
    ytDownloadingId: youtube.downloadingId,
    ytDownloadError: youtube.downloadError,
    playlists: playlistStore.playlists,
    selectedPlaylist,
    playlistImporting: playlistStore.importing,
    playlistError: libraryError ?? playlistStore.error,
    playlistNotice: libraryNotice ?? playlistStore.notice,
    libraryBusy,
    cloudAvailable: cloud.available,
    onOpenAccount: () => setAccountOpen(true),
    onExportLibrary: () => void exportLibrary(),
    onImportLibrary: () => fileInput.current?.click(),
    onSeek: seek,
    onToggleDesign: toggleDesign,
    onOpenSearch: openSearch,
    onOpenNowPlaying: () => goTo("nowPlaying"),
    onOpenLikes: openLikes,
    onOpenDownloads: openDownloads,
    onOpenPlaylists: openPlaylists,
    onOpenPlaylist: openPlaylist,
    onImportPlaylist: importPlaylist,
    onDeletePlaylist: deletePlaylist,
    onAddToPlaylist: setTrackToAdd,
    onRemoveFromPlaylist: playlistStore.removeTrack,
    onQueryChange: youtube.setQuery,
    onSearch: () => void youtube.search(),
    onPlayTrack: playYoutubeTrack,
    onToggleLike: youtube.toggleLike,
    onDownload: youtube.download,
    onRemoveDownload: youtube.removeDownload,
  };

  return (
    <div className={`app-root${IS_ANDROID ? " platform-android" : ""}`}>
      <div
        className="ipod-stage"
        style={{ "--ipod-scale": scale } as CSSProperties}
      >
        {design === "modern" ? (
          <ModernApp
            {...displayProps}
            browseView={browseView}
            optionsTrack={optionsTrack}
            onOpenTrackOptions={setOptionsTrack}
            onCloseTrackOptions={() => setOptionsTrack(null)}
            onOpenMenu={() => goTo("menu")}
            onBack={goBack}
            onPlayPause={playPause}
            onNext={skipNext}
            onPrevious={skipPrevious}
            palette={palette}
            shuffle={youtube.shuffle}
            repeat={youtube.repeat}
            onToggleShuffle={youtube.toggleShuffle}
            onToggleRepeat={youtube.toggleRepeat}
          />
        ) : (
          <IpodShell theme="classic-white">
            <IpodDisplay {...displayProps} />
            <ClickWheel
              isPlaying={state.status === "playing"}
              onMenu={handleMenu}
              onPrevious={skipPrevious}
              onNext={skipNext}
              onPlayPause={playPause}
              onSelect={handleSelect}
            />
          </IpodShell>
        )}
        <input
          ref={fileInput}
          type="file"
          hidden
          onChange={(event) => void importLibrary(event)}
        />
        {accountOpen && (
          <AccountSheet cloud={cloud} onClose={() => setAccountOpen(false)} />
        )}
        {trackToAdd && (
          <AddToPlaylistSheet
            track={trackToAdd}
            playlists={playlistStore.playlists}
            onAdd={(id) => {
              playlistStore.addTrack(id, trackToAdd);
              setTrackToAdd(null);
            }}
            onCreate={createPlaylistWithTrack}
            onClose={() => setTrackToAdd(null)}
          />
        )}
        {update && (
          <UpdatePrompt
            version={update.version}
            onInstall={installUpdate}
            onDismiss={dismissUpdate}
          />
        )}
      </div>
    </div>
  );
}

export default App;
