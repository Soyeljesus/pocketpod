import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDiscover, fetchMoods, fetchRadio } from "../services/youtubeMusic";
import type {
  DiscoverChip,
  DiscoverShelf,
  MoodGroup,
  YoutubeTrack,
} from "../types/youtube";

export interface SimilarMix {
  artist: string;
  tracks: YoutubeTrack[];
}

export interface UseDiscoverResult {
  chips: DiscoverChip[];
  chip: DiscoverChip | null;
  selectChip: (chip: DiscoverChip | null) => void;
  shelves: DiscoverShelf[];
  shelvesLoading: boolean;
  shelvesError: string | null;
  moods: MoodGroup[];
  picks: YoutubeTrack[];
  similar: SimilarMix[];
  personalLoading: boolean;
  refreshPersonal: () => void;
  retry: () => void;
}

const PICKS_SIZE = 20;
const SIMILAR_SIZE = 16;

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/** Primer artista de un crédito como "A, B & C". */
function mainArtist(artist: string): string {
  return artist.split(/,|&| y | x | feat\.? | ft\.? /i)[0]?.trim() ?? "";
}

/** Artistas que más te gustan, ordenados por cuántos Me gusta tienen. */
export function topArtists(likes: YoutubeTrack[], limit = 3): string[] {
  const counts = new Map<string, { name: string; count: number }>();
  likes.forEach((track, index) => {
    const name = mainArtist(track.artist);
    if (!name) return;
    const key = name.toLowerCase();
    const entry = counts.get(key) ?? { name, count: 0 };
    // Los Me gusta recientes pesan un poco más.
    entry.count += 1 + Math.max(0, 1 - index / 200);
    counts.set(key, entry);
  });
  return [...counts.values()]
    .filter((entry) => entry.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => entry.name);
}

/**
 * Selecciones: radios a partir de lo que escuchaste hace poco y de tus Me
 * gusta. Una canción que aparece en varias radios, o es de un artista que te
 * gusta, sube en la lista. Se priorizan canciones que aún no tienes.
 */
async function buildPicks(
  likes: YoutubeTrack[],
  played: YoutubeTrack[],
  favorites: string[],
): Promise<YoutubeTrack[]> {
  const recent = shuffled(played.slice(0, 12)).slice(0, 2);
  const favoriteSet = new Set(favorites.map((name) => name.toLowerCase()));
  const loved = shuffled(likes.slice(0, 80))
    .sort(
      (a, b) =>
        Number(favoriteSet.has(mainArtist(b.artist).toLowerCase())) -
        Number(favoriteSet.has(mainArtist(a.artist).toLowerCase())),
    )
    .slice(0, 4 - recent.length);
  const seeds = [...recent, ...loved].filter(
    (track, index, list) => list.findIndex((item) => item.videoId === track.videoId) === index,
  );
  if (seeds.length === 0) return [];

  const radios = await Promise.all(seeds.map((seed) => fetchRadio(seed.videoId, 20).catch(() => [])));
  const liked = new Set(likes.map((track) => track.videoId));
  const seedIds = new Set(seeds.map((track) => track.videoId));
  const scores = new Map<string, { track: YoutubeTrack; score: number }>();

  radios.forEach((radio) =>
    radio.forEach((track, position) => {
      if (seedIds.has(track.videoId)) return;
      const entry = scores.get(track.videoId) ?? { track, score: 0 };
      entry.score += 1 + (20 - position) / 40;
      if (favoriteSet.has(mainArtist(track.artist).toLowerCase())) entry.score += 0.6;
      if (liked.has(track.videoId)) entry.score -= 0.9;
      scores.set(track.videoId, entry);
    }),
  );

  // Máximo 3 canciones por artista para que haya variedad.
  const perArtist = new Map<string, number>();
  return [...scores.values()]
    .map((entry) => ({ ...entry, score: entry.score + Math.random() * 0.5 }))
    .sort((a, b) => b.score - a.score)
    .filter((entry) => {
      const key = mainArtist(entry.track.artist).toLowerCase();
      const count = perArtist.get(key) ?? 0;
      perArtist.set(key, count + 1);
      return count < 3;
    })
    .slice(0, PICKS_SIZE)
    .map((entry) => entry.track);
}

