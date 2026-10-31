import { useEffect, useRef, useState, type ReactNode } from "react";
import { bridgeApplicationIconUrl, bridgeLocalApplications, bridgeRunningApplications, saveBridgeLocalApplications, BridgeHttpError, type BridgeApplication, type LocalApplication } from "../bridge/bridge";
import { t, tp, type I18nKey } from "../../i18n/index";
import type { InterfaceLocale } from "../settings/interface-preferences";
import { localTargetIdentity, parseLocalTarget, runningTargetPath, runningTargets, supportedLocalTarget, targetActivation } from "./local-applications";

/** Bridge only extracts icons on Windows; elsewhere the URL 404s and the slot stays empty. */
function RunningIcon({ app }: { app: BridgeApplication }): ReactNode {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="local-app-icon" aria-hidden="true" /> : <img className="local-app-icon" src={bridgeApplicationIconUrl(app)} alt="" onError={() => setFailed(true)} />;
}

export function LocalApplicationDialog({ locale, application, remove = false, active, onClose, onSaved }: {
  locale: InterfaceLocale;
  application?: LocalApplication;
  remove?: boolean;
  active: boolean;
  onClose: () => void;
  onSaved: (applications: LocalApplication[], created?: LocalApplication) => void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  const [name, setName] = useState(application?.name ?? "");
  const [target, setTarget] = useState(application?.bundlePath || application?.path || application?.executable || "");
  const [kind, setKind] = useState<"game" | "app">(application?.kind ?? "game");
  const [activation, setActivation] = useState<"running" | "focused">(application ? targetActivation(application) : "running");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  const [running, setRunning] = useState<BridgeApplication[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<BridgeApplication | null>(null);
  const id = useRef(application?.id ?? `local:${crypto.randomUUID()}`);
  const parsed = parseLocalTarget(target);
  const valid = Boolean(supportedLocalTarget(target) && name.trim() && [...name.trim()].length <= 80 && !/[\x00-\x1f\x7f]/.test(name));
  // Only a new target is picked from what is running; an edit keeps its saved path.
  const picking = !application && !remove;
  const needle = query.trim().toLowerCase();
  const shown = running?.filter((app) => !needle || app.name.toLowerCase().includes(needle) || app.executable.toLowerCase().includes(needle)) ?? [];

  async function loadRunning(): Promise<void> {
    setRunning(null);
    try {
      const list = runningTargets(await bridgeRunningApplications());
      if (mounted.current) setRunning(list);
    } catch {
      if (mounted.current) setRunning([]);
    }
  }

  function pick(app: BridgeApplication): void {
    setTarget(runningTargetPath(app));
    // A name the user typed stays; one filled in from an earlier pick follows the new pick.
    if (!name.trim() || name === picked?.name.slice(0, 80)) setName(app.name.slice(0, 80));
    setPicked(app);
    setError(null);
  }

  useEffect(() => {
    if (picking && active) void loadRunning();
  }, [active]);

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    mounted.current = true;
    element?.showModal();
    return () => {
      mounted.current = false;
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  function close(): void {
    if (mounted.current && !saving.current) onClose();
  }

  async function save(): Promise<void> {
    if (saving.current || !active || (!remove && (!valid || !parsed))) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const current = await bridgeLocalApplications();
      if (!mounted.current) return;
      if (application && !current.some((app) => app.id === application.id)) throw new Error("Missing local target");
      const next: LocalApplication | null = remove ? null : { id: id.current, name: name.trim(), ...parsed!, kind, activation };
      const remaining = current.filter((app) => app.id !== id.current);
      if (next && remaining.some((app) => localTargetIdentity(app) === localTargetIdentity(next))) {
        setError("localApps.duplicate");
        return;
      }
      if (next && remaining.length >= 256) {
        setError("localApps.failed");
        return;
      }
      await saveBridgeLocalApplications(next ? [...remaining, next] : remaining);
      const stored = await bridgeLocalApplications();
      if (!mounted.current) return;
      const saved = stored.find((app) => app.id === id.current);
      if (next && saved && saved.activation !== next.activation) {
        setError("localApps.updateBridge");
        return;
      }
      const bundle = next?.path.startsWith("/") && next.path.endsWith(".app");
      const canonical = saved ? parseLocalTarget(saved.path) : null;
      const pathMatches = next && saved && (bundle
        ? saved.bundlePath === next.path && saved.path.startsWith(`${next.path}/`) && canonical?.executable === saved.executable
        : saved.executable === next.executable && saved.path === next.path);
      if (next ? !saved || saved.name !== next.name || !pathMatches || saved.kind !== next.kind : saved) throw new Error("Local target verification failed");
      onSaved(stored, !application ? saved : undefined);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof BridgeHttpError && cause.status === 404 ? "localApps.updateBridge" : "localApps.failed");
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="support-dialog feedback-dialog gamereq-dialog local-app-dialog" aria-labelledby="local-app-title"
      onCancel={(event) => { event.preventDefault(); close(); }} onClose={close}
      onClick={(event) => { if (event.target === dialog.current) close(); }}>
      <form className="support-dialog-inner feedback-dialog-inner" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <header className="om-dialog-head">
          <h2 id="local-app-title">{t(locale, remove ? "localApps.remove" : application ? "localApps.editTitle" : "localApps.addTitle")}</h2>
          <button type="button" className="om-icon-btn" disabled={busy} onClick={close} aria-label={t(locale, "common.close")}>{"×"}</button>
        </header>
        {remove ? <p>{tp(locale, "localApps.removeConfirm", { name: application?.name ?? "" })}</p> : <>
          {picking && active ? (
            <section className="gamereq-finder local-app-running" aria-labelledby="local-app-running-title">
              <div className="local-app-running-head">
                <p id="local-app-running-title" className="gamereq-finder-title">{t(locale, "localApps.runningTitle")}</p>
                <button type="button" className="om-btn is-ghost is-sm" disabled={busy || running === null} onClick={() => { void loadRunning(); }}>{t(locale, "localApps.refresh")}</button>
              </div>
              {running === null ? <p className="gamereq-hint">{t(locale, "localApps.loadingRunning")}</p>
                : running.length === 0 ? <p className="gamereq-hint">{t(locale, "localApps.noRunning")}</p>
                : <>
                  <input id="local-app-search" type="search" value={query} disabled={busy} aria-label={t(locale, "localApps.search")} placeholder={t(locale, "localApps.search")}
                    onChange={(event) => setQuery(event.currentTarget.value)} />
                  {shown.length === 0 ? <p className="gamereq-hint">{t(locale, "localApps.noMatch")}</p> : (
                    <ul className="gamereq-apps">
                      {shown.map((app) => {
                        const path = runningTargetPath(app);
                        return (
                          <li key={path}>
                            <button type="button" aria-pressed={target === path} disabled={busy} onClick={() => pick(app)}>
                              <RunningIcon app={app} />
                              <span>
                                <strong>{app.name}</strong>
                                <small className="gamereq-mono">{path}</small>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>}
            </section>
          ) : null}
          <label className="feedback-handle" htmlFor="local-app-name">
            <span>{t(locale, "localApps.name")}</span>
            <input id="local-app-name" value={name} required disabled={busy} onChange={(event) => setName(event.currentTarget.value)} />
          </label>
          <div className="segmented gamereq-kind" role="radiogroup" aria-label={t(locale, "localApps.kind")}>
            {(["game", "app"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={kind === value}
              className={kind === value ? "is-active selected" : ""} disabled={busy} onClick={() => setKind(value)}>{t(locale, value === "game" ? "localApps.game" : "localApps.app")}</button>)}
          </div>
          <div className="segmented gamereq-kind" role="radiogroup" aria-label={t(locale, "localApps.activation")}>
            {(["running", "focused"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={activation === value}
              className={activation === value ? "is-active selected" : ""} disabled={busy} onClick={() => setActivation(value)}>{t(locale, value === "running" ? "localApps.running" : "localApps.focused")}</button>)}
          </div>
          <p className="gamereq-hint">{t(locale, activation === "running" ? "localApps.gameHint" : "localApps.appHint")}</p>
          {activation === "focused" ? <p className="gamereq-hint">{t(locale, "localApps.focusedLimit")}</p> : null}
          <label className="feedback-handle" htmlFor="local-app-target">
            <span>{t(locale, "localApps.target")}</span>
            <input id="local-app-target" className="gamereq-mono" value={target} required spellcheck={false} disabled={busy} aria-describedby="local-app-manual-hint"
              onChange={(event) => setTarget(event.currentTarget.value)} />
          </label>
          <p id="local-app-manual-hint" className="gamereq-hint">{t(locale, "localApps.manualHint")}</p>
          {target && !valid ? <p className="gamereq-hint">{t(locale, "localApps.invalid")}</p> : null}
        </>}
        <p className="gamereq-hint">{t(locale, "localApps.privacy")}</p>
        {!active ? <p className="feedback-error" role="alert">{t(locale, "localApps.bridgeRequired")}</p> : null}
        {error ? <p className="feedback-error" role="alert">{t(locale, error)}</p> : null}
        <footer className="om-dialog-foot feedback-actions">
          <button type="button" className="om-btn is-ghost" disabled={busy} onClick={close}>{t(locale, "localApps.cancel")}</button>
          <button type="submit" className={`om-btn ${remove ? "is-danger" : "is-primary"}`} disabled={busy || !active || (!remove && !valid)}>
            {t(locale, busy ? "localApps.saving" : remove ? "localApps.confirmRemove" : "localApps.save")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
