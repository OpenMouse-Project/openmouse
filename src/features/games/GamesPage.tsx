import { displayText, t, type I18nKey } from "../../i18n/index";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Download, Gamepad2, Plus } from "lucide-react";
import { bridgeGames, bridgeLocalApplications, bridgeProfiles, BridgeHttpError, type BridgeGame, type BridgeStatus, type LocalApplication } from "../bridge/bridge";
import { isBridgeHidActive, subscribeBridgeHidActive } from "../bridge/bridge-hid";
import { subscribeBridgeStatus } from "../bridge/bridge-status-store";
import type { ControlSnapshot } from "../../device/types";
import { fetchGamesCatalog, gameArtwork } from "./games-catalog";
import { GameProfilePanel } from "./GameProfilePanel";
import { gameIdentity, localGame, presetGames } from "./local-applications";
import { AppIcon } from "./AppIcon";
import { BRIDGE_RELEASES_URL } from "../bridge/BridgeStatus";

const LocalApplicationDialog = lazy(() => import("./LocalApplicationDialog").then((module) => ({ default: module.LocalApplicationDialog })));

export function useBridgeActive(): boolean {
  const [active, setActive] = useState(isBridgeHidActive());
  useEffect(() => subscribeBridgeHidActive(setActive), []);
  return active;
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
  const catalog = useCatalog();
  const [bridgeList, setBridgeList] = useState<BridgeGame[]>([]);
  const [applications, setApplications] = useState<LocalApplication[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error" | "unsupported">("loading");
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [profiled, setProfiled] = useState<Set<string>>(new Set());
  const [selectedGame, setSelectedGame] = useState<BridgeGame | null>(null);
  const [dialog, setDialog] = useState<{ application?: LocalApplication; remove?: boolean } | null>(null);
  const presets = presetGames(active ? bridgeList : [], catalog.games);

  useEffect(() => subscribeBridgeStatus(setStatus), []);

  useEffect(() => {
    setApplications([]);
    setBridgeList([]);
    setDialog(null);
    setSelectedGame(null);
    if (!active) return;
    const controller = new AbortController();
    void bridgeGames(controller.signal).then((games) => { if (!controller.signal.aborted) setBridgeList(games); }).catch(() => undefined);
    return () => controller.abort();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoadState("loading");
    void bridgeLocalApplications(controller.signal).then((apps) => {
      if (controller.signal.aborted) return;
      setApplications(apps);
      setLoadState("ready");
    }).catch((cause) => {
      if (!controller.signal.aborted) setLoadState(cause instanceof BridgeHttpError && cause.status === 404 ? "unsupported" : "error");
    });
    return () => controller.abort();
  }, [active, revision]);

  useEffect(() => {
    if (!active || selectedGame) return;
    const controller = new AbortController();
    void bridgeProfiles(controller.signal)
      .then((profiles) => setProfiled(new Set(profiles.filter((profile) => profile.enabled !== false)
        .map((profile) => profile.application.localId ?? `preset:${profile.application.name.toLowerCase()}`))))
      .catch(() => setProfiled(new Set()));
    return () => controller.abort();
  }, [active, selectedGame, applications]);

  if (selectedGame) return <GameProfilePanel snapshot={snapshot} game={selectedGame} onBack={() => setSelectedGame(null)} />;

  const guidance: I18nKey | null = !active ? "localApps.bridgeRequired" : loadState === "loading" ? "localApps.loading"
    : loadState === "unsupported" ? "localApps.updateBridge" : loadState === "error" ? "localApps.loadFailed" : null;

  function tile(game: BridgeGame): ReactNode {
    const art = game.source === "local" ? undefined : catalog.artwork.get(game.name.toLowerCase());
    return <>
      <span className="games-tile-art">
        {art ? <img src={art} alt={displayText(locale, "")} loading="lazy" /> : <AppIcon iconId={game.iconId} className="games-tile-icon" fallback={<Gamepad2 size={28} strokeWidth={1.6} aria-hidden="true" />} />}
        {profiled.has(gameIdentity(game)) && active ? <span className="om-badge games-tile-badge">{t(locale, "games.autoApply")}</span> : null}
      </span>
      <span className="games-tile-name">{game.name}</span>
    </>;
  }

  return <div className="om-page games-page">
    <div className="om-page-head games-header">
      <div><h1 className="games-title">{t(locale, "localApps.title")}</h1><p className="om-meta games-subtitle">{t(locale, "games.subtitle")}</p></div>
      <span className={`om-badge games-bridge-status${active ? " is-ok" : ""}`}>
        {t(locale, "bridge.title")} · {t(locale, active ? "bridge.connected" : "bridge.notRunning")}
        {displayText(locale, active && status?.version ? ` · v${status.version}` : "")}
      </span>
    </div>
    {!active || loadState === "unsupported" ? <section className="games-needs-bridge">
      <span className="games-needs-bridge-icon" aria-hidden="true"><Gamepad2 strokeWidth={1.8} /></span>
      <div><h2>{t(locale, !active ? "games.needsBridgeTitle" : "localApps.updateBridge")}</h2><p>{t(locale, !active ? "games.needsBridgeBody" : "localApps.privacy")}</p></div>
      <a className="om-btn" href={BRIDGE_RELEASES_URL} target="_blank" rel="noreferrer"><Download size={15} strokeWidth={2} aria-hidden="true" />{t(locale, "bridge.download")}</a>
    </section> : null}
    <section className="games-section" aria-labelledby="local-apps-heading">
      <div className="games-section-head">
        <h2 id="local-apps-heading">{t(locale, "localApps.yours")}</h2>
        <button type="button" className="om-btn is-primary" disabled={!active || loadState !== "ready" || applications.length >= 256} onClick={() => setDialog({})}>
          <Plus size={16} strokeWidth={1.8} aria-hidden="true" />{t(locale, "localApps.add")}
        </button>
      </div>
      {guidance ? <div className="games-local-guidance" role={loadState === "error" && active ? "alert" : "status"}>
        <p className="om-meta">{t(locale, guidance)}</p>
        {active && loadState === "error" ? <button type="button" className="om-btn is-sm" onClick={() => setRevision((value) => value + 1)}>{t(locale, "set.retry")}</button> : null}
      </div> : applications.length === 0 ? <p className="om-meta">{t(locale, "localApps.empty")}</p> : null}
      {active && applications.length > 0 ? <ul className="games-grid games-local-grid">{applications.map((application) => {
        const game = localGame(application);
        return <li key={application.id} className="games-local-target">
          <button type="button" className="games-tile" disabled={loadState !== "ready"} aria-label={`${t(locale, "localApps.openProfile")}: ${application.name}`} onClick={() => setSelectedGame(game)}>{tile(game)}</button>
          <div className="games-local-meta"><span className="om-badge">{t(locale, "localApps.local")}</span><span>{t(locale, application.kind === "game" ? "localApps.game" : "localApps.app")}</span></div>
          <p className="games-local-path" title={application.bundlePath || application.path || application.executable}>{application.bundlePath || application.path || application.executable}</p>
          <div className="games-local-actions">
            <button type="button" className="om-btn is-sm is-ghost" disabled={loadState !== "ready"} onClick={() => setDialog({ application })}>{t(locale, "localApps.edit")}</button>
            <button type="button" className="om-btn is-sm is-ghost" disabled={loadState !== "ready"} onClick={() => setDialog({ application, remove: true })}>{t(locale, "localApps.remove")}</button>
          </div>
        </li>;
      })}</ul> : null}
    </section>
    <section className="games-section" aria-labelledby="games-presets-heading">
      <h2 id="games-presets-heading">{t(locale, "localApps.presets")}</h2>
      <ul className={`games-grid${active ? "" : " is-locked"}`}>{presets.map((game) => <li key={gameIdentity(game)}>
        {active ? <button type="button" className="games-tile" onClick={() => setSelectedGame(game)}>{tile(game)}</button> : <div className="games-tile">{tile(game)}</div>}
      </li>)}</ul>
    </section>
    {dialog ? <Suspense fallback={<p className="om-meta" role="status">{t(locale, "localApps.loading")}</p>}>
      <LocalApplicationDialog locale={locale} active={active} application={dialog.application} remove={dialog.remove} onClose={() => setDialog(null)}
        onSaved={(apps, created) => {
          setApplications(apps);
          setLoadState("ready");
          setDialog(null);
          if (created) setSelectedGame(localGame(created));
        }} />
    </Suspense> : null}
  </div>;
}
