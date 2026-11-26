import { displayText } from "../../i18n/index";
// Per-game settings profile, pushed to OpenMouse Bridge's `/v1/profiles` so it
// keeps applying the moment Bridge sees the game come to the foreground —
// even with this tab closed. There is no browser-side equivalent: only
// Bridge watches running processes, so every profile here is Bridge-backed,
// unlike Desktop's local, localStorage-only game-profiles.ts.
//
// The settings are edited with the device page's own cards. While this panel
// is open the controller runs a game-profile draft (see
// `beginGameProfileDraft`): every change the cards stage becomes part of the
// profile instead of being written to the mouse, and the profile is exactly
// the set of fields the draft makes different from the mouse's current
// settings. useBridgeProfileApplier writes it when the game launches and puts
// the replaced values back when it closes.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Gamepad2, Mouse } from "lucide-react";
import * as control from "../../device/controller";
import type { BridgeGame, BridgeProfile } from "../bridge/bridge";
import { bridgeProfiles, saveBridgeProfiles } from "../bridge/bridge";
import { subscribeBridgeHidActive } from "../bridge/bridge-hid";
import { fetchGamesCatalog, gameArtwork, type CatalogGame } from "./games-catalog";
import { AppIcon } from "./AppIcon";
import { snapshotKey, type GameProfileSnapshot } from "../../device/game-profile-snapshot";
import type { ControlSnapshot, SidebarDevice, ToastKind, WorkspaceTab } from "../../device/types";
import { t, tp, type I18nKey } from "../../i18n/index";
import type { InterfaceLocale } from "../settings/interface-preferences";
import { cardAvailability } from "../devices/cards/availability";
import { TabIcon, Workspace } from "../devices/OverviewPage";
import { profileTarget } from "../bridge/useBridgeProfileApplier";
import { availableWorkspaceTabs } from "../devices/workspace-tabs";
import { gameIdentity, matchesGame, profileApplication, replaceGameProfile, targetActivation } from "./local-applications";

const SAVE_DEBOUNCE_MS = 600;
let profileWrites: Promise<void> = Promise.resolve();

// Overview is read-only device information, and Profiles manages the mouse's
// onboard memory itself — neither is a per-game setting.
const GAME_PROFILE_TABS: readonly WorkspaceTab[] = ["performance", "lighting", "buttons", "advanced"];

type NotifyKind = "enabled" | "updated" | "disabled" | null;

function notifyResult(locale: InterfaceLocale, gameName: string, kind: NotifyKind, ok: boolean): void {
  if (!ok) {
    control.pushToast(
      "error",
      t(locale, "bridge.profileSaveFailed"),
      t(locale, "bridge.profileSaveFailedDetail"),
    );
    return;
  }
  if (kind === null) return;
  const copy: Record<Exclude<NotifyKind, null>, [ToastKind, "bridge.profileEnabledDetail" | "bridge.profileUpdatedDetail" | "bridge.profileDisabledDetail"]> = {
    enabled: ["success", "bridge.profileEnabledDetail"],
    updated: ["success", "bridge.profileUpdatedDetail"],
    disabled: ["info", "bridge.profileDisabledDetail"],
  };
  const [toastKind, detailKey] = copy[kind];
  const titleKey = kind === "enabled" ? "bridge.profileEnabled" : kind === "updated" ? "bridge.profileUpdated" : "bridge.profileDisabled";
  control.pushToast(toastKind, t(locale, titleKey), tp(locale, detailKey, { name: gameName }));
}

function deviceBrand(device: SidebarDevice): string {
  return device.detail.split(" · ")[0] ?? "";
}

function deviceId(device: SidebarDevice): string {
  return `${deviceBrand(device)}:${device.name}`;
}

function selectedIndex(devices: SidebarDevice[]): number | null {
  if (devices.length === 0) return null;
  const selected = devices.findIndex((device) => device.selected);
  return selected === -1 ? 0 : selected;
}

