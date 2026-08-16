import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  KEYCHRON_NAPE_BUTTON_ACTIONS,
  keychronLayerLabel,
  type KeychronNapeButtonAction,
} from "@openmouse/protocol/keychron";
import * as control from "../device/controller";
import type { ControlSnapshot, NapeAssignmentControl, StagedNapeAssignment } from "../device/types";
import { IconActivate, IconRefresh, IconRunning } from "./icons";

const ROW_STYLE = (open: boolean): CSSProperties => ({
  display: "flex",
  gap: ".55rem",
  alignItems: "center",
  padding: ".45rem .6rem",
  border: `1px solid ${open ? "#4a4a52" : "#26262a"}`,
  borderRadius: "7px",
  background: open ? "#1b1b1f" : "#141416",
});

const OPEN_BUTTON_STYLE: CSSProperties = {
  display: "flex",
  gap: ".55rem",
  alignItems: "center",
  flex: 1,
  minWidth: 0,
  textAlign: "left",
  background: "none",
  border: 0,
  padding: 0,
  cursor: "pointer",
};

const ICON_BUTTON_STYLE = (disabled: boolean, active = false): CSSProperties => ({
  display: "flex",
  padding: ".3rem",
  border: `1px solid ${active ? "#4a4a52" : "#3a3a3f"}`,
  borderRadius: "5px",
  background: "#19191c",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.4 : 1,
});

const KEY_ROWS = [
  { col: 2, number: "1", name: "01" },
  { col: 3, number: "2", name: "02" },
  { col: 0, number: "3", name: "03" },
  { col: 1, number: "4", name: "04" },
  { col: 4, number: "5", name: "M1" },
  { col: 5, number: "6", name: "M2" },
] as const;

function pendingKey(layer: number, target: NapeAssignmentControl): string {
  return target.kind === "key"
    ? `nape-${layer}-col-${target.col}`
    : `nape-${layer}-wheel-${target.clockwise ? "cw" : "ccw"}`;
}

function stagedFor(
  staged: readonly StagedNapeAssignment[],
  layer: number,
  target: NapeAssignmentControl,
): StagedNapeAssignment | undefined {
  return staged.find((entry) => {
    if (entry.layer !== layer) return false;
    if (entry.control.kind === "key" && target.kind === "key") return entry.control.col === target.col;
    if (entry.control.kind === "wheel" && target.kind === "wheel") {
      return entry.control.clockwise === target.clockwise;
    }
    return false;
  });
}

function AssignmentSelect({
  layer,
  target,
  action,
  keycode,
  staged,
  disabled,
}: {
  layer: number;
  target: NapeAssignmentControl;
  action: string;
  keycode: number;
  staged: StagedNapeAssignment | undefined;
  disabled: boolean;
}): ReactNode {
  const value = staged?.action ?? action;
  return (
    <span className="assignment-select-wrap">
      <select
        value={value}
        disabled={disabled}
        title={action === "Custom" ? `Unknown mapping: 0x${keycode.toString(16).padStart(4, "0")}` : undefined}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (next === "Custom") return;
          control.applyNapeAssignment(layer, target, next as KeychronNapeButtonAction);
        }}
      >
        {value === "Custom" ? <option value="Custom">Custom mapping (preserved)</option> : null}
        {KEYCHRON_NAPE_BUTTON_ACTIONS.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      <i aria-hidden="true" />
    </span>
  );
}

function NapeAssignments({ snapshot, layer }: { snapshot: ControlSnapshot; layer: number }): ReactNode {
  const map = snapshot.napeKeymap;
  const busy = snapshot.settingInProgress;
  const ready = map != null && map.layer === layer;
  return (
    <div className="profile-button-editor">
      <div className="profile-button-heading">
        <div>
          <p>BUTTONS</p>
          <h2>Onboard assignments</h2>
          <small>Choose what each physical control does on this layer.</small>
        </div>
      </div>
      {ready && map ? (
        <div className="assignment-grid">
          {KEY_ROWS.map((row) => {
            const key = map.keys.find((entry) => entry.col === row.col);
            if (!key) return null;
            const target: NapeAssignmentControl = { kind: "key", col: row.col };
            const staged = stagedFor(snapshot.stagedNapeAssignments, layer, target);
            return (
              <label
                key={row.col}
                className={`assignment-card${staged ? " is-staged" : ""}`}
                data-pending-key={pendingKey(layer, target)}
              >
                <span className="assignment-button-number">{row.number}</span>
                <span className="assignment-button-name">{row.name}</span>
                <AssignmentSelect
                  layer={layer}
                  target={target}
                  action={key.action}
                  keycode={key.keycode}
                  staged={staged}
                  disabled={busy}
                />
              </label>
            );
          })}
          {([
            { clockwise: false, number: "7", name: "Scroll wheel Counter Clockwise", current: map.wheel.ccw },
            { clockwise: true, number: "8", name: "Scroll wheel Clockwise", current: map.wheel.cw },
          ] as const).map((row) => {
            const target: NapeAssignmentControl = { kind: "wheel", clockwise: row.clockwise };
            const staged = stagedFor(snapshot.stagedNapeAssignments, layer, target);
            return (
              <label
                key={row.name}
                className={`assignment-card${staged ? " is-staged" : ""}`}
                data-pending-key={pendingKey(layer, target)}
              >
                <span className="assignment-button-number">{row.number}</span>
                <span className="assignment-button-name">{row.name}</span>
                <AssignmentSelect
                  layer={layer}
                  target={target}
                  action={row.current.action}
                  keycode={row.current.keycode}
                  staged={staged}
                  disabled={busy}
                />
              </label>
            );
          })}
        </div>
      ) : (
        <small className="setting-note">Reading {keychronLayerLabel(layer)}…</small>
      )}
      <small className="setting-note">
        Changes stay on this layer until you apply them. Clockwise and counter-clockwise scroll can be set independently.
      </small>
    </div>
  );
}

