import { displayText } from "../../i18n/index";
import { matchesCommandQuery } from "./command-search";
import { useUiLocale } from "../../shared/ui-locale";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import * as control from "../../device/controller";
import type { LogitechButtonAction } from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import type { ControlSnapshot } from "../../device/types";
import { buttonMapLayoutFor, type ButtonSpot } from "./logitech-button-map";
import { COMMAND_SECTIONS, bindingFromKeyEvent, conflictHints, describeAssignment, isAssigned, shortcutText, type CommandEntry } from "./logitech-commands";
import { connectionText } from "../../i18n/index";
import { SetupCodeDialog } from "./SetupCodeDialog";
import { BatteryIcon } from "../../shared/ui";

type Layer = "primary" | "g-shift";


/** What each unlocked button does out of the box; G-Shift starts with nothing on them. */
const DEFAULT_ACTION: Record<number, CommandEntry["label"]> = { 2: "Middle click", 3: "Back", 4: "Forward" };

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
  return stableSnapshot(snapshot) !== null || onHostProfile(snapshot);
}

function HostProfileNotice({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const __uiLocale = useUiLocale();
  const profiles = snapshot.onboardProfiles ?? [];
  const target = profiles.find((profile) => profile.isCurrent) ?? profiles[0];
  return (
    <div id="logitech-button-map">
      <article className="setting-card superstrike-tuning-card button-map-card button-map-host">
        <div className="setting-heading superstrike-tuning-heading"><div><h2>{displayText(__uiLocale, "Button assignments")}</h2></div></div>
        <p className="setting-description"> {displayText(__uiLocale, "You are on the Host profile, which runs from software. Button assignments and Bunny Hop are stored in the mouse's onboard profiles, so open one to edit them.")} </p>
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
  const snapshot = stableSnapshot(live) ?? live;
  const [layer, setLayer] = useState<Layer>("primary");
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Record<string, string>>({});
  const [recording, setRecording] = useState(false);
  const [sharing, setSharing] = useState(false);

  const recordable = selected !== null && !(selected <= 1 && layer === "primary") && !live.settingInProgress;
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
      void control.applyLogitechButtonAssignment(layer, selected, binding);
      setPending((previous) => ({ ...previous, [`${layer}-${selected}`]: shortcutText(binding.key, binding.modifiers) }));
      setRecording(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, recordable, selected, layer]);

  const status = snapshot.status;
  const entry = snapshot.profile.entry;
  const estimate = status ? control.batteryEstimateParts(status, snapshot.preferences.locale) : null;
  const layout = status ? buttonMapLayoutFor(status.name) : null;
  if (!status || !entry || !layout) return onHostProfile(live) ? <HostProfileNotice snapshot={live} /> : null;

  const assignments = layer === "primary" ? entry.buttonAssignments : entry.gShiftAssignments;
  const assignmentFor = (button: number) => assignments.find((assignment) => assignment.button === button);
  const isLocked = (spot: ButtonSpot): boolean => spot.locked && layer === "primary";
  const textFor = (spot: ButtonSpot): string => {
    const staged = snapshot.stagedProfileButtonAssignments.find((item) => item.layer === layer && item.button === spot.button);
    if (staged) return pending[`${layer}-${spot.button}`] ?? "Pending";
    const assignment = assignmentFor(spot.button);
    return assignment ? describeAssignment(assignment.action, assignment.raw) : "-";
  };

  const selectedSpot = layout.spots.find((spot) => spot.button === selected) ?? null;
  const canAssign = selectedSpot !== null && !isLocked(selectedSpot) && !live.settingInProgress;
  const current = selected !== null ? assignmentFor(selected) : undefined;

  const assign = (command: CommandEntry): void => {
    if (!canAssign || selected === null) return;
    const binding = command.target.kind === "action" ? command.target.action : command.target;
    void control.applyLogitechButtonAssignment(layer, selected, binding);
    setPending((previous) => ({ ...previous, [`${layer}-${selected}`]: command.label }));
  };

  const defaultFor = (button: number): LogitechButtonAction => (layer === "primary" ? DEFAULT_ACTION[button] : "Disabled") as LogitechButtonAction;
  const reset = async (buttons: number[]): Promise<void> => {
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
      entries: section.entries.filter((command) => matchesCommandQuery(__uiLocale, query, command.label, command.hint)),
    }))
    .filter((section) => section.entries.length > 0);

  const help = selectedSpot === null
    ? "Pick a button on the mouse, then a command."
    : isLocked(selectedSpot)
      ? "Primary and secondary click are locked so you cannot lose control of the mouse."
      : `Pick a command for ${selectedSpot.label}.`;

  return (
    <div id="logitech-button-map">
      <article className="setting-card superstrike-tuning-card button-map-card">
        <div className="setting-heading superstrike-tuning-heading button-map-heading">
          <div><h2>{displayText(__uiLocale, "Button assignments")}</h2></div>
          <div className="button-map-status" aria-label={displayText(__uiLocale, "Device status")}>
            <strong>{status.name}</strong>
            {status.connectionType ? <span>{displayText(__uiLocale, connectionText(snapshot.preferences.locale, status.connectionType))}</span> : null}
            {status.batteryPercent !== null ? (
              <span title={displayText(__uiLocale, estimate ? `${estimate.time} ${estimate.label}` : undefined)}>
                <BatteryIcon percent={status.batteryPercent} state={status.batteryState} />{status.batteryPercent}%
                {displayText(__uiLocale, estimate ? ` · ${estimate.time}` : "")}
              </span>
            ) : null}
          </div>
          <button type="button" className="om-btn button-map-share" onClick={() => setSharing(true)}>{displayText(__uiLocale, "Share setup")}</button>
        </div>
        <SetupCodeDialog open={sharing} snapshot={snapshot} onClose={() => setSharing(false)} />
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
            <div className="button-map-list">
            {sections.map((section) => (
              <section key={section.id} className="button-map-section">
                <h3>{displayText(__uiLocale, section.title)}</h3>
                {section.entries.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    className="button-map-command"
                    aria-pressed={current ? isAssigned(command, current.action, current.raw) : false}
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
            <div className="button-map-layers" role="tablist" aria-label={displayText(__uiLocale, "Button layer")}>
              <button type="button" role="tab" aria-selected={layer === "primary"} onClick={() => setLayer("primary")}>{displayText(__uiLocale, "Standard")}</button>
              <button type="button" role="tab" aria-selected={layer === "g-shift"} onClick={() => setLayer("g-shift")}>{"G-Shift"}</button>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
