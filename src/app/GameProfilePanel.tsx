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
import { ArrowLeft, Gamepad2 } from "lucide-react";
import * as control from "../device/controller";
import type { BridgeGame, BridgeProfile } from "../bridge";
import { bridgeProfiles, saveBridgeProfiles } from "../bridge";
import { subscribeBridgeHidActive } from "../bridge-hid";
import { fetchGamesCatalog, gameArtwork, type CatalogGame } from "../games-catalog";
import { snapshotKey, type GameProfileSnapshot } from "../device/game-profile-snapshot";
import type { ControlSnapshot, SidebarDevice, ToastKind, WorkspaceTab } from "../device/types";
import { t, tp, type I18nKey } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";
import { cardAvailability } from "./cards/availability";
import { TabIcon, Workspace } from "./OverviewPage";
import { profileTarget } from "./useBridgeProfileApplier";
import { availableWorkspaceTabs } from "./workspace-tabs";

// Every card edit changes the draft; waiting this long before pushing to
// Bridge (and toasting) keeps a slider drag or typed DPI from becoming a
// dozen separate saves and toasts.
const SAVE_DEBOUNCE_MS = 600;

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

function matchesGame(profile: BridgeProfile, game: BridgeGame): boolean {
  return profile.application.name.toLowerCase() === game.name.toLowerCase();
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
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>("performance");
  // The profile as Bridge last stored it; the draft opens on these values.
  const savedRef = useRef<GameProfileSnapshot>({});
  const savedKey = useRef("{}");
  // The draft as of the last render. A draft that has to restart (a write was
  // still running when it began, or the target mouse changed) reopens on
  // these values, so edits not yet saved survive it.
  const lastDraft = useRef<GameProfileSnapshot | null>(null);
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
    void fetchGamesCatalog(controller.signal)
      .then((catalog) => {
        const match = catalog.find((entry) => entry.name.toLowerCase() === game.name.toLowerCase());
        setCatalogEntry(match ?? null);
      })
      .catch(() => setCatalogEntry(null));
    return () => controller.abort();
  }, [game.name]);

  useEffect(() => {
    setLoaded(false);
    const controller = new AbortController();
    void bridgeProfiles(controller.signal).then((profiles) => {
      const existing = profiles.find((profile) => matchesGame(profile, game));
      savedRef.current = existing ? profileTarget(existing) : {};
      savedKey.current = snapshotKey(savedRef.current);
      setAutoApply(existing !== undefined && existing.enabled !== false);
      const matchedDevice = existing
        ? devices.findIndex((device) => deviceId(device) === existing.device.id)
        : -1;
      setTargetIndex(matchedDevice !== -1 ? matchedDevice : selectedIndex(devices));
      setLoaded(true);
    }).catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.name]);

  const target = targetIndex !== null ? devices[targetIndex] : undefined;
  const editing = Boolean(target?.selected) && snapshot.deviceStatus !== null;

  // The cards edit whichever mouse is connected, so the draft only runs while
  // that is the profile's target. It ends when this panel closes, putting the
  // user's own unflashed device-page edits back.
  useEffect(() => {
    if (!loaded || !editing || snapshot.settingInProgress) return;
    const reopening = lastDraft.current !== null;
    if (!control.beginGameProfileDraft(lastDraft.current ?? savedRef.current)) return;
    adoptDraft.current = !reopening;
    return () => control.endGameProfileDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, editing, target?.name, snapshot.settingInProgress]);

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
    setSaving(true);
    let ok = true;
    try {
      const profiles = await bridgeProfiles();
      const withoutThis = profiles.filter((profile) => !matchesGame(profile, game));
      // A profile is stored whenever it sets anything or is on; the toggle
      // only decides whether Bridge applies it.
      const keep = next.autoApply || Object.keys(next.settings).length > 0;
      if (keep && device) {
        const profile: BridgeProfile = {
          application: { name: game.name, executable: game.executables[0] ?? "", path: "" },
          device: { id: deviceId(device), name: device.name },
          enabled: next.autoApply,
          settings: {
            dpi: next.settings.dpi ?? null,
            pollingRateHz: next.settings.pollingRateHz ?? null,
            snapshot: next.settings,
          },
        };
        await saveBridgeProfiles([...withoutThis, profile]);
      } else {
        await saveBridgeProfiles(withoutThis);
      }
      savedRef.current = next.settings;
      savedKey.current = snapshotKey(next.settings);
    } catch {
      // Bridge being briefly unreachable shouldn't block the form; the next
      // successful save (or the next page load's re-fetch) reconciles state
      // — but the user still needs to know THIS attempt didn't land.
      ok = false;
    } finally {
      setSaving(false);
    }
    notifyResult(locale, game.name, notify, ok);
  }

  // Draft edits save themselves, on or off, so leaving the page never loses
  // them. Only a save to a profile that is on is worth a toast: it changes
  // what Bridge will do. The toggle saves on its own, so it reads through a
  // ref here rather than re-running this effect.
  const autoApplyRef = useRef(autoApply);
  autoApplyRef.current = autoApply;
  const pendingSave = useRef<(() => void) | null>(null);
  useEffect(() => {
    pendingSave.current = null;
    if (!loaded || draft === null || currentKey === savedKey.current) return;
    const save = (): void => {
      pendingSave.current = null;
      const on = autoApplyRef.current;
      void persist({ settings: current, targetIndex, autoApply: on }, on ? "updated" : null);
    };
    pendingSave.current = save;
    const timer = setTimeout(save, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, loaded]);
  // Leaving the page mid-debounce still saves the last edit.
  useEffect(() => () => pendingSave.current?.(), []);

  function selectTarget(index: number): void {
    const device = devices[index];
    if (!device) return;
    setTargetIndex(index);
    // The cards can only edit the connected mouse; switching ends this draft
    // (the effect above starts a new one once the new mouse has been read).
    if (!device.selected) {
      control.endGameProfileDraft();
      void control.selectAuthorizedDevice(device.index);
    }
    void persist({ settings: current, targetIndex: index, autoApply }, autoApply ? "updated" : null);
  }

  function toggleAutoApply(): void {
    const next = !autoApply;
    setAutoApply(next);
    void persist({ settings: current, targetIndex, autoApply: next }, next ? "enabled" : "disabled");
  }

  function clearProfile(): void {
    const wasEnabled = autoApply;
    setAutoApply(false);
    control.resetGameProfileDraft({});
    lastDraft.current = {};
    void persist({ settings: {}, targetIndex, autoApply: false }, wasEnabled ? "disabled" : null);
  }

  const artwork = catalogEntry ? gameArtwork(catalogEntry) : null;
  const tabs = editing
    ? availableWorkspaceTabs(true, cardAvailability(snapshot)).filter((entry) => GAME_PROFILE_TABS.includes(entry))
    : [];
  const activeTab = tabs.includes(tab) ? tab : tabs[0] ?? "performance";

  return (
    <div className="game-profile-page">
      <button type="button" className="game-profile-back" onClick={onBack}>
        <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />
        {t(locale, "nav.games")}
      </button>

      <div className="game-profile-layout">
        <div className="game-profile-side">
          <div className="game-profile-art" style={artwork ? undefined : { background: "linear-gradient(160deg, var(--ui-accent-soft), var(--surface-panel))" }}>
            {artwork ? (
              <img src={artwork} alt={game.name} loading="lazy" draggable={false} />
            ) : (
              <Gamepad2 size={40} strokeWidth={1.5} aria-hidden="true" />
            )}
          </div>
        </div>

        <div className="game-profile-settings">
          <div className="game-profile-name-card">
            <span className="game-profile-name-label">PROFILE</span>
            <span className="game-profile-name">{game.name}</span>
            <span className="game-profile-changed">
              {changedCount === 0
                ? t(locale, "games.noChanges")
                : tp(locale, "games.changedCount", { n: changedCount })}
            </span>
            <button
              type="button"
              className="game-profile-clear"
              disabled={saving || (!autoApply && changedCount === 0)}
              onClick={clearProfile}
            >
              Clear
            </button>
          </div>

          <section className="game-profile-section">
            <span className="game-profile-section-label">TARGET DEVICE</span>
            {devices.length === 0 ? (
              <p className="game-profile-empty">No devices detected yet.</p>
            ) : (
              <ul className="game-profile-devices">
                {devices.map((device, index) => (
                  <li key={device.index} className="game-profile-device-row">
                    <span className="game-profile-device-icon" aria-hidden="true">?</span>
                    <span className="game-profile-device-text">
                      <span className="game-profile-device-name">{device.name}</span>
                      <span className="game-profile-device-brand">{deviceBrand(device)}</span>
                    </span>
                    <button
                      type="button"
                      className={`game-profile-select${targetIndex === index ? " is-selected" : ""}`}
                      onClick={() => selectTarget(index)}
                    >
                      {targetIndex === index ? "Selected" : "Select"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="game-profile-section game-profile-auto-apply">
            <div className="game-profile-auto-apply-text">
              <span className="game-profile-auto-apply-title">Apply automatically</span>
              <span className="game-profile-auto-apply-body">
                Push this profile to your mouse the moment {game.name} is detected running.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoApply}
              className={`game-profile-toggle${autoApply ? " is-on" : ""}`}
              disabled={saving || targetIndex === null}
              onClick={toggleAutoApply}
            >
              <span className="game-profile-toggle-thumb" />
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
            <nav className="device-tabs-bar game-profile-tabs" role="tablist" aria-label={t(locale, "games.settings")}>
              {tabs.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="tab"
                  className={`device-tab-pill${activeTab === entry ? " active" : ""}`}
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
