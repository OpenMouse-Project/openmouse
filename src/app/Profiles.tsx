import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { capabilitiesForFormat } from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import { LOGITECH_BUTTON_ACTIONS, type LogitechButtonAction } from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import { IconActivate, IconDisabled, IconEnabled, IconRefresh, IconRename, IconRunning, IconTrash } from "./icons";

const ROW_STYLE = (open: boolean, enabled = true): CSSProperties => ({
  display: "flex",
  gap: ".55rem",
  alignItems: "center",
  padding: ".45rem .6rem",
  border: `1px solid ${open ? "#4a4a52" : "#26262a"}`,
  borderRadius: "7px",
  background: open ? "#1b1b1f" : "#141416",
  opacity: enabled ? 1 : 0.55,
});

const OPEN_BUTTON_STYLE = (locked: boolean): CSSProperties => ({
  display: "flex",
  gap: ".55rem",
  alignItems: "center",
  flex: 1,
  minWidth: 0,
  textAlign: "left",
  background: "none",
  border: 0,
  padding: 0,
  cursor: locked ? "not-allowed" : "pointer",
});

const ICON_BUTTON_STYLE = (disabled: boolean, active = false): CSSProperties => ({
  display: "flex",
  padding: ".3rem",
  border: `1px solid ${active ? "#4a4a52" : "#3a3a3f"}`,
  borderRadius: "5px",
  background: "#19191c",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.4 : 1,
});

