import type { HistoryEntry, MediaState } from "../../types/media";
import { ConnectionStatus } from "./ConnectionStatus";
import { TrackProgress } from "./TrackProgress";

export type IpodView = "nowPlaying" | "menu";

interface IpodDisplayProps {
  state: MediaState;
  positionSec: number;
  view: IpodView;
  history: HistoryEntry[];
  onSeek: (seconds: number) => void;
  onRequestPermission?: () => void;
}

function trackKey(track: { title: string; artist: string }): string {
  return `${track.title}::${track.artist}`.toLowerCase();
}

function MenuView({
  state,
  history,
}: {
  state: MediaState;
  history: HistoryEntry[];
}) {
  if (history.length === 0) {
    return (
      <div className="ipod-display-empty">
        <p className="empty-title">Sin historial</p>
        <p className="empty-sub">Las canciones aparecerán aquí</p>
      </div>
    );
  }

  const currentKey = trackKey(state);

  return (
    <div className="ipod-menu">
      {history.map((track, index) => {
        const isCurrent =
          state.connected &&
          state.title.length > 0 &&
          trackKey(track) === currentKey;

        return (
          <div
            key={`${track.title}-${track.artist}-${index}`}
            className={`ipod-menu-row ${isCurrent ? "current" : ""}`}
          >
            <div className="ipod-menu-art">
              {track.artworkDataUrl ? (
                <img src={track.artworkDataUrl} alt="" />
              ) : (
                <span>♪</span>
              )}
            </div>
            <div className="ipod-menu-text">
              <span className="ipod-menu-title">{track.title}</span>
              <span className="ipod-menu-artist">{track.artist}</span>
            </div>
            {isCurrent && <span className="ipod-menu-playing">▶</span>}
          </div>
        );
      })}
    </div>
  );
}

export function IpodDisplay({
  state,
  positionSec,
  view,
  history,
  onSeek,
  onRequestPermission,
}: IpodDisplayProps) {
  const hasTrack = state.connected && state.title.length > 0;
  const needsPermission = state.permissionGranted === false;

  return (
    <div className="ipod-display">
      <div className="ipod-display-header">
        <span className="ipod-display-title">
          {view === "menu" ? "Music" : "Now Playing"}
        </span>
        <div className="ipod-display-header-right">
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
        <MenuView state={state} history={history} />
      ) : !hasTrack ? (
        needsPermission ? (
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