export function KeychronNapeLayers({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const count = status?.napeLayerCount;
  const inner = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!body.current || !inner.current) return;
    body.current.style.maxHeight = snapshot.profilesExpanded ? `${inner.current.scrollHeight}px` : "0px";
  });

  if (status == null || count == null || count < 1) return null;

  const activeLayer = status.napeLayer ?? 1;
  const editedLayer = snapshot.editedNapeLayer ?? activeLayer;
  const busy = snapshot.settingInProgress;
  const tags = [
    editedLayer === activeLayer ? "active" : null,
    "editing",
  ].filter(Boolean).join(" · ");

  return (
    <section
      id="nape-layers"
      className={`profile-disclosure device-data${snapshot.profilesExpanded ? " is-open" : ""}`}
      role="tabpanel"
      aria-labelledby="workspace-tab-profiles"
    >
      <div className="profile-summary">
        <button
          id="nape-layer-disclosure-toggle"
          className="profile-summary-main"
          type="button"
          aria-expanded={snapshot.profilesExpanded}
          aria-controls="nape-layer-disclosure-body"
          onClick={control.toggleProfilesExpanded}
        >
          <span className="profile-summary-text">
            <span className="profile-summary-label">EDITING</span>
            <strong>{keychronLayerLabel(editedLayer)}{tags ? ` · ${tags}` : ""}</strong>
            <small>Onboard layers stored on the Nape Pro</small>
          </span>
          <i className="profile-summary-chevron" aria-hidden="true" />
        </button>
        <button
          id="nape-layer-refresh"
          className="icon-button"
          type="button"
          aria-label="Reload layers"
          title="Reload layers"
          disabled={busy}
          onClick={() => void control.reloadNapeLayers()}
        >
          <IconRefresh />
        </button>
      </div>

      <div id="nape-layer-disclosure-body" className="profile-disclosure-body" ref={body}>
        <div className="profile-disclosure-inner" ref={inner}>
          <div id="nape-layer-list">
            <small style={{ display: "block", margin: "0 0 .2rem", color: "#5c5c62", fontSize: ".58rem" }}>
              Click a layer to inspect it. Use the circle to switch the mouse to it.
            </small>
            {Array.from({ length: count }, (_, index) => {
              const layer = index + 1;
              const opened = editedLayer === layer;
              const running = activeLayer === layer;
              const rowTags = [running ? "active" : null, opened ? "editing" : null]
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={layer} style={ROW_STYLE(opened)}>
                  <button
                    type="button"
                    title="Open this layer"
                    style={OPEN_BUTTON_STYLE}
                    onClick={() => control.openNapeLayer(layer)}
                  >
                    <span className={`device-dot${running ? "" : " is-idle"}`} />
                    <span className="profile-row-text" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <strong style={{ fontSize: ".72rem", color: "#e6e6ea" }}>
                        {keychronLayerLabel(layer)}{rowTags ? ` · ${rowTags}` : ""}
                      </strong>
                      <small style={{ color: "#77777c", fontSize: ".62rem" }}>
                        {running ? "Current layer on the mouse" : "Stored on the mouse"}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busy || running}
                    title={running ? "The mouse is already on this layer" : `Switch the mouse to ${keychronLayerLabel(layer)}`}
                    aria-label={`Switch to ${keychronLayerLabel(layer)}`}
                    aria-pressed={running}
                    style={ICON_BUTTON_STYLE(busy || running, running)}
                    onClick={() => void control.switchNapeLayer(layer)}
                  >
                    {running ? <IconRunning /> : <IconActivate />}
                  </button>
                </div>
              );
            })}
          </div>
          <small id="onboard-status">{snapshot.onboardStatus}</small>
          <NapeAssignments snapshot={snapshot} layer={editedLayer} />
        </div>
      </div>
    </section>
  );
}