/** "Similares a X": canciones parecidas a un artista que te gusta, de otros artistas. */
async function buildSimilar(likes: YoutubeTrack[], artist: string): Promise<SimilarMix | null> {
  const key = artist.toLowerCase();
  const own = likes.filter((track) => mainArtist(track.artist).toLowerCase() === key);
  const seeds = shuffled(own).slice(0, 2);
  if (seeds.length === 0) return null;
  const radios = await Promise.all(seeds.map((seed) => fetchRadio(seed.videoId, 25).catch(() => [])));
  const seen = new Set<string>();
  let sameArtist = 0;
  const tracks: YoutubeTrack[] = [];
  for (const track of radios.flat()) {
    if (seen.has(track.videoId)) continue;
    seen.add(track.videoId);
    const same = mainArtist(track.artist).toLowerCase() === key;
    if (same && sameArtist >= 2) continue;
    if (same) sameArtist += 1;
    tracks.push(track);
    if (tracks.length >= SIMILAR_SIZE) break;
  }
  return tracks.length >= 4 ? { artist, tracks } : null;
}

const pageCache = new Map<string, Promise<{ chips: DiscoverChip[]; shelves: DiscoverShelf[] }>>();

function loadPage(params: string) {
  let page = pageCache.get(params);
  if (!page) {
    page = fetchDiscover(params ? { params } : undefined);
    page.catch(() => pageCache.delete(params));
    pageCache.set(params, page);
  }
  return page;
}

/** Inicio: secciones de YouTube Music más tus mezclas personales. */
export function useDiscover(
  likes: YoutubeTrack[],
  played: YoutubeTrack[],
  enabled: boolean,
): UseDiscoverResult {
  const [chips, setChips] = useState<DiscoverChip[]>([]);
  const [chip, setChip] = useState<DiscoverChip | null>(null);
  const [shelves, setShelves] = useState<DiscoverShelf[]>([]);
  const [shelvesLoading, setShelvesLoading] = useState(false);
  const [shelvesError, setShelvesError] = useState<string | null>(null);
  const [moods, setMoods] = useState<MoodGroup[]>([]);
  const [picks, setPicks] = useState<YoutubeTrack[]>([]);
  const [similar, setSimilar] = useState<SimilarMix[]>([]);
  const [personalLoading, setPersonalLoading] = useState(false);
  const [personalRound, setPersonalRound] = useState(0);
  const [attempt, setAttempt] = useState(0);

  // Si no había conexión al abrir, se reintenta al volver la red.
  useEffect(() => {
    const retry = () => setAttempt((value) => value + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  const latest = useRef({ likes, played });
  const favorites = useMemo(() => topArtists(likes, 2), [likes]);
  const hasTaste = likes.length > 0 || played.length > 0;

  useEffect(() => {
    latest.current = { likes, played };
  });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const params = chip?.params ?? "";
    setShelvesLoading(true);
    setShelvesError(null);
    loadPage(params)
      .then((page) => {
        if (!active) return;
        setShelves(page.shelves);
        if (!params && page.chips.length > 0) setChips(page.chips);
      })
      .catch(() => {
        if (active) setShelvesError("No se pudo cargar. Revisa tu conexión.");
      })
      .finally(() => {
        if (active) setShelvesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chip, enabled, attempt]);

  // Mientras falle, vuelve a intentarlo cada 20 segundos.
  useEffect(() => {
    if (!shelvesError) return;
    const timer = window.setTimeout(() => setAttempt((value) => value + 1), 20_000);
    return () => window.clearTimeout(timer);
  }, [shelvesError]);

  useEffect(() => {
    if (!enabled || moods.length > 0) return;
    let active = true;
    fetchMoods()
      .then((groups) => {
        if (active) setMoods(groups);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [enabled, moods.length, attempt]);

  // Las mezclas personales se calculan al abrir y cuando se pide refrescar.
  useEffect(() => {
    if (!enabled || !hasTaste) return;
    let active = true;
    const { likes: currentLikes, played: currentPlayed } = latest.current;
    setPersonalLoading(true);
    Promise.all([
      buildPicks(currentLikes, currentPlayed, favorites),
      Promise.all(favorites.map((artist) => buildSimilar(currentLikes, artist))),
    ])
      .then(([nextPicks, nextSimilar]) => {
        if (!active) return;
        setPicks(nextPicks);
        setSimilar(nextSimilar.filter((mix): mix is SimilarMix => mix !== null));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setPersonalLoading(false);
      });
    return () => {
      active = false;
    };
    // `favorites` se recalcula con cada Me gusta: solo cambia la mezcla al refrescar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasTaste, personalRound]);

  const selectChip = useCallback((next: DiscoverChip | null) => setChip(next), []);
  const refreshPersonal = useCallback(() => setPersonalRound((value) => value + 1), []);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return {
    chips,
    chip,
    selectChip,
    shelves,
    shelvesLoading,
    shelvesError,
    moods,
    picks,
    similar,
    personalLoading,
    refreshPersonal,
    retry,
  };
}
