import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import * as control from "../../../device/controller";
import type { ControlSnapshot } from "../../../device/types";
import { t, tp } from "../../../i18n";
import { IconActivate, IconRunning } from "../../icons";
import "./profile-card.css";

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

function profileLabel(
  locale: ControlSnapshot["preferences"]["locale"],
  names: readonly string[] | undefined,
  index: number,
): string {
  return names?.[index] ?? tp(locale, "adv.profileOpt", { n: index + 1 });
}

/**
 * Terra Pro onboard banks: the G502 profile disclosure, then the button map
 * for the active bank. Kept here so other mice keep the generic cards.
 */
export function TeevolutionProfileCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const [expanded, setExpanded] = useState(true);
  const inner = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!body.current || !inner.current) return;
    body.current.style.maxHeight = expanded ? `${inner.current.scrollHeight}px` : "0px";
  });

  const status = snapshot.status;
  if (!status || !status.profileCount || status.activeProfile == null) return null;

  const locale = snapshot.preferences.locale;
  const active = status.activeProfile;
  const count = status.profileCount;
  const names = status.profileNames;
  const busy = snapshot.settingInProgress;
  const mappings = status.buttonMappings;
  const options = status.buttonOptions ?? [];
  const fixed = new Set((status as unknown as { fixedButtons?: readonly string[] }).fixedButtons ?? []);

  const stages = status.dpiStages ?? [];
  const dpi = stages.length > 0
    ? `${stages.map((stage) => `${stage}`).join(" · ")} DPI`
    : null;
  const rate = status.pollingRateHz ? `${status.pollingRateHz.toLocaleString()} Hz` : null;
  const liveDetail = [dpi, rate].filter(Boolean).join(" · ");
  const summaryName = `${profileLabel(locale, names, active - 1)} · ${t(locale, "prof.active")}`;

  return (
    <section
      id="teevolution-onboard"
      className={`profile-disclosure device-data${expanded ? " is-open" : ""}`}
      role="tabpanel"
      aria-labelledby="workspace-tab-profiles"
    >
      <div className="profile-summary">
        <button
          id="teevolution-profile-disclosure-toggle"
          className="profile-summary-main"
          type="button"
          aria-expanded={expanded}
          aria-controls="teevolution-profile-disclosure-body"
          onClick={() => setExpanded((open) => !open)}
        >
          <span className="profile-summary-text">
            <span className="profile-summary-label">{t(locale, "prof.editing")}</span>
            <strong>{summaryName}</strong>
            <small>{liveDetail || t(locale, "prof.profileStores")}</small>
          </span>
          <i className="profile-summary-chevron" aria-hidden="true" />
        </button>
      </div>

      <div id="teevolution-profile-disclosure-body" className="profile-disclosure-body" ref={body}>
        <div className="profile-disclosure-inner" ref={inner}>
          <div id="teevolution-profile-list">
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem", margin: ".15rem 0 .05rem" }}>
              <span style={{ height: 1, flex: 1, background: "#26262a" }} />
            </div>
            <small style={{ display: "block", margin: "0 0 .2rem", color: "#5c5c62", fontSize: ".58rem" }}>
              Click a profile to switch the mouse to it.
            </small>
            {Array.from({ length: count }, (_, index) => {
              const value = index + 1;
              const running = value === active;
              const tags = running ? t(locale, "prof.active") : "";
              const label = profileLabel(locale, names, index);
              return (
                <div key={value} style={ROW_STYLE(running)}>
                  <button
                    type="button"
                    disabled={busy}
                    title={running ? t(locale, "prof.runningProfile") : t(locale, "prof.switchProfile")}
                    style={OPEN_BUTTON_STYLE}
                    onClick={() => {
                      if (!running) void control.applyProfileSelection(value);
                    }}
                  >
                    <span className={`device-dot${running ? "" : " is-idle"}`} />
                    <span className="profile-row-text" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <strong style={{ fontSize: ".72rem", color: "#e6e6ea" }}>
                        {label}{tags ? ` · ${tags}` : ""}
                      </strong>
                      <small style={{ color: "#77777c", fontSize: ".62rem" }}>
                        {running ? liveDetail || "stored on the mouse" : "stored on the mouse"}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busy || running}
                    title={running ? t(locale, "prof.runningProfile") : t(locale, "prof.switchProfile")}
                    aria-label={`Switch to profile ${value}`}
                    aria-pressed={running}
                    style={ICON_BUTTON_STYLE(busy || running, running)}
                    onClick={() => void control.applyProfileSelection(value)}
                  >
                    {running ? <IconRunning /> : <IconActivate />}
                  </button>
                </div>
              );
            })}
          </div>
          {mappings && options.length > 0 ? (
            <div className="profile-button-editor">
              <div className="profile-button-heading">
                <div>
                  <p>BUTTONS</p>
                  <h2>{t(locale, "prof.assign")}</h2>
                  <small>{t(locale, "prof.assignBody")}</small>
                </div>
              </div>
              <div className="assignment-grid">
                {Object.entries(mappings).map(([button, assigned], index) => (
                  <label key={button} className="assignment-card">
                    <span className="assignment-button-number">{index + 1}</span>
                    <span className="assignment-button-name">{button}</span>
                    <span className="assignment-select-wrap">
                      <select
                        id={`button-${button.toLowerCase()}-select`}
                        value={options.includes(assigned) ? assigned : ""}
                        disabled={fixed.has(button) || busy}
                        onChange={(event) => control.applyDeviceButtonMapping(button, event.currentTarget.value)}
                      >
                        {!options.includes(assigned) && <option value="">{assigned}</option>}
                        {options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                      <i aria-hidden="true" />
                    </span>
                  </label>
                ))}
              </div>
              <small className="setting-note">{t(locale, "prof.profileStores")}</small>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
