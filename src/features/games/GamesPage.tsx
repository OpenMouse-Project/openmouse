import { displayText } from "../../i18n/index";
import { useEffect, useState, type ReactNode } from "react";
import { Download, Gamepad2, Plus, X } from "lucide-react";
import { bridgeCustomGames, bridgeGames, bridgeProfiles, customGameImageUrl, saveBridgeCustomGameImage, saveBridgeCustomGames, saveBridgeProfiles, type BridgeGame, type BridgeStatus } from "../bridge/bridge";
import { isBridgeHidActive, subscribeBridgeHidActive } from "../bridge/bridge-hid";
import { subscribeBridgeStatus } from "../bridge/bridge-status-store";
import type { ControlSnapshot } from "../../device/types";
import { fetchGamesCatalog, gameArtwork } from "./games-catalog";
import { t, tp } from "../../i18n/index";
import { GameProfilePanel } from "./GameProfilePanel";
import { GameRequestDialog } from "./GameRequestDialog";
import { CustomGameDialog } from "./CustomGameDialog";
import { CustomGameImage } from "./CustomGameImage";
import { BRIDGE_RELEASES_URL } from "../bridge/BridgeStatus";

export function useBridgeActive(): boolean {
  const [active, setActive] = useState(isBridgeHidActive());
  useEffect(() => subscribeBridgeHidActive(setActive), []);
  return active;
}

