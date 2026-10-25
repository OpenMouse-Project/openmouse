import { displayText } from "../../i18n/index";
import { matchesCommandQuery } from "./command-search";
import { useUiLocale } from "../../shared/ui-locale";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { bridgeDefaultProfile, saveBridgeDefaultProfile, type BridgeProfile } from "../bridge/bridge";
import { isBridgeHidActive, subscribeBridgeHidActive } from "../bridge/bridge-hid";
import * as control from "../../device/controller";
import type { LogitechButtonAction } from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import type { ControlSnapshot } from "../../device/types";
import { buttonMapLayoutFor, type ButtonSpot } from "./logitech-button-map";
import { COMMAND_SECTIONS, bindingFromKeyEvent, conflictHints, describeAssignment, isAssigned, shortcutText, type CommandEntry } from "./logitech-commands";
import { SetupCodeDialog } from "./SetupCodeDialog";

type Layer = "primary" | "g-shift";


/** What each unlocked button does out of the box; G-Shift starts with nothing on them. */
const DEFAULT_ACTION: Record<number, CommandEntry["label"]> = { 2: "Middle click", 3: "Back", 4: "Forward" };

const HOST_BUTTONS = [3, 4];
const hostBit = (button: number): number => 1 << button;
type HostAction = NonNullable<MouseStatus["hostButtons"]>[number];

function hostCapable(snapshot: ControlSnapshot): boolean {
  const status = snapshot.status;
  return snapshot.traits.logitech
    && status !== null
    && control.hostBunnyHopSupported(status)
    && buttonMapLayoutFor(status.name) !== null;
}

/** Editing a game profile on a mouse that can hand its side buttons to Bridge. */
function inHostMode(snapshot: ControlSnapshot): boolean {
  return snapshot.gameProfileDraft && hostCapable(snapshot);
}

function onHostPageWithBridge(snapshot: ControlSnapshot, bridgeActive: boolean): boolean {
  return bridgeActive && !snapshot.gameProfileDraft && snapshot.editedProfile === "host" && hostCapable(snapshot);
}

function useBridgeRunning(): boolean {
  const [active, setActive] = useState(isBridgeHidActive());
  useEffect(() => subscribeBridgeHidActive(setActive), []);
  return active;
}

/** Keyboard shortcuts and the media keys Bridge can press; macros and mouse commands are not offered. */
function hostSupported(command: CommandEntry): boolean {
  return command.target.kind === "keyboard" || command.target.kind === "consumer";
}

function hostActionFor(command: CommandEntry): HostAction | null {
  const target = command.target;
  if (target.kind === "keyboard") return { key: target.key, modifiers: target.modifiers };
  if (target.kind === "consumer") return { consumer: target.usage };
  return null;
}

function hostText(action: HostAction | undefined, button: number): string {
  if (!action) return DEFAULT_ACTION[button] ?? "-";
  if ("key" in action) return shortcutText(action.key, action.modifiers);
  const media = COMMAND_SECTIONS.flatMap((section) => section.entries)
    .find((entry) => entry.target.kind === "consumer" && entry.target.usage === action.consumer);
  return media?.label ?? `Media 0x${action.consumer.toString(16)}`;
}

function isHostAssigned(command: CommandEntry, action: HostAction | undefined): boolean {
  const wanted = hostActionFor(command);
  if (!wanted || !action) return false;
  return "key" in wanted && "key" in action
    ? wanted.key === action.key && wanted.modifiers === action.modifiers
    : "consumer" in wanted && "consumer" in action && wanted.consumer === action.consumer;
}

function hasButtonMap(snapshot: ControlSnapshot): boolean {
  const status = snapshot.status;
  return snapshot.traits.logitech
    && status !== null
    && buttonMapLayoutFor(status.name) !== null
    && snapshot.profile.entry !== null
    && snapshot.profileFormat?.writable === true;
}

// While a flash runs, the profile is briefly unreadable. The card keeps showing the
// last good state for that mouse instead of vanishing and coming back.
let lastGood: ControlSnapshot | null = null;

function stableSnapshot(snapshot: ControlSnapshot): ControlSnapshot | null {
  if (hasButtonMap(snapshot)) {
    lastGood = snapshot;
    return snapshot;
  }
  return snapshot.settingInProgress && lastGood?.status?.name === snapshot.status?.name ? lastGood : null;
}

/**
 * On the Host profile the mouse runs from software and has no stored profile
 * open, so there is nothing to assign yet. The card then stays, with a way back.
 */