export function GameProfilePanel({
  snapshot,
  game,
  onBack,
}: {
  snapshot: ControlSnapshot;
  game: BridgeGame;
  onBack: () => void;
}): ReactNode {
  const locale = snapshot.preferences.locale;
  const devices = snapshot.devices;

  const [catalogEntry, setCatalogEntry] = useState<CatalogGame | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [autoApply, setAutoApply] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [applying, setApplying] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>("performance");
  // The profile as Bridge last stored it; the draft opens on these values.
  const savedRef = useRef<GameProfileSnapshot>({});
  const savedKey = useRef("{}");
  const targetProfiles = useRef(new Map<string, { settings: GameProfileSnapshot; enabled: boolean; pending?: boolean; error?: boolean }>());
  const pendingWrites = useRef(0);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTarget = useRef<string | null>(null);
  // The draft as of the last render. A draft that has to restart (a write was
  // still running when it began, or the target mouse changed) reopens on
  // these values, so edits not yet saved survive it.
  const lastDraft = useRef<GameProfileSnapshot | null>(null);
  const draftOwner = control.getGameProfileOwner();
  const lastDraftOwner = useRef(draftOwner);
  if (lastDraftOwner.current !== draftOwner) {
    lastDraftOwner.current = draftOwner;
    lastDraft.current = null;
  }
  // Set when a draft opens on the saved profile. Opening can fill in fields
  // the saved copy leaves implicit (a DPI on a stage-aware mouse also sets
  // its stage table), so the first draft is adopted as "saved" instead of
  // being written straight back to Bridge with an "updated" toast.
  const adoptDraft = useRef(false);

  // Every save/load on this page goes straight to Bridge — if it goes away
  // mid-session (quit, crash, machine sleep), staying here just means a form
  // that silently fails every action. Bounce back; App then drops the
  // Games page itself, since it only exists while Bridge is active.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => subscribeBridgeHidActive((active) => {
    if (!active) onBackRef.current();
  }), []);

  useEffect(() => {
    const controller = new AbortController();
    if (game.source === "local") {
      setCatalogEntry(null);
      return;
    }
    void fetchGamesCatalog(controller.signal)
      .then((catalog) => {
        const match = catalog.find((entry) => entry.name.toLowerCase() === game.name.toLowerCase());
        setCatalogEntry(match ?? null);
      })
      .catch(() => setCatalogEntry(null));
    return () => controller.abort();
  }, [game.name, game.source]);

  useEffect(() => {
    setLoaded(false);
    setLoadError(false);
    const controller = new AbortController();
    void profileWrites.then(() => bridgeProfiles(controller.signal)).then((profiles) => {
      if (controller.signal.aborted) return;
      targetProfiles.current.clear();
      for (const profile of profiles.filter((entry) => matchesGame(entry, game))) {
        targetProfiles.current.set(profile.device.id, { settings: profileTarget(profile), enabled: profile.enabled !== false });
      }
      const selected = devices.find((device) => device.selected);
      const candidates = profiles.filter((profile) => matchesGame(profile, game));
      const existing = candidates.find((profile) => selected && profile.device.id === deviceId(selected))
        ?? candidates.find((profile) => devices.some((device) => deviceId(device) === profile.device.id));
      savedRef.current = existing ? profileTarget(existing) : {};
      savedKey.current = snapshotKey(savedRef.current);
      setAutoApply(existing !== undefined && existing.enabled !== false);
      const matchedDevice = existing
        ? devices.findIndex((device) => deviceId(device) === existing.device.id)
        : -1;
      setTargetIndex(matchedDevice !== -1 ? matchedDevice : selectedIndex(devices));
      setLoaded(true);
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameIdentity(game)]);

  const target = targetIndex !== null ? devices[targetIndex] : undefined;
  activeTarget.current = target ? deviceId(target) : null;
  const editing = Boolean(target?.selected) && snapshot.deviceStatus !== null;

  // The cards edit whichever mouse is connected, so the draft only runs while
  // that is the profile's target. It ends when this panel closes, putting the
  // user's own unflashed device-page edits back.
  // A write that is not ours restarts the draft once it is over. Apply now is
  // ours: restarting there would clear the staged changes before the writer
  // reads them (HITS writes nothing), so the draft stays open through it.
  const busyElsewhere = snapshot.settingInProgress && !applying;
  useEffect(() => {
    if (!loaded || !editing || busyElsewhere) return;
    const reopening = lastDraft.current !== null;
    if (!control.beginGameProfileDraft(lastDraft.current ?? savedRef.current)) return;
    adoptDraft.current = !reopening;
    return () => control.endGameProfileDraft(draftOwner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, editing, draftOwner, targetIndex, busyElsewhere]);

  // Closing the page puts back what "Apply now" replaced. That holds while the
  // game runs too: the applier can only take over once the draft has ended, and
  // it captures what the mouse has then as the settings to give back after the game.
  useEffect(() => () => {
    void control.restoreGameProfileApply();
  }, []);

  const draft = snapshot.gameProfileDraft ? control.gameProfileDraftSnapshot() : null;
  if (draft !== null) lastDraft.current = draft;
  const current = draft ?? lastDraft.current ?? savedRef.current;
  const currentKey = snapshotKey(current);
  if (draft !== null && adoptDraft.current) {
    adoptDraft.current = false;
    savedKey.current = currentKey;
  }
  const changedCount = Object.keys(current).length;

  async function persist(
    next: { settings: GameProfileSnapshot; targetIndex: number | null; autoApply: boolean },
    notify: NotifyKind,
  ): Promise<void> {
    const device = next.targetIndex !== null ? devices[next.targetIndex] : undefined;
    if (!device || !loaded) return;
    const owner = draftOwner;
    const id = deviceId(device);
    const stored = { settings: next.settings, enabled: next.autoApply, pending: true, error: false };
    targetProfiles.current.set(id, stored);
    pendingWrites.current++;
    setSaving(true);
    setSaveFailed(false);
    const write = async (): Promise<void> => {
      let ok = true;
      try {
        const profiles = await bridgeProfiles();
        // A profile is stored whenever it sets anything or is on; the toggle
        // only decides whether Bridge applies it.
        const keep = next.autoApply || Object.keys(next.settings).length > 0;
        if (keep) {
          const profile: BridgeProfile = {
            application: profileApplication(game),
            device: { id: deviceId(device), name: device.name },
            enabled: next.autoApply,
            settings: {
              dpi: next.settings.dpi ?? null,
              pollingRateHz: next.settings.pollingRateHz ?? null,
              snapshot: next.settings,
            },
          };
          await saveBridgeProfiles(replaceGameProfile(profiles, game, deviceId(device), profile));
        } else {
          await saveBridgeProfiles(replaceGameProfile(profiles, game, deviceId(device), null));
        }
        const acknowledged = (await bridgeProfiles()).find((profile) => matchesGame(profile, game) && profile.device.id === id);
        if (keep ? !acknowledged || (acknowledged.enabled !== false) !== next.autoApply || snapshotKey(profileTarget(acknowledged)) !== snapshotKey(next.settings) : acknowledged) throw new Error("Profile verification failed");
        if (activeTarget.current === id && control.getGameProfileOwner() === owner && targetProfiles.current.get(id) === stored) {
          savedRef.current = next.settings;
          savedKey.current = snapshotKey(next.settings);
        }
      } catch {
        // Bridge being briefly unreachable shouldn't block the form; the next
        // successful save (or the next page load's re-fetch) reconciles state
        // — but the user still needs to know THIS attempt didn't land.
        ok = false;
        stored.error = true;
      } finally {
        stored.pending = false;
        pendingWrites.current--;
        setSaving(pendingWrites.current > 0);
      }
      if (activeTarget.current === id && control.getGameProfileOwner() === owner && targetProfiles.current.get(id) === stored) {
        setSaveFailed(!ok);
        notifyResult(locale, game.name, notify, ok);
      }
    };
    profileWrites = profileWrites.then(write, write);
    await profileWrites;
  }

  // Draft edits save themselves, on or off, so leaving the page never loses
  // them. Only a save to a profile that is on is worth a toast: it changes
  // what Bridge will do. The toggle saves on its own, so it reads through a
  // ref here rather than re-running this effect.
  const autoApplyRef = useRef(autoApply);
  autoApplyRef.current = autoApply;
  const pendingSave = useRef<(() => void) | null>(null);
  function cancelPending(): void {
    pendingSave.current = null;
    if (pendingTimer.current !== null) clearTimeout(pendingTimer.current);
    pendingTimer.current = null;
  }
  useEffect(() => {
    cancelPending();
    const stored = target ? targetProfiles.current.get(deviceId(target)) : undefined;
    if (!loaded || draft === null || currentKey === savedKey.current || (stored?.pending && snapshotKey(stored.settings) === currentKey)) return;
    const save = (): void => {
      cancelPending();
      if (control.getGameProfileOwner() !== draftOwner) return;
      const on = autoApplyRef.current;
      void persist({ settings: current, targetIndex, autoApply: on }, on ? "updated" : null);
    };
    pendingSave.current = save;
    pendingTimer.current = setTimeout(save, SAVE_DEBOUNCE_MS);
    const timer = pendingTimer.current;
    return () => { if (timer !== null) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, loaded, targetIndex, draftOwner]);
  // Leaving the page mid-debounce still saves the last edit.
  useEffect(() => () => pendingSave.current?.(), []);

  function selectTarget(index: number): void {
    const device = devices[index];
    if (!device) return;
    if (index === targetIndex) return;
    pendingSave.current?.();
    control.endGameProfileDraft(draftOwner);
    const stored = targetProfiles.current.get(deviceId(device));
    savedRef.current = stored?.settings ?? {};
    savedKey.current = snapshotKey(savedRef.current);
    lastDraft.current = null;
    setAutoApply(stored?.enabled ?? false);
    setSaveFailed(stored?.error ?? false);
    setTargetIndex(index);
    if (!device.selected && control.hasGameProfileApplyToRestore()) {
      // What Apply now changed goes back to the mouse it was written to, before the other one is selected.
      control.endGameProfileDraft(draftOwner);
      void control.restoreGameProfileApply().then(() => control.selectAuthorizedDevice(device.index));
    } else if (!device.selected) void control.selectAuthorizedDevice(device.index);
  }

  function toggleAutoApply(): void {
    cancelPending();
    const next = !autoApply;
    setAutoApply(next);
    void persist({ settings: current, targetIndex, autoApply: next }, next ? "enabled" : "disabled");
  }

  function clearProfile(): void {
    cancelPending();
    const wasEnabled = autoApply;
    setAutoApply(false);
    control.resetGameProfileDraft({});
    lastDraft.current = {};
    void persist({ settings: {}, targetIndex, autoApply: false }, wasEnabled ? "disabled" : null);
  }

  async function applyNow(): Promise<void> {
    setApplying(true);
    try {
      if (await control.applyGameProfileDraftNow() === "written") {
        control.pushToast("success", t(locale, "games.appliedNow"), t(locale, "games.appliedNowDetail"));
      }
    } finally {
      setApplying(false);
    }
  }

  const artwork = game.source !== "local" && catalogEntry ? gameArtwork(catalogEntry) : null;
  const tabs = editing
    ? availableWorkspaceTabs(true, cardAvailability(snapshot)).filter((entry) => GAME_PROFILE_TABS.includes(entry))
    : [];
  const activeTab = tabs.includes(tab) ? tab : tabs[0] ?? "performance";

  return (
    <div className="om-page game-profile-page">
      <button type="button" className="om-btn is-ghost game-profile-back" onClick={onBack}>
        <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />
        {t(locale, "nav.games")}
      </button>

      {saveFailed ? <div role="alert"><p className="feedback-error">{t(locale, "bridge.profileSaveFailed")}</p><button type="button" className="om-btn is-sm game-profile-retry" disabled={saving} onClick={() => { cancelPending(); void persist({ settings: current, targetIndex, autoApply }, autoApply ? "updated" : null); }}>{t(locale, "set.retry")}</button></div> : null}
      {!loaded ? <p className="om-meta" role={loadError ? "alert" : "status"}>{t(locale, loadError ? "localApps.loadFailed" : "localApps.loading")}</p> : null}

      <div className="om-panel game-profile-layout">
        <div className="game-profile-side">
          <div className="game-profile-art">
            {artwork ? (
              <img src={artwork} alt={game.name} loading="lazy" draggable={false} />
            ) : (
              <AppIcon iconId={game.iconId} className="game-profile-icon" fallback={<Gamepad2 size={40} strokeWidth={1.5} aria-hidden="true" />} />
            )}
          </div>
        </div>

        <div className="game-profile-settings">
          <div className="game-profile-name-card">
            <div>
              <h1 className="game-profile-name">{game.name}</h1>
              {game.source === "local" ? <><span className="om-badge">{t(locale, "localApps.local")}</span><span className="games-local-path">{game.bundlePath || game.path || game.executables[0]}</span></> : null}
              <span className="game-profile-changed">
                {displayText(locale, changedCount === 0
                  ? t(locale, "games.noChanges")
                  : tp(locale, "games.changedCount", { n: changedCount }))}
              </span>
            </div>
            <div className="game-profile-actions">
              <button
                type="button"
                className="om-btn"
                disabled={!loaded || applying || !snapshot.gameProfileDraft || snapshot.pending.keys.length === 0}
                onClick={() => { void applyNow(); }}
              >{t(locale, "games.applyNow")}</button>
              <button
                type="button"
                className="om-btn is-ghost game-profile-clear"
                disabled={!loaded || saving || applying || (!autoApply && changedCount === 0)}
                onClick={clearProfile}
              >{t(locale, "cap.clear")}</button>
            </div>
          </div>

          <section className="game-profile-section">
            <h2 className="game-profile-section-label">{t(locale, "nav.devices")}</h2>
            {devices.length === 0 ? (
              <p className="game-profile-empty">{displayText(locale, "No devices detected yet.")}</p>
            ) : (
              <ul className="game-profile-devices">
                {devices.map((device, index) => (
                  <li key={device.index} className="game-profile-device-row">
                    <span className="game-profile-device-icon" aria-hidden="true"><Mouse size={20} strokeWidth={1.8} /></span>
                    <span className="game-profile-device-text">
                      <span className="game-profile-device-name">{device.name}</span>
                      <span className="game-profile-device-brand">{displayText(locale, deviceBrand(device))}</span>
                    </span>
                    <button
                      type="button"
                      className={`om-btn is-sm game-profile-select${targetIndex === index ? " is-selected" : ""}`}
                      disabled={!loaded || saving}
                      onClick={() => selectTarget(index)}
                    >
                      {displayText(locale, targetIndex === index ? "Selected" : "Select")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="game-profile-section game-profile-auto-apply">
            <div className="game-profile-auto-apply-text">
              <span className="game-profile-auto-apply-title">{displayText(locale, "Apply automatically")}</span>
              {game.source === "local" && targetActivation(game) === "focused" ? <span className="game-profile-auto-apply-body">{t(locale, "localApps.focusedLimit")}</span> : null}
              <span className="game-profile-auto-apply-body">{game.source === "local" ? t(locale, targetActivation(game) === "focused" ? "localApps.appHint" : "localApps.gameHint") : tp(locale, "bridge.profileEnabledDetail", { name: game.name })}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-label={t(locale, "games.autoApply")}
              aria-checked={autoApply}
              className={`switch-button game-profile-toggle${autoApply ? " is-on" : ""}`}
              disabled={!loaded || saving || targetIndex === null}
              onClick={toggleAutoApply}
            >
              <span className="switch-thumb game-profile-toggle-thumb" />
            </button>
          </section>
        </div>
      </div>

      <section className="game-profile-workspace" aria-label={t(locale, "games.settings")}>
        <div className="game-profile-workspace-head">
          <span className="game-profile-section-title">{t(locale, "games.settings")}</span>
          <span className="game-profile-auto-apply-body">
            {tp(locale, "games.settingsHint", { name: game.name })}
          </span>
        </div>
        {!editing ? (
          <p className="game-profile-empty">
            {target
              ? tp(locale, "games.connectTarget", { name: target.name })
              : t(locale, "games.noTarget")}
          </p>
        ) : (
          <>
            <nav className="om-tabs device-tabs-bar game-profile-tabs" role="tablist" aria-label={t(locale, "games.settings")}>
              {tabs.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="tab"
                  className={`om-tab device-tab-pill${activeTab === entry ? " active is-active" : ""}`}
                  aria-selected={activeTab === entry}
                  onClick={() => setTab(entry)}
                >
                  <TabIcon tab={entry} />
                  {t(locale, `tab.${entry}` as I18nKey)}
                </button>
              ))}
            </nav>
            {snapshot.gameProfileDraft ? (
              <Workspace
                snapshot={{ ...snapshot, workspaceTab: activeTab }}
                onOpenCapture={() => undefined}
                onShareProfile={() => undefined}
                gameProfile
              />
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
