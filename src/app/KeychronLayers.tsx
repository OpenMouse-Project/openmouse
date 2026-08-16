import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
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

function layerLabel(layer: number): string {
  return `Layer ${layer}`;
}

export function KeychronLayers({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const count = status?.keychronLayerCount;
  const inner = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!body.current || !inner.current) return;
    body.current.style.maxHeight = snapshot.profilesExpanded ? `${inner.current.scrollHeight}px` : "0px";
  });

  if (status == null || count == null || count < 1) return null;

  const activeLayer = status.keychronLayer ?? 1;
  const editedLayer = snapshot.editedKeychronLayer ?? activeLayer;
  const busy = snapshot.settingInProgress;
  const tags = [
    editedLayer === activeLayer ? "active" : null,
    "editing",
  ].filter(Boolean).join(" · ");

  return (
    <section
      id="keychron-layers"
      className={`profile-disclosure device-data${snapshot.profilesExpanded ? " is-open" : ""}`}
      role="tabpanel"
      aria-labelledby="workspace-tab-profiles"
    >
      <div className="profile-summary">
        <button
          id="keychron-layer-disclosure-toggle"
          className="profile-summary-main"
          type="button"
          aria-expanded={snapshot.profilesExpanded}
          aria-controls="keychron-layer-disclosure-body"
          onClick={control.toggleProfilesExpanded}
        >
          <span className="profile-summary-text">
            <span className="profile-summary-label">EDITING</span>
            <strong>{layerLabel(editedLayer)}{tags ? ` · ${tags}` : ""}</strong>
            <small>Onboard layers stored on the Nape Pro</small>
          </span>
          <i className="profile-summary-chevron" aria-hidden="true" />
        </button>
        <button
          id="keychron-layer-refresh"
          className="icon-button"
          type="button"
          aria-label="Reload layers"
          title="Reload layers"
          disabled={busy}
          onClick={() => void control.reloadKeychronLayers()}
        >
          <IconRefresh />
        </button>
      </div>

      <div id="keychron-layer-disclosure-body" className="profile-disclosure-body" ref={body}>
        <div className="profile-disclosure-inner" ref={inner}>
          <div id="keychron-layer-list">
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
                    onClick={() => control.openKeychronLayer(layer)}
                  >
                    <span className={`device-dot${running ? "" : " is-idle"}`} />
                    <span className="profile-row-text" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <strong style={{ fontSize: ".72rem", color: "#e6e6ea" }}>
                        {layerLabel(layer)}{rowTags ? ` · ${rowTags}` : ""}
                      </strong>
                      <small style={{ color: "#77777c", fontSize: ".62rem" }}>
                        {running ? "Current layer on the mouse" : "Stored on the mouse"}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busy || running}
                    title={running ? "The mouse is already on this layer" : `Switch the mouse to ${layerLabel(layer)}`}
                    aria-label={`Switch to ${layerLabel(layer)}`}
                    aria-pressed={running}
                    style={ICON_BUTTON_STYLE(busy || running, running)}
                    onClick={() => void control.switchKeychronLayer(layer)}
                  >
                    {running ? <IconRunning /> : <IconActivate />}
                  </button>
                </div>
              );
            })}
          </div>
          <small id="onboard-status">{snapshot.onboardStatus}</small>
        </div>
      </div>
    </section>
  );
}