/** `games` is the catalog plus `custom`, the games added by hand. */
function useBridgeGames(active: boolean, version: number): { games: BridgeGame[]; custom: BridgeGame[] } {
  const [lists, setLists] = useState<{ games: BridgeGame[]; custom: BridgeGame[] }>({ games: [], custom: [] });
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void Promise.all([bridgeGames(controller.signal), bridgeCustomGames(controller.signal)])
      .then(([games, custom]) => setLists({ games, custom }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [active, version]);
  return lists;
}

function useCatalog(): { artwork: Map<string, string>; games: BridgeGame[] } {
  const [catalog, setCatalog] = useState<{ artwork: Map<string, string>; games: BridgeGame[] }>({ artwork: new Map(), games: [] });
  useEffect(() => {
    const controller = new AbortController();
    void fetchGamesCatalog(controller.signal)
      .then((entries) => {
        const artwork = new Map<string, string>();
        for (const entry of entries) {
          const url = gameArtwork(entry);
          if (url) artwork.set(entry.name.toLowerCase(), url);
        }
        setCatalog({ artwork, games: entries.map((entry) => ({ name: entry.name, executables: entry.executables })) });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return catalog;
}

export function GamesPage({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;
  const active = useBridgeActive();
  const [gamesVersion, setGamesVersion] = useState(0);
  const { games: bridgeList, custom: customGames } = useBridgeGames(active, gamesVersion);
  const catalog = useCatalog();
  const artwork = catalog.artwork;
  const games = active ? bridgeList : catalog.games;
  const customNames = new Set(customGames.map((game) => game.name.toLowerCase()));
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [profiled, setProfiled] = useState<Set<string>>(new Set());
  const [selectedGame, setSelectedGame] = useState<BridgeGame | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => subscribeBridgeStatus(setStatus), []);

  /** Bridge keys a custom game's picture and profile by its name, so both move with it. */
  async function renameCustomGame(game: BridgeGame, name: string): Promise<"renamed" | "duplicate" | "failed"> {
    const wanted = name.trim();
    if (wanted === "" || wanted === game.name) return "failed";
    const taken = bridgeList.some((entry) => entry.name !== game.name && entry.name.toLowerCase() === wanted.toLowerCase());
    if (taken) return "duplicate";
    try {
      const picture = await fetch(customGameImageUrl(game.name)).then((response) => (response.ok ? response.blob() : null)).catch(() => null);
      await saveBridgeCustomGames(customGames.map((entry) => (entry.name === game.name ? { ...entry, name: wanted } : entry)));
      if (picture) await saveBridgeCustomGameImage(wanted, picture).catch(() => undefined);
      const profiles = await bridgeProfiles();
      if (profiles.some((profile) => profile.application.name.toLowerCase() === game.name.toLowerCase())) {
        await saveBridgeProfiles(profiles.map((profile) => (
          profile.application.name.toLowerCase() === game.name.toLowerCase()
            ? { ...profile, application: { ...profile.application, name: wanted } }
            : profile
        )));
      }
      setSelectedGame({ ...game, name: wanted });
      setGamesVersion((version) => version + 1);
      return "renamed";
    } catch {
      return "failed";
    }
  }

  function removeCustomGame(game: BridgeGame): void {
    const remaining = customGames.filter((entry) => entry.name !== game.name);
    void saveBridgeCustomGames(remaining)
      .then(() => setGamesVersion((version) => version + 1))
      .catch(() => undefined);
  }

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
    return (
      <GameProfilePanel
        snapshot={snapshot}
        game={selectedGame}
        custom={customNames.has(selectedGame.name.toLowerCase())}
        onImageChanged={() => setGamesVersion((version) => version + 1)}
        onRename={(name) => renameCustomGame(selectedGame, name)}
        onBack={() => setSelectedGame(null)}
      />
    );
  }

  return (
    <div className="om-page games-page">
      <div className="om-page-head games-header">
        <div>
          <h1 className="games-title">{t(locale, "nav.games")}</h1>
          <p className="om-meta games-subtitle">{t(locale, "games.subtitle")}</p>
        </div>
        {active ? (
          <span className="om-badge is-ok games-bridge-status">
            <span className="games-bridge-dot" aria-hidden="true"><Gamepad2 size={13} strokeWidth={1.8} /></span>
            {t(locale, "bridge.title")} · {t(locale, "bridge.connected")}
            {displayText(locale, status?.version ? ` · v${status.version}` : "")}
          </span>
        ) : (
          <span className="om-badge games-bridge-status">
            {t(locale, "bridge.title")} · {t(locale, "bridge.notRunning")}
          </span>
        )}
      </div>

      {active ? null : (
        <section className="games-needs-bridge">
          <span className="games-needs-bridge-icon" aria-hidden="true"><Gamepad2 strokeWidth={1.8} /></span>
          <div>
            <h2>{t(locale, "games.needsBridgeTitle")}</h2>
            <p>{t(locale, "games.needsBridgeBody")}</p>
          </div>
          <a className="om-btn is-primary" href={BRIDGE_RELEASES_URL} target="_blank" rel="noreferrer">
            <Download strokeWidth={2} aria-hidden="true" />
            {t(locale, "bridge.download")}
          </a>
        </section>
      )}

      <ul className={`games-grid${active ? "" : " is-locked"}`}>
        {games.map((game) => {
          const art = artwork.get(game.name.toLowerCase());
          const isCustom = active && customNames.has(game.name.toLowerCase());
          const body = (
            <>
              <span className="games-tile-art">
                {isCustom ? (
                  <CustomGameImage name={game.name} version={gamesVersion} />
                ) : art ? (
                  <img src={art} alt={displayText(locale, "")} loading="lazy" />
                ) : (
                  <Gamepad2 size={28} strokeWidth={1.6} aria-hidden="true" />
                )}
                {profiled.has(game.name.toLowerCase()) ? (
                  <span className="om-badge games-tile-badge">{t(locale, "games.autoApply")}</span>
                ) : null}
              </span>
              <span className="games-tile-name">{game.name}</span>
            </>
          );
          return (
            <li key={game.name}>
              {active ? (
                <button type="button" className="games-tile" onClick={() => setSelectedGame(game)}>{body}</button>
              ) : (
                <div className="games-tile">{body}</div>
              )}
              {active && customNames.has(game.name.toLowerCase()) ? (
                <button
                  type="button"
                  className="om-icon-btn games-tile-remove"
                  aria-label={tp(locale, "customgame.removeLabel", { name: game.name })}
                  title={tp(locale, "customgame.removeLabel", { name: game.name })}
                  onClick={() => removeCustomGame(game)}
                >
                  <X size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          );
        })}
        <li>
          <button type="button" className="games-tile games-tile-request" disabled={!active} onClick={() => setCustomOpen(true)}>
            <span className="games-tile-art">
              <Plus size={28} strokeWidth={2} aria-hidden="true" />
              <span className="games-tile-request-copy">{t(locale, "customgame.tileHint")}</span>
            </span>
            <span className="games-tile-name">{t(locale, "customgame.tile")}</span>
          </button>
        </li>
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

      <CustomGameDialog
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        locale={locale}
        knownGames={games}
        customGames={customGames}
        onSaved={() => setGamesVersion((version) => version + 1)}
      />

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