export function Profiles({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const inner = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const profiles = snapshot.onboardProfiles;

  useEffect(() => {
    if (!body.current || !inner.current) return;
    body.current.style.maxHeight = snapshot.profilesExpanded ? `${inner.current.scrollHeight}px` : "0px";
  });

  const summary = snapshot.profile.summary;
  const hostOpened = snapshot.editedProfile === "host";
  const hostRunning = snapshot.deviceMode === "Host";
  const format = snapshot.profileFormat;
  const layoutVerified = format?.verified === true;
  const contentsWritable = format?.writable === true;
  const nameLimit = format ? capabilitiesForFormat(format.id).maxNameLength : null;
  const hostTags = [hostRunning ? "active" : null, hostOpened ? "editing" : null].filter(Boolean).join(" · ");
  const openedProfile = typeof snapshot.editedProfile === "number"
    ? profiles?.find((profile) => profile.sector === snapshot.editedProfile) ?? null
    : null;

  return (
    <section
      id="logitech-onboard"
      className={`profile-disclosure device-data${snapshot.profilesExpanded ? " is-open" : ""}`}
      role="tabpanel"
      aria-labelledby="workspace-tab-profiles"
    >
      <div className="profile-summary">
        <button
          id="profile-disclosure-toggle"
          className="profile-summary-main"
          type="button"
          aria-expanded={snapshot.profilesExpanded}
          aria-controls="profile-disclosure-body"
          onClick={control.toggleProfilesExpanded}
        >
          <span className="profile-summary-text">
            <span className="profile-summary-label">EDITING</span>
            <strong id="profile-summary-name">{summary.name}</strong>
            <small id="profile-summary-detail">{summary.detail}</small>
          </span>
          <i className="profile-summary-chevron" aria-hidden="true" />
        </button>
        <button
          id="onboard-refresh"
          className="icon-button"
          type="button"
          aria-label="Reload profiles"
          title="Reload profiles"
          onClick={() => void control.reloadOnboardProfiles()}
        >
          <IconRefresh />
        </button>
        {snapshot.resetProfilesAvailable ? (
          <button
            id="reset-logitech-profiles"
            className="icon-button profile-delete-button"
            type="button"
            aria-label="Delete and reset every onboard profile"
            title="Permanently restore every onboard profile to Logitech defaults"
            disabled={snapshot.settingInProgress}
            onClick={() => void control.resetLogitechProfiles()}
          >
            <IconTrash />
          </button>
        ) : null}
      </div>

      <div id="profile-disclosure-body" className="profile-disclosure-body" ref={body}>
        <div className="profile-disclosure-inner" ref={inner}>
          <div id="onboard-profile-list">
            {profiles === null ? null : (
              <>
                <div style={ROW_STYLE(hostOpened)}>
                  <button
                    type="button"
                    title="Open host settings"
                    style={OPEN_BUTTON_STYLE(false)}
                    onClick={() => control.openOnboardProfile("host")}
                  >
                    <span className={`device-dot${hostRunning ? "" : " is-idle"}`} />
                    <span className="profile-row-text" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <strong style={{ fontSize: ".72rem", color: "#e6e6ea" }}>
                        Host — live{hostTags ? ` · ${hostTags}` : ""}
                      </strong>
                      <small style={{ color: "#77777c", fontSize: ".62rem" }}>
                        Settings applied by software, not stored on the mouse. Lost on power-cycle.
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={hostRunning}
                    title={hostRunning ? "The mouse is already in host mode" : "Switch the mouse to host mode"}
                    aria-label="Switch to host mode"
                    aria-pressed={hostRunning}
                    style={ICON_BUTTON_STYLE(hostRunning, hostRunning)}
                    onClick={() => void control.applyOnboardMode("Host")}
                  >
                    {hostRunning ? <IconRunning /> : <IconActivate />}
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: ".5rem", margin: ".15rem 0 .05rem" }}>
                  <span style={{ height: 1, flex: 1, background: "#26262a" }} />
                  <small style={{ color: "#5c5c62", fontSize: ".58rem", letterSpacing: ".04em" }}>
                    STORED ON THE MOUSE
                  </small>
                  <span style={{ height: 1, flex: 1, background: "#26262a" }} />
                </div>
                <small style={{ display: "block", margin: "0 0 .2rem", color: "#5c5c62", fontSize: ".58rem" }}>
                  Click a profile to edit it. Use the circle to switch the mouse to it.
                </small>

                {profiles.map((profile) => {
                  const dpi = profile.dpiStages.length > 0
                    ? profile.dpiStages
                      .map((stage) => (stage.x === stage.y ? `${stage.x}` : `${stage.x}/${stage.y}`))
                      .join(" · ")
                    : "no DPI stages";
                  const rate = profile.reportRateWireless
                    ? `${profile.reportRateWireless.toLocaleString()} Hz`
                    : "—";
                  const detail = [
                    `${dpi} DPI`,
                    rate,
                    profile.enabled ? "enabled" : "disabled",
                    profile.crcValid ? null : "checksum mismatch",
                  ].filter(Boolean).join(" · ");
                  const locked = !layoutVerified;
                  const opened = snapshot.editedProfile === profile.sector;
                  const nameable = nameLimit !== null;
                  const running = profile.isCurrent && !hostRunning;
                  const tags = [running ? "active" : null, opened ? "editing" : null].filter(Boolean).join(" · ");
                  const renameDisabled = locked || !nameable || !contentsWritable;
                  const activateDisabled = locked || running || !profile.enabled;

                  return (
                    <div key={profile.sector} style={ROW_STYLE(opened, profile.enabled)}>
                      <button
                        type="button"
                        disabled={locked}
                        title={locked
                          ? "This profile layout has not been verified on hardware"
                          : "Open this profile to edit it"}
                        style={OPEN_BUTTON_STYLE(locked)}
                        onClick={() => control.openOnboardProfile(profile.sector)}
                      >
                        <span className={`device-dot${running ? "" : " is-idle"}`} />
                        <span className="profile-row-text" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                          <strong style={{ fontSize: ".72rem", color: "#e6e6ea" }}>
                            {(opened && snapshot.stagedProfileName) || profile.name || `Profile ${profile.sector}`}
                            {tags ? ` · ${tags}` : ""}
                          </strong>
                          <small style={{ color: "#77777c", fontSize: ".62rem" }}>{detail}</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={renameDisabled}
                        title={!nameable
                          ? "This profile format has no name field"
                          : !contentsWritable
                            ? "Profile-content writes have not been verified on hardware"
                            : "Rename this profile"}
                        aria-label={`Rename profile ${profile.sector}`}
                        style={ICON_BUTTON_STYLE(renameDisabled)}
                        onClick={() => control.renameOnboardProfile(profile.sector)}
                      >
                        <IconRename />
                      </button>
                      <button
                        type="button"
                        disabled={activateDisabled}
                        title={running
                          ? "The mouse is running this profile"
                          : !profile.enabled
                            ? "Enable this profile before switching to it"
                            : "Switch the mouse to this profile"}
                        aria-label={`Switch to profile ${profile.sector}`}
                        aria-pressed={running}
                        style={ICON_BUTTON_STYLE(locked || !profile.enabled, running)}
                        onClick={() => void control.selectOnboardProfile(profile.sector)}
                      >
                        {running ? <IconRunning /> : <IconActivate />}
                      </button>
                      <button
                        type="button"
                        disabled={locked}
                        title={locked
                          ? "This profile layout has not been verified on hardware"
                          : profile.enabled ? "Disable this profile" : "Enable this profile"}
                        aria-label={`${profile.enabled ? "Disable" : "Enable"} profile ${profile.sector}`}
                        style={ICON_BUTTON_STYLE(locked)}
                        onClick={() => void control.toggleOnboardProfileEnabled(profile.sector, !profile.enabled)}
                      >
                        {profile.enabled ? <IconEnabled /> : <IconDisabled />}
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
          {openedProfile && contentsWritable ? (
            <div className="profile-button-editor">
              <div className="setting-heading"><div><p>BUTTONS</p><h2>Onboard assignments</h2></div></div>
              {(["primary", "g-shift"] as const).map((layer) => {
                const assignments = layer === "primary" ? openedProfile.buttonAssignments : openedProfile.gShiftAssignments;
                return (
                  <div key={layer} style={{ marginTop: ".65rem" }}>
                    <strong style={{ fontSize: ".68rem" }}>{layer === "primary" ? "Normal layer" : "G-Shift layer"}</strong>
                    <div style={{ display: "grid", gap: ".35rem", marginTop: ".35rem" }}>
                      {assignments.map((assignment) => (
                        <label key={`${layer}-${assignment.button}`} style={{ display: "grid", gridTemplateColumns: "6rem 1fr", alignItems: "center", gap: ".5rem", fontSize: ".65rem" }}>
                          Button {assignment.button + 1}
                          <select
                            value={assignment.action}
                            disabled={snapshot.settingInProgress}
                            title={assignment.action === "Custom" ? `Unknown mapping: ${assignment.raw.map((byte) => byte.toString(16).padStart(2, "0")).join(" ")}` : undefined}
                            onChange={(event) => void control.applyLogitechButtonAssignment(layer, assignment.button, event.currentTarget.value as LogitechButtonAction)}
                          >
                            {assignment.action === "Custom" ? <option value="Custom">Custom (preserved)</option> : null}
                            {LOGITECH_BUTTON_ACTIONS.map((action) => <option key={action} value={action}>{action}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
              <small className="setting-note">Assignments are stored in this profile. Custom macros and keyboard/consumer actions are preserved but are not overwritten until their full editor is available.</small>
            </div>
          ) : null}
          <small id="onboard-status">{snapshot.onboardStatus}</small>
        </div>
      </div>
    </section>
  );
}
