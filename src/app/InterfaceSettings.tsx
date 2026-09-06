import { useState, type ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import { t } from "../i18n";
import type { InterfacePreferences } from "../interface-preferences";
import { Segmented } from "./ui";

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

export function ProfileKeyFields({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const [importText, setImportText] = useState("");
  const [copied, setCopied] = useState(false);
  const locale = snapshot.preferences.locale;
  const key = snapshot.hasActiveDevice ? control.exportProfileKey() : null;

  return (
    <>
      <label className="profile-key-field">
        <span>{t(locale, "set.yourKey")}</span>
        <textarea
          readOnly
          rows={3}
          value={key ?? t(locale, "set.noKey")}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <button
        type="button"
        className="profile-key-action"
        disabled={!key}
        onClick={() => {
          if (!key) return;
          void navigator.clipboard.writeText(key).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? t(locale, "set.copied") : t(locale, "set.copyKey")}
      </button>
      <label className="profile-key-field">
        <span>{t(locale, "set.importKey")}</span>
        <textarea
          rows={3}
          placeholder={t(locale, "set.importPlaceholder")}
          value={importText}
          onChange={(event) => setImportText(event.currentTarget.value)}
        />
      </label>
      <button
        type="button"
        className="profile-key-action"
        disabled={!importText.trim() || !snapshot.hasActiveDevice}
        onClick={() => {
          control.importProfileKey(importText);
          setImportText("");
        }}
      >
        {t(locale, "set.import")}
      </button>
      <small className="setting-note">
        {t(locale, "set.importNote")}
      </small>
    </>
  );
}

function ProfileKeyCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;
  return (
    <article className="interface-setting-card profile-key-card">
      <span>{t(locale, "set.profiles")}</span>
      <h3>{t(locale, "set.profileKey")}</h3>
      <p>{t(locale, "set.profileKeyBody")}</p>
      <ProfileKeyFields snapshot={snapshot} />
    </article>
  );
}

export function InterfaceSettings({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const preferences = snapshot.preferences;
  const locale = preferences.locale;
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
          <h2 id="interface-settings-title">{t(locale, "set.title")}</h2>
        </div>
        <button
          id="close-interface-settings"
          className="interface-settings-back"
          type="button"
          onClick={control.closeInterfaceSettings}
        >
          {t(locale, "set.back")}
        </button>
      </header>

      <div className="interface-settings-grid">
        <ProfileKeyCard snapshot={snapshot} />

        <article className="interface-setting-card openmouse-bridge-card">
          <span>{t(locale, "set.bridge")}</span>
          <h3>{t(locale, "set.bridgeTitle")}</h3>
          <p>{t(locale, "set.bridgeBody")}</p>
          <button type="button" className="openmouse-bridge-coming-soon" disabled>
            {t(locale, "set.comingSoon")}
          </button>
        </article>

        <article className="interface-setting-card interface-theme-card">
          <span>{t(locale, "set.appearance")}</span>
          <h3>{t(locale, "set.accentTheme")}</h3>
          <p>{t(locale, "set.accentBody")}</p>
          <fieldset id="interface-theme" className="theme-tiles" aria-label={t(locale, "set.accentTheme")}>
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
            <span>{t(locale, "set.glass")}</span>
            <h3>{t(locale, "set.glassTitle")}</h3>
            <p>{t(locale, "set.glassBody")}</p>
            <div className="glass-intensity-row">
              <span className={`glass-intensity-caption${preferences.glassIntensity <= 25 ? " is-active" : ""}`}>{t(locale, "set.transparent")}</span>
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
              <span className={`glass-intensity-caption${preferences.glassIntensity >= 75 ? " is-active" : ""}`}>{t(locale, "set.acrylic")}</span>
            </div>
          </article>
        ) : null}

        <article id="language-setting" className="interface-setting-card">
          <span>{t(locale, "set.language")}</span>
          <h3>{t(locale, "set.languageTitle")}</h3>
          <p>{t(locale, "set.languageBody")}</p>
          <Segmented
            id="interface-locale"
            ariaLabel={t(locale, "set.languageTitle")}
            value={preferences.locale}
            onChange={(next) => set("locale")(next)}
            options={[
              { value: "en", label: t(locale, "set.english") },
              { value: "pt", label: t(locale, "set.portuguese") },
            ]}
          />
        </article>

        <SwitchCard
          overline={t(locale, "set.motion")}
          title={t(locale, "set.animations")}
          blurb={t(locale, "set.animationsBody")}
          label={t(locale, "set.enableAnimations")}
          id="interface-reduced-motion"
          checked={!preferences.reducedMotion}
          onChange={(next) => set("reducedMotion")(!next)}
        />
        <SwitchCard
          overline={t(locale, "set.writes")}
          title={t(locale, "set.instantFlash")}
          blurb={t(locale, "set.instantFlashBody")}
          label={t(locale, "set.flashImmediately")}
          id="interface-instant-flash"
          checked={preferences.instantFlash}
          onChange={set("instantFlash")}
        />
        <SwitchCard
          overline={t(locale, "set.sections")}
          title={t(locale, "set.advancedEditors")}
          blurb={t(locale, "set.advancedEditorsBody")}
          label={t(locale, "set.expandByDefault")}
          id="interface-expand-sections"
          checked={preferences.expandSections}
          onChange={set("expandSections")}
        />
        <SwitchCard
          overline={t(locale, "set.experimental")}
          title={t(locale, "set.experimentalTitle")}
          blurb={t(locale, "set.experimentalBody")}
          label={t(locale, "set.showExperimental")}
          id="interface-show-experimental"
          checked={preferences.showExperimental}
          onChange={set("showExperimental")}
        />
      </div>

      {snapshot.previewEnabled && snapshot.previewEntries.length > 0 ? (
        <section id="preview-launcher" className="preview-launcher" aria-labelledby="preview-launcher-title">
          <div className="interface-setting-card">
            <span>{t(locale, "set.dev")}</span>
            <h3 id="preview-launcher-title">{t(locale, "set.previewsTitle")}</h3>
            <p>{t(locale, "set.previewsBody")}</p>
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
        {t(locale, "set.reset")}
      </button>
    </section>
    </>
  );
}
