// The Games page — only reachable while OpenMouse Bridge is actually
// reachable, i.e. `navigator.hid` is currently Bridge's WebHID shim, not the
// browser's own implementation (see bridge-hid.ts). Lists the games Bridge
// knows how to detect, which it syncs from the same `games.json` Desktop
// ships (github.com/OpenMouse-Project/Desktop), so this list always matches
// what Desktop's own Games page would show. Picking one opens its profile.
import { useEffect, useState, type ReactNode } from "react";
import { Gamepad2, Plus } from "lucide-react";
import { bridgeGames, bridgeProfiles, type BridgeGame, type BridgeStatus } from "../bridge";
import { isBridgeHidActive, subscribeBridgeHidActive } from "../bridge-hid";
import { subscribeBridgeStatus } from "../bridge-status-store";
import type { ControlSnapshot } from "../device/types";
import { fetchGamesCatalog, gameArtwork } from "../games-catalog";
import { t } from "../i18n";
import { GameProfilePanel } from "./GameProfilePanel";
import { GameRequestDialog } from "./GameRequestDialog";

export function useBridgeActive(): boolean {
  const [active, setActive] = useState(isBridgeHidActive());
  useEffect(() => subscribeBridgeHidActive(setActive), []);
  return active;
}

function useBridgeGames(active: boolean): BridgeGame[] {
  const [games, setGames] = useState<BridgeGame[]>([]);
  useEffect(() => {
    if (!active) return;
    // The games list only changes with a commit to Desktop's repo, not
    // anything a session does — one fetch per connection is plenty.
    const controller = new AbortController();
    void bridgeGames(controller.signal).then(setGames).catch(() => undefined);
    return () => controller.abort();
  }, [active]);
  return games;
}

function useArtworkByName(): Map<string, string> {
  const [artwork, setArtwork] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const controller = new AbortController();
    void fetchGamesCatalog(controller.signal)
      .then((catalog) => {
        const next = new Map<string, string>();
        for (const entry of catalog) {
          const url = gameArtwork(entry);
          if (url) next.set(entry.name.toLowerCase(), url);
        }
        setArtwork(next);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return artwork;
}

export function GamesPage({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;
  const active = useBridgeActive();
  const games = useBridgeGames(active);
  const artwork = useArtworkByName();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [profiled, setProfiled] = useState<Set<string>>(new Set());
  const [selectedGame, setSelectedGame] = useState<BridgeGame | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  useEffect(() => subscribeBridgeStatus(setStatus), []);

  // Refetched every time the grid comes back into view, so a profile just
  // turned on/off in GameProfilePanel shows up in its badge immediately.
  useEffect(() => {
    if (!active || selectedGame) return;
    const controller = new AbortController();
    void bridgeProfiles(controller.signal)
      .then((profiles) => setProfiled(new Set(profiles
        .filter((profile) => profile.enabled !== false)
        .map((profile) => profile.application.name.toLowerCase()))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [active, selectedGame]);

  if (selectedGame) {
    return <GameProfilePanel snapshot={snapshot} game={selectedGame} onBack={() => setSelectedGame(null)} />;
  }

  return (
    <div className="games-page">
      <div className="games-header">
        <h1 className="games-title">{t(locale, "nav.games")}</h1>
        <p className="games-subtitle">{t(locale, "games.subtitle")}</p>
        <span className="games-bridge-status">
          <span className="games-bridge-dot" aria-hidden="true" />
          {t(locale, "bridge.title")} · {t(locale, "bridge.connected")}
          {status?.version ? ` · v${status.version}` : ""}
        </span>
      </div>

      <ul className="games-grid">
        {games.map((game) => {
          const art = artwork.get(game.name.toLowerCase());
          return (
            <li key={game.name}>
              <button type="button" className="games-tile" onClick={() => setSelectedGame(game)}>
                <span className="games-tile-art">
                  {art ? (
                    <img src={art} alt="" loading="lazy" />
                  ) : (
                    <Gamepad2 size={28} strokeWidth={1.6} aria-hidden="true" />
                  )}
                  {profiled.has(game.name.toLowerCase()) ? (
                    <span className="games-tile-badge">{t(locale, "games.autoApply")}</span>
                  ) : null}
                </span>
                <span className="games-tile-name">{game.name}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" className="games-tile games-tile-request" onClick={() => setRequestOpen(true)}>
            <span className="games-tile-art">
              <Plus size={28} strokeWidth={2} aria-hidden="true" />
              <span className="games-tile-request-copy">{t(locale, "gamereq.tileHint")}</span>
            </span>
            <span className="games-tile-name">{t(locale, "gamereq.tile")}</span>
          </button>
        </li>
      </ul>

      <GameRequestDialog
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        locale={locale}
        bridgeActive={active}
        knownGames={games}
      />
    </div>
  );
}