function onHostProfile(snapshot: ControlSnapshot): boolean {
  const status = snapshot.status;
  return snapshot.traits.logitech
    && status !== null
    && buttonMapLayoutFor(status.name) !== null
    && snapshot.editedProfile === "host"
    && (snapshot.onboardProfiles?.length ?? 0) > 0;
}

export function buttonMapAvailable(snapshot: ControlSnapshot): boolean {
  return stableSnapshot(snapshot) !== null || onHostProfile(snapshot) || inHostMode(snapshot);
}

function HostProfileNotice({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const __uiLocale = useUiLocale();
  const profiles = snapshot.onboardProfiles ?? [];
  const target = profiles.find((profile) => profile.isCurrent) ?? profiles[0];
  return (
    <div id="logitech-button-map">
      <article className="setting-card superstrike-tuning-card button-map-card button-map-host">
        <div className="setting-heading superstrike-tuning-heading"><div><h2>{displayText(__uiLocale, "Button assignments")}</h2></div></div>
        <p className="setting-description"> {displayText(__uiLocale, "You are on the Host profile, which runs from software. Button assignments are stored in the mouse's onboard profiles, so open one to edit them. Bunny hop is set on this profile.")} </p>
        {target ? (
          <button type="button" className="connect-button" onClick={() => control.openOnboardProfile(target.sector)}> {displayText(__uiLocale, "Open")} {control.describeProfileEntry(target).name}
          </button>
        ) : null}
      </article>
    </div>
  );
}

export function ButtonMap({ snapshot: live }: { snapshot: ControlSnapshot }): ReactNode {
  const __uiLocale = useUiLocale();
  const bridgeActive = useBridgeRunning();
  const onHostPage = onHostPageWithBridge(live, bridgeActive);
  const host = inHostMode(live) || onHostPage;
  const snapshot = host ? live : stableSnapshot(live) ?? live;
  const [saved, setSaved] = useState<NonNullable<MouseStatus["hostButtons"]>>({});
  const savedProfile = useRef<BridgeProfile | null>(null);
  // Until Bridge has answered, an edit would save a profile without the settings it already holds.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!onHostPage) return;
    setLoaded(false);
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Editing stays off until Bridge answers, so a failed read is tried again rather than left for good.
    const load = (): void => {
      void bridgeDefaultProfile(controller.signal).then((profile) => {
        savedProfile.current = profile;
        setSaved(profile?.settings.snapshot?.hostButtons ?? {});
        setLoaded(true);
      }).catch(() => {
        if (!controller.signal.aborted) retry = setTimeout(load, 5000);
      });
    };
    load();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [onHostPage, live.status?.name]);
  const hostReady = !onHostPage || loaded;
  const hostButtons = live.gameProfileDraft ? live.status?.hostButtons ?? {} : saved;
  // Several buttons change in one update: each would otherwise start from the same saved copy.
  const updateHostButtons = (changes: Array<[number, HostAction | null]>): void => {
    if (live.gameProfileDraft) {
      for (const [bit, action] of changes) control.applyHostButton(bit, action);
      return;
    }
    const name = live.status?.name;
    if (!name || !loaded) return;
    const next = { ...saved };
    for (const [bit, action] of changes) {
      if (action) next[bit] = action;
      else delete next[bit];
    }
    const previous = { buttons: saved, profile: savedProfile.current };
    setSaved(next);
    const base = savedProfile.current;
    const profile: BridgeProfile = {
      application: base?.application ?? { name: "Default", executable: "", path: "" },
      device: { id: `Logitech:${name}`, name },
      enabled: base?.enabled ?? true,
      settings: {
        dpi: base?.settings.dpi ?? null,
        pollingRateHz: base?.settings.pollingRateHz ?? null,
        snapshot: { ...(base?.settings.snapshot ?? {}), hostButtons: next },
      },
    };
    savedProfile.current = profile;
    void saveBridgeDefaultProfile(profile).catch(() => {
      // It never reached Bridge, so it must not read as saved.
      setSaved(previous.buttons);
      savedProfile.current = previous.profile;
      control.pushToast("error", displayText(__uiLocale, "Could not save the side buttons. Is Bridge running?"));
    });
  };
  const setHostButton = (bit: number, action: HostAction | null): void => updateHostButtons([[bit, action]]);
  const [layer, setLayer] = useState<Layer>("primary");
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Record<string, string>>({});
  const [recording, setRecording] = useState(false);
  const [sharing, setSharing] = useState(false);

  const setHostButtonRef = useRef(setHostButton);
  setHostButtonRef.current = setHostButton;
  const recordable = selected !== null && !live.settingInProgress && hostReady
    && (host ? HOST_BUTTONS.includes(selected) : !(selected <= 1 && layer === "primary"));
  useEffect(() => {
    if (!recording || !recordable || selected === null) return;
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      if (event.code === "Escape" && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
        setRecording(false);
        return;
      }
      const binding = bindingFromKeyEvent(event);
      if (!binding || binding.kind !== "keyboard") return;
      if (host) {
        setHostButtonRef.current(hostBit(selected), { key: binding.key, modifiers: binding.modifiers });
      } else {
        void control.applyLogitechButtonAssignment(layer, selected, binding);
        setPending((previous) => ({ ...previous, [`${layer}-${selected}`]: shortcutText(binding.key, binding.modifiers) }));
      }
      setRecording(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, recordable, selected, layer, host]);

  const status = snapshot.status;
  const entry = snapshot.profile.entry;
  const layout = status ? buttonMapLayoutFor(status.name) : null;
  if (!status || !(entry || host) || !layout) return onHostProfile(live) ? <HostProfileNotice snapshot={live} /> : null;

  const assignments = entry ? (layer === "primary" ? entry.buttonAssignments : entry.gShiftAssignments) : [];
  const assignmentFor = (button: number) => assignments.find((assignment) => assignment.button === button);
  const isLocked = (spot: ButtonSpot): boolean => (host ? !HOST_BUTTONS.includes(spot.button) : spot.locked && layer === "primary");
  const textFor = (spot: ButtonSpot): string => {
    if (host) return hostText(hostButtons[hostBit(spot.button)], spot.button);
    const staged = snapshot.stagedProfileButtonAssignments.find((item) => item.layer === layer && item.button === spot.button);
    if (staged) return pending[`${layer}-${spot.button}`] ?? "Pending";
    const assignment = assignmentFor(spot.button);
    return assignment ? describeAssignment(assignment.action, assignment.raw) : "-";
  };

  const selectedSpot = layout.spots.find((spot) => spot.button === selected) ?? null;
  const canAssign = selectedSpot !== null && !isLocked(selectedSpot) && !live.settingInProgress && hostReady;
  const current = selected !== null ? assignmentFor(selected) : undefined;
  const hostCurrent = host && selected !== null ? hostButtons[hostBit(selected)] : undefined;

  const assign = (command: CommandEntry): void => {
    if (!canAssign || selected === null) return;
    if (host) {
      const action = hostActionFor(command);
      if (action) setHostButton(hostBit(selected), action);
      return;
    }
    const binding = command.target.kind === "action" ? command.target.action : command.target;
    void control.applyLogitechButtonAssignment(layer, selected, binding);
    setPending((previous) => ({ ...previous, [`${layer}-${selected}`]: command.label }));
  };

  const defaultFor = (button: number): LogitechButtonAction => (layer === "primary" ? DEFAULT_ACTION[button] : "Disabled") as LogitechButtonAction;
  const reset = async (buttons: number[]): Promise<void> => {
    if (host) {
      updateHostButtons(buttons.map((button): [number, null] => [hostBit(button), null]));
      return;
    }
    for (const button of buttons) {
      await control.applyLogitechButtonAssignment(layer, button, defaultFor(button));
      setPending((previous) => ({ ...previous, [`${layer}-${button}`]: defaultFor(button) }));
    }
  };
  const unlocked = layout.spots.filter((spot) => !isLocked(spot)).map((spot) => spot.button);

  const hints = layer === "primary" ? conflictHints(layout.spots.map((spot) => ({ label: spot.label, text: textFor(spot) }))) : [];

  const sections = COMMAND_SECTIONS
    .map((section) => ({
      ...section,
      entries: section.entries.filter((command) => (!host || hostSupported(command))
        && matchesCommandQuery(__uiLocale, query, command.label, command.hint)),
    }))
    .filter((section) => section.entries.length > 0);

  const help = selectedSpot === null
    ? "Pick a button on the mouse, then a command."
    : isLocked(selectedSpot)
      ? host
        ? `Only the two side buttons can be changed ${onHostPage ? "on the Host profile" : "in a game profile"}.`
        : "Primary and secondary click are locked so you cannot lose control of the mouse."
      : `Pick a command for ${selectedSpot.label}.`;

  return (
    <div id="logitech-button-map">
      <article className="setting-card superstrike-tuning-card button-map-card">
        <div className="setting-heading superstrike-tuning-heading button-map-heading">
          <div><h2>{displayText(__uiLocale, "Button assignments")}</h2></div>
          {host ? null : <button type="button" className="om-btn button-map-share" onClick={() => setSharing(true)}>{displayText(__uiLocale, "Share setup")}</button>}
        </div>
        {host ? null : <SetupCodeDialog open={sharing} snapshot={snapshot} onClose={() => setSharing(false)} />}
        <div className="button-map-body">
          <aside className="button-map-commands" aria-label={displayText(__uiLocale, "Commands")}>
            <input
              type="search"
              className="button-map-search"
              placeholder={displayText(__uiLocale, "Search commands")}
              aria-label={displayText(__uiLocale, "Search commands")}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <button
              type="button"
              className="button-map-record"
              aria-pressed={recording}
              disabled={!canAssign}
              onClick={() => setRecording((on) => !on)}
            >
              {displayText(__uiLocale, recording ? "Press a key or shortcut... (Esc cancels)" : "Record a key or shortcut")}
            </button>
            <div className="button-map-reset">
              <button type="button" disabled={!canAssign} onClick={() => void reset([selected as number])}>{displayText(__uiLocale, "Reset button")}</button>
              <button type="button" disabled={live.settingInProgress} onClick={() => void reset(unlocked)}>{displayText(__uiLocale, "Reset all")}</button>
            </div>
            <small className="button-map-help" role="status">{displayText(__uiLocale, help)}</small>
            {onHostPage ? (
              <small className="button-map-help">
                {displayText(__uiLocale, "Saved in Bridge and used whenever no game's profile is active, while the mouse is on the Host profile. A game's profile overrides it while that game runs.")}
              </small>
            ) : null}
            <div className="button-map-list">
            {sections.map((section) => (
              <section key={section.id} className="button-map-section">
                <h3>{displayText(__uiLocale, section.title)}</h3>
                {section.entries.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    className="button-map-command"
                    aria-pressed={host ? isHostAssigned(command, hostCurrent) : current ? isAssigned(command, current.action, current.raw) : false}
                    disabled={!canAssign}
                    onClick={() => assign(command)}
                  >
                    <span>{displayText(__uiLocale, command.label)}</span>
                    {command.hint ? <small>{displayText(__uiLocale, command.hint)}</small> : null}
                  </button>
                ))}
              </section>
            ))}
            {sections.length === 0 ? <small className="button-map-help">{displayText(__uiLocale, "No command matches.")}</small> : null}
            </div>
          </aside>
          <div className="button-map-stage">
            <div className="button-map-canvas" style={{ "--aspect": layout.aspect } as CSSProperties}>
              {snapshot.deviceArtwork ? <img className="button-map-art" src={snapshot.deviceArtwork} alt={status.name} /> : null}
              {layout.spots.map((spot) => (
                <div
                  key={spot.button}
                  className={`button-map-spot is-${spot.side}${selected === spot.button ? " is-selected" : ""}${isLocked(spot) ? " is-locked" : ""}`}
                  style={{ "--sx": spot.x, "--sy": spot.y } as CSSProperties}
                >
                  <span className="button-map-line" aria-hidden="true" />
                  <button
                    type="button"
                    className="button-map-dot"
                    aria-label={displayText(__uiLocale, `Select ${spot.label}`)}
                    onClick={() => setSelected(spot.button)}
                  >{spot.button + 1}</button>
                  <button type="button" className="button-map-label" data-button-number={spot.button + 1} onClick={() => setSelected(spot.button)}>
                    <strong>{displayText(__uiLocale, spot.label)}</strong>
                    <span>{displayText(__uiLocale, textFor(spot))}</span>
                  </button>
                </div>
              ))}
            </div>
            {hints.length ? <ul className="button-map-hints" role="status">{hints.map((hint) => <li key={hint}>{displayText(__uiLocale, hint)}</li>)}</ul> : null}
            {host ? null : (
              <div className="button-map-layers" role="tablist" aria-label={displayText(__uiLocale, "Button layer")}>
                <button type="button" role="tab" aria-selected={layer === "primary"} onClick={() => setLayer("primary")}>{displayText(__uiLocale, "Standard")}</button>
                <button type="button" role="tab" aria-selected={layer === "g-shift"} onClick={() => setLayer("g-shift")}>{"G-Shift"}</button>
              </div>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}
