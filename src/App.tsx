import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useMediaSession } from "./hooks/useMediaSession";
import { useYoutubeMusic } from "./hooks/useYoutubeMusic";
import { IpodShell } from "./components/ipod/IpodShell";
import { IpodDisplay } from "./components/ipod/IpodDisplay";
import type { IpodView } from "./components/ipod/IpodDisplay";
import { ClickWheel } from "./components/ipod/ClickWheel";
import { UpdatePrompt } from "./components/ipod/UpdatePrompt";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { IS_ANDROID, openNotificationSettings } from "./services/mediaBridge";
import type { AudioSource, YoutubeTrack } from "./types/youtube";
import "./styles/ipod.css";

// Tamaño de diseño del iPod. La ventana puede encogerse hasta el mínimo
// configurado en tauri.conf.json y el contenido se escala proporcionalmente.
const IPOD_BASE_WIDTH = 380;
const IPOD_BASE_HEIGHT = 680;
const SOURCE_KEY = "pocketpod.audio.source";

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

function loadSource(): AudioSource {
  try {
    const saved = localStorage.getItem(SOURCE_KEY);
    if (saved === "youtube" || saved === "system") return saved;
  } catch {
    // Si localStorage no está disponible, se usa la fuente del sistema.
  }
  return "system";
}

function saveSource(source: AudioSource) {
  try {
    localStorage.setItem(SOURCE_KEY, source);
  } catch {
    // Silencioso: la preferencia solo vive en memoria.
  }
}

function App() {
  const system = useMediaSession();
  const youtube = useYoutubeMusic();

  const [source, setSource] = useState<AudioSource>(loadSource);
  const [view, setView] = useState<IpodView>("nowPlaying");
  const scale = useIpodScale();
  const { update, dismiss: dismissUpdate, install: installUpdate } =
    useUpdateCheck();

  const isYoutube = source === "youtube";
  const state = isYoutube ? youtube.state : system.state;
  const positionSec = isYoutube ? youtube.positionSec : system.positionSec;

  const switchSource = useCallback(
    (next: AudioSource) => {
      if (next === source) return;

      if (next === "youtube") {
        // Si Spotify/Apple Music estaba sonando, se pausa para no solapar.
        if (system.state.status === "playing") void system.playPause();
      } else {
        youtube.pause();
        setView("nowPlaying");
      }

      setSource(next);
      saveSource(next);
    },
    [source, system, youtube],
  );

  const toggleSource = useCallback(() => {
    switchSource(source === "youtube" ? "system" : "youtube");
  }, [source, switchSource]);

  const handleMenu = () => {
    setView((current) =>
      current === "nowPlaying" ? "menu" : current === "menu" ? "nowPlaying" : "menu",
    );
  };

  const handleSelect = () => {
    if (view === "menu") {
      // Abrir el buscador implica pasar a YouTube: si se quedara en la fuente
      // del sistema, la rueda seguiría controlando Spotify mientras la lista
      // visible es de YouTube.
      openSearch();
    } else if (view === "search") {
      void youtube.search();
    } else {
      setView("menu");
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

  const openSearch = () => {
    if (source !== "youtube") switchSource("youtube");
    setView("search");
  };

  const openLikes = () => {
    if (source !== "youtube") switchSource("youtube");
    setView("likes");
  };

  const openDownloads = () => {
    if (source !== "youtube") switchSource("youtube");
    setView("downloads");
  };

  const playYoutubeTrack = (track: YoutubeTrack, playlist?: YoutubeTrack[]) => {
    if (source !== "youtube") switchSource("youtube");

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
    setView("nowPlaying");
  };

  const requestPermission = () => {
    void openNotificationSettings().catch(() => {});
  };

  return (
    <div className={`app-root${IS_ANDROID ? " platform-android" : ""}`}>
      <div
        className="ipod-stage"
        style={{ "--ipod-scale": scale } as CSSProperties}
      >
        <IpodShell theme="classic-white">
          <IpodDisplay
            state={state}
            positionSec={positionSec}
            view={view}
            history={system.history}
            source={source}
            currentVideoId={isYoutube ? youtube.current?.videoId ?? null : null}
            ytCurrent={youtube.current}
            ytQueue={youtube.queue}
            ytResults={youtube.results}
            ytQuery={youtube.query}
            ytSearching={youtube.searching}
            ytLoading={youtube.loading}
            ytError={youtube.error}
            ytLikes={youtube.likes}
            ytDownloads={youtube.downloads}
            ytDownloadingId={youtube.downloadingId}
            ytDownloadError={youtube.downloadError}
            onSeek={seek}
            onRequestPermission={requestPermission}
            onToggleSource={toggleSource}
            onOpenSearch={openSearch}
            onOpenNowPlaying={() => setView("nowPlaying")}
            onOpenLikes={openLikes}
            onOpenDownloads={openDownloads}
            onQueryChange={youtube.setQuery}
            onSearch={() => void youtube.search()}
            onPlayTrack={playYoutubeTrack}
            onToggleLike={youtube.toggleLike}
            onDownload={youtube.download}
            onRemoveDownload={youtube.removeDownload}
          />
          <ClickWheel
            isPlaying={state.status === "playing"}
            onMenu={handleMenu}
            onPrevious={skipPrevious}
            onNext={skipNext}
            onPlayPause={playPause}
            onSelect={handleSelect}
          />
        </IpodShell>
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
