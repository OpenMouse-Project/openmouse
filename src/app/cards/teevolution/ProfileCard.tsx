import { useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../../../device/controller";
import type { ControlSnapshot } from "../../../device/types";
import { t, tp } from "../../../i18n";
import { IconActivate, IconRunning } from "../../icons";
import { OptionMenu } from "../../ui";
import "./profile-card.css";

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
            <div className="profile-rule" />
            <small className="profile-list-hint">
              Click a profile to switch the mouse to it.
            </small>
            {Array.from({ length: count }, (_, index) => {
              const value = index + 1;
              const running = value === active;
              const tags = running ? t(locale, "prof.active") : "";
              const label = profileLabel(locale, names, index);
              return (
                <div key={value} className={`profile-row${running ? " is-open" : ""}`}>
                  <button
                    type="button"
                    disabled={busy}
                    title={running ? t(locale, "prof.runningProfile") : t(locale, "prof.switchProfile")}
                    className="profile-row-open"
                    onClick={() => {
                      if (!running) void control.applyProfileSelection(value);
                    }}
                  >
                    <span className={`device-dot${running ? "" : " is-idle"}`} />
                    <span className="profile-row-text">
                      <strong>
                        {label}{tags ? ` · ${tags}` : ""}
                      </strong>
                      <small>
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
                    className={`icon-button${running ? " is-active" : ""}`}
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
                  <div key={button} className="assignment-card">
                    <span className="assignment-button-number">{index + 1}</span>
                    <span className="assignment-button-name">{button}</span>
                    <span className="assignment-select-wrap">
                      <OptionMenu
                        id={`teevolution-button-${button.toLowerCase()}-select`}
                        ariaLabel={`${button} ${t(locale, "prof.assign")}`}
                        options={[
                          ...(!options.includes(assigned) ? [{ value: "", label: assigned, disabled: true }] : []),
                          ...options.map((option) => ({ value: option, label: option })),
                        ]}
                        value={options.includes(assigned) ? assigned : ""}
                        disabled={fixed.has(button) || busy}
                        onChange={(next) => control.applyDeviceButtonMapping(button, next)}
                      />
                    </span>
                  </div>
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
