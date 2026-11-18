import { useState } from "react";
import type { FormEvent } from "react";
import type { SavedPlaylist, YoutubeTrack } from "../types/youtube";

interface AddToPlaylistSheetProps {
  track: YoutubeTrack;
  playlists: SavedPlaylist[];
  onAdd: (playlistId: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}

export function AddToPlaylistSheet({
  track,
  playlists,
  onAdd,
  onCreate,
  onClose,
}: AddToPlaylistSheetProps) {
  const [name, setName] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onCreate(name);
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Añadir a playlist"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-header">
          <div>
            <strong>Añadir a playlist</strong>
            <small>{track.title}</small>
          </div>
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
        </header>

        <form className="sheet-form" onSubmit={submit}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nueva playlist"
            aria-label="Nombre de la nueva playlist"
            autoComplete="off"
            enterKeyHint="done"
          />
          <button type="submit" disabled={!name.trim()}>
            Crear
          </button>
        </form>

        <div className="sheet-list">
          {playlists.map((playlist) => {
            const added = playlist.tracks.some(
              (item) => item.videoId === track.videoId,
            );
            return (
              <button
                type="button"
                key={playlist.id}
                disabled={added}
                onClick={() => onAdd(playlist.id)}
              >
                <span>{playlist.title}</span>
                <small>
                  {added ? "Ya está añadida" : `${playlist.tracks.length} canciones`}
                </small>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
