import type { ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import type { InterfacePreferences } from "../interface-preferences";

const THEME_CHOICES: ReadonlyArray<readonly [string, string]> = [
  ["Emerald", "#69d28d"], ["Violet", "#a78bfa"], ["Ice", "#67d8ff"],
  ["Ember", "#ff9b62"], ["Mono", "#f1f1f3"], ["Miku", "#39c5bb"],
  ["Catppuccin Mocha", "#cba6f7"], ["Catppuccin Macchiato", "#c6a0f6"], ["Catppuccin Frappé", "#ca9ee6"],
  ["NieR: Automata", "#d1cdb7"],
];

function SwitchCard({
  overline,
  title,
  blurb,
  label,
  id,
  checked,
  onChange,
}: {
  overline: string;
  title: string;
  blurb: string;
  label: string;
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): ReactNode {
  return (
    <article className="interface-setting-card">
      <span>{overline}</span>
      <h3>{title}</h3>
      <p>{blurb}</p>
      <label className="interface-switch-row">
        <span>{label}</span>
        <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      </label>
    </article>
  );
}

export function InterfaceSettings({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const preferences = snapshot.preferences;
  const set = <K extends keyof InterfacePreferences>(key: K) => (value: InterfacePreferences[K]): void =>
    control.setPreference(key, value);

  return (
    <section
      id="interface-settings-page"
      className={`interface-settings-page${snapshot.interfaceSettingsOpen ? " is-open" : ""}`}
      aria-labelledby="interface-settings-title"
    >
      <header className="interface-settings-header">
        <div>
          <p className="overline">OPENMOUSE</p>
          <h2 id="interface-settings-title">Settings</h2>
        </div>
        <button
          id="close-interface-settings"
          className="interface-settings-back"
          type="button"
          onClick={control.closeInterfaceSettings}
        >
          Back to device
        </button>
      </header>

      <div className="interface-settings-grid">
        {snapshot.previewEnabled ? (
          <article className="interface-setting-card openmouse-bridge-card">
            <div className="openmouse-bridge-copy">
              <span>OPENMOUSE BRIDGE</span>
              <h3>Automatic game detection and battery alerts</h3>
              <p>
                OpenMouse Bridge is a lightweight background service that works with the OpenMouse
                control panel to detect when games start and send battery notifications for your mice.
              </p>
              <ul>
                <li>Runs quietly in the background</li>
                <li>Detects active games automatically</li>
                <li>Sends mouse battery notifications</li>
              </ul>
            </div>
            <div className="openmouse-bridge-action">
              <span>IN DEVELOPMENT</span>
              <div className="openmouse-bridge-status" role="status">
                <i aria-hidden="true" />
                <span>Bridge not connected</span>
              </div>
              <button type="button" disabled>Download coming soon</button>
              <button className="openmouse-bridge-connect" type="button" disabled>Connect Bridge</button>
              <small>Install OpenMouse Bridge before connecting it to this control panel.</small>
            </div>
          </article>
        ) : null}

        <article className="interface-setting-card interface-theme-card">
          <span>APPEARANCE</span>
          <h3>Accent theme</h3>
          <p>Choose a theme and preview it across a miniature OpenMouse workspace.</p>
          <div className="theme-studio">
            <fieldset id="interface-theme" className="theme-choices" aria-label="Accent theme">
              {THEME_CHOICES.map(([name, swatch]) => (
                <label key={name} className="theme-choice" style={{ "--theme-swatch": swatch }}>
                  <input
                    type="radio"
                    name="interface-theme"
                    value={name}
                    checked={preferences.theme === name}
                    onChange={() => control.setInterfaceTheme(name)}
                  />
                  <i aria-hidden="true" />
                  <span>{name}</span>
                </label>
              ))}
            </fieldset>
            <div className="theme-demo">
              <div className="theme-demo-window" aria-hidden="true">
                <header>OPENMOUSE</header>
                <div className="theme-demo-body">
                  <nav><i /><i /><i /></nav>
                  <main>
                    <small>PROFILE 1</small>
                    <strong>Performance</strong>
                    <div><span>Polling rate</span><b>1000 Hz</b></div>
                    <em>Apply changes</em>
                  </main>
                  {preferences.theme === "Miku" ? (
                    <img id="miku-theme-preview-mascot" src="/miku-mascot.gif" alt="" />
                  ) : null}
                </div>
              </div>
              <p id="theme-preview-name" aria-live="polite">{preferences.theme} preview</p>
            </div>
          </div>
        </article>

        <SwitchCard
          overline="MOTION"
          title="Animation"
          blurb="Disable interface transitions and animated state changes."
          label="Reduce motion"
          id="interface-reduced-motion"
          checked={preferences.reducedMotion}
          onChange={set("reducedMotion")}
        />
        <SwitchCard
          overline="WRITES"
          title="Instant flash"
          blurb="Write each change to the mouse as soon as you make it, instead of staging it for the flash bar."
          label="Flash immediately"
          id="interface-instant-flash"
          checked={preferences.instantFlash}
          onChange={set("instantFlash")}
        />
        <SwitchCard
          overline="SECTIONS"
          title="Advanced editors"
          blurb="Choose whether CPI, button mapping, and experimental sections begin expanded."
          label="Expand by default"
          id="interface-expand-sections"
          checked={preferences.expandSections}
          onChange={set("expandSections")}
        />
        <SwitchCard
          overline="EXPERIMENTAL"
          title="Experimental controls"
          blurb="Show or completely hide controls that may vary between firmware versions."
          label="Show experimental settings"
          id="interface-show-experimental"
          checked={preferences.showExperimental}
          onChange={set("showExperimental")}
        />
      </div>

      {snapshot.previewEnabled && snapshot.previewEntries.length > 0 ? (
        <section id="preview-launcher" className="preview-launcher" aria-labelledby="preview-launcher-title">
          <div className="interface-setting-card">
            <span>DEVELOPMENT</span>
            <h3 id="preview-launcher-title">Driver previews</h3>
            <p>
              Render any supported driver without its hardware, to check a change against every brand.
              Nothing is written to a device.
            </p>
            <div id="preview-launcher-list" className="preview-launcher-list">
              {snapshot.previewEntries.map(([key, label]) => (
                <a
                  key={key}
                  className={`preview-launcher-link${snapshot.previewMode === key ? " is-active" : ""}`}
                  href={`?preview=${key}`}
                >
                  {label}
                  <small>{key}</small>
                </a>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <button
        id="reset-interface-settings"
        className="interface-reset"
        type="button"
        onClick={control.resetInterfacePreferences}
      >
        Reset interface preferences
      </button>
    </section>
  );
}
