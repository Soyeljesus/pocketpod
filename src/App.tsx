import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useMediaSession } from "./hooks/useMediaSession";
import { IpodShell } from "./components/ipod/IpodShell";
import { IpodDisplay } from "./components/ipod/IpodDisplay";
import type { IpodView } from "./components/ipod/IpodDisplay";
import { ClickWheel } from "./components/ipod/ClickWheel";
import "./styles/ipod.css";

// Tamaño de diseño del iPod. La ventana puede encogerse hasta el mínimo
// configurado en tauri.conf.json y el contenido se escala proporcionalmente.
const IPOD_BASE_WIDTH = 380;
const IPOD_BASE_HEIGHT = 680;

function computeScale(): number {
  if (typeof window === "undefined") return 1;
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
  const { state, positionSec, history, playPause, next, previous, seek } =
    useMediaSession();
  const [view, setView] = useState<IpodView>("nowPlaying");
  const scale = useIpodScale();

  const handleMenu = () => {
    setView((current) => (current === "menu" ? "nowPlaying" : "menu"));
  };

  const handleSelect = () => {
    if (view === "menu") setView("nowPlaying");
  };

  return (
    <div className="app-root">
      <div
        className="ipod-stage"
        style={{ "--ipod-scale": scale } as CSSProperties}
      >
        <IpodShell theme="classic-white">
          <IpodDisplay
            state={state}
            positionSec={positionSec}
            view={view}
            history={history}
            onSeek={seek}
          />
          <ClickWheel
            isPlaying={state.status === "playing"}
            onMenu={handleMenu}
            onPrevious={previous}
            onNext={next}
            onPlayPause={playPause}
            onSelect={handleSelect}
          />
        </IpodShell>
      </div>
    </div>
  );
}

export default App;
