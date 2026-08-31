import { type ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import type { InterfacePreferences } from "../interface-preferences";

interface ThemeSwatch {
  name: string;
  accent: string;
  canvas: string;
  surface: string;
}

const THEME_CHOICES: readonly ThemeSwatch[] = [
  { name: "Emerald", accent: "#69d28d", canvas: "#08090a", surface: "#18181b" },
  { name: "Violet", accent: "#a78bfa", canvas: "#08090a", surface: "#18181b" },
  { name: "Ice", accent: "#67d8ff", canvas: "#08090a", surface: "#18181b" },
  { name: "Ember", accent: "#ff9b62", canvas: "#08090a", surface: "#18181b" },
  { name: "Mono", accent: "#f1f1f3", canvas: "#08090a", surface: "#18181b" },
  { name: "Miku", accent: "#39c5bb", canvas: "#0b1618", surface: "#17292c" },
  { name: "Catppuccin Mocha", accent: "#cba6f7", canvas: "#1e1e2e", surface: "#313244" },
  { name: "Catppuccin Macchiato", accent: "#c6a0f6", canvas: "#24273a", surface: "#363a4f" },
  { name: "Catppuccin Frappé", accent: "#ca9ee6", canvas: "#303446", surface: "#414559" },
  { name: "NieR: Automata", accent: "#d1cdb7", canvas: "#282620", surface: "#36342c" },
  { name: "Liquid Glass", accent: "#f4c95d", canvas: "#080a0c", surface: "#151a1e" },
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
    <>
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
        <article className="interface-setting-card openmouse-bridge-card">
          <span>OPENMOUSE BRIDGE</span>
          <h3>Automatic game detection and battery alerts</h3>
          <p>
            OpenMouse Bridge is a lightweight background service that works with the OpenMouse
            control panel to detect when games start and send battery notifications for your mice.
          </p>
          <button type="button" className="openmouse-bridge-coming-soon" disabled>
            Coming soon
          </button>
        </article>

        <article className="interface-setting-card interface-theme-card">
          <span>APPEARANCE</span>
          <h3>Accent theme</h3>
          <p>Each tile is painted in its own theme.</p>
          <fieldset id="interface-theme" className="theme-tiles" aria-label="Accent theme">
            {THEME_CHOICES.map(({ name, accent, canvas, surface }) => (
              <label
                key={name}
                className="theme-tile"
                style={{ "--tile-accent": accent, "--tile-canvas": canvas, "--tile-surface": surface }}
              >
                <input
                  type="radio"
                  name="interface-theme"
                  value={name}
                  checked={preferences.theme === name}
                  onChange={() => control.setInterfaceTheme(name)}
                />
                <i className="theme-tile-proof" aria-hidden="true">
                  <b /><b /><b />
                </i>
                <span>{name}</span>
              </label>
            ))}
          </fieldset>
        </article>

        {preferences.theme === "Liquid Glass" ? (
          <article className="interface-setting-card">
            <span>LIQUID GLASS</span>
            <h3>Glass intensity</h3>
            <p>Dial the frosted material from fully transparent panels to the full acrylic finish.</p>
            <div className="glass-intensity-row">
              <span className={`glass-intensity-caption${preferences.glassIntensity <= 25 ? " is-active" : ""}`}>Transparent</span>
              <span className="glass-slider-rail">
                <input
                  id="interface-glass-intensity"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={preferences.glassIntensity}
                  style={{ "--fill": `${preferences.glassIntensity}%` }}
                  onChange={(event) => set("glassIntensity")(Number(event.currentTarget.value))}
                />
              </span>
              <span className={`glass-intensity-caption${preferences.glassIntensity >= 75 ? " is-active" : ""}`}>Acrylic</span>
            </div>
          </article>
        ) : null}

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
    </>
  );
}
