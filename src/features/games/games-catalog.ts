// The same `games.json` Desktop ships and Bridge itself syncs into its own
// `/v1/games` (see bridge.ts's `bridgeGames`, sourced by OpenMouse-Bridge's
// src/games.rs from this identical URL). Bridge's copy is stripped down to
// just {name, executables} — everything a native detector needs — so cover
// art and Steam IDs are fetched here directly, purely for display on the
// game profile page.
const GAMES_URL = "https://cdn.jsdelivr.net/gh/OpenMouse-Project/Desktop@main/public/games.json";

export interface CatalogGame {
  id: string;
  name: string;
  steamAppId?: number;
  artwork?: string;
  executables: string[];
}

interface GamesFile {
  games: CatalogGame[];
}

let cache: Promise<CatalogGame[]> | null = null;

function steamArtwork(steamAppId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/library_600x900_2x.jpg`;
}

export function gameArtwork(game: Pick<CatalogGame, "steamAppId" | "artwork">): string | null {
  if (game.artwork) return game.artwork;
  if (game.steamAppId) return steamArtwork(game.steamAppId);
  return null;
}

/** Cached for the life of the page — this list changes by commits to Desktop's repo, not by anything a session does. */
export async function fetchGamesCatalog(signal?: AbortSignal): Promise<CatalogGame[]> {
  if (!cache) {
    cache = fetch(GAMES_URL, { signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load games (${response.status})`);
        return response.json() as Promise<GamesFile>;
      })
      .then((data) => data.games)
      .catch((error) => {
        cache = null;
        throw error;
      });
  }
  return cache;
}
