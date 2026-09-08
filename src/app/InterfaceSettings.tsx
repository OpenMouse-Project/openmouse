import { useState, type ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import { LOCALE_NAME_KEYS, t } from "../i18n";
import { interfaceThemeSlug, type InterfaceTheme } from "../interface-preferences";
import { DiscordIcon, DISCORD_URL, GitHubIcon, GITHUB_URL, TwitterIcon, TWITTER_URL } from "./social-links";
import { Segmented } from "./ui";

const THEME_ORDER: readonly InterfaceTheme[] = [
  "Matt",
  "Emerald",
  "Violet",
  "Ice",
  "Ember",
  "Mono",
  "Miku",
  "Catppuccin Mocha",
  "Catppuccin Macchiato",
  "Catppuccin Frappé",
  "NieR: Automata",
  "Light",
];

function ToggleSwitch({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): ReactNode {
  return (
    <label className="switch">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="switch-track" />
    </label>
  );
}

export function ProfileKeyFields({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const [importText, setImportText] = useState("");
  const [copied, setCopied] = useState(false);
  const locale = snapshot.preferences.locale;
  const key = snapshot.hasActiveDevice ? control.exportProfileKey() : null;

  return (
    <div className="profile-key-fields">
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
        className="connect-button"
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
        className="connect-button"
        disabled={!importText.trim() || !snapshot.hasActiveDevice}
        onClick={() => {
          control.importProfileKey(importText);
          setImportText("");
        }}
      >
        {t(locale, "set.import")}
      </button>
      <small className="setting-description">
        {t(locale, "set.importNote")}
      </small>
    </div>
  );
}

export function InterfaceSettings({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const preferences = snapshot.preferences;
  const locale = preferences.locale;
  const set = <K extends keyof typeof preferences>(key: K) => (value: (typeof preferences)[K]): void =>
    control.setPreference(key, value);

  const switchRow = (
    id: string,
    title: string,
    description: string,
    checked: boolean,
    onChange: (next: boolean) => void,
  ): ReactNode => (
    <div className="setting-row">
      <div className="setting-label">
        <span className="setting-title">{title}</span>
        <span className="setting-description">{description}</span>
      </div>
      <ToggleSwitch id={id} checked={checked} onChange={onChange} />
    </div>
  );

  return (
    <section
      id="interface-settings-page"
      className={`page${snapshot.interfaceSettingsOpen ? " is-open" : ""}`}
      aria-labelledby="interface-settings-title"
    >
      <h1 id="interface-settings-title" className="page-title">
        {t(locale, "set.title")}
      </h1>

      <div className="setting-row setting-row-block">
        <div className="setting-label">
          <span className="setting-title">{t(locale, "set.profileKey")}</span>
          <span className="setting-description">{t(locale, "set.profileKeyBody")}</span>
        </div>
        <ProfileKeyFields snapshot={snapshot} />
      </div>

      <div className="setting-row setting-row-block">
        <div className="setting-label">
          <span className="setting-title">{t(locale, "set.accentTheme")}</span>
          <span className="setting-description">{t(locale, "set.accentBody")}</span>
        </div>
        <fieldset id="interface-theme" className="theme-preset-picker" aria-label={t(locale, "set.accentTheme")}>
          {THEME_ORDER.map((name) => (
            <button
              key={name}
              type="button"
              className={`theme-preset-swatch${preferences.theme === name ? " active" : ""}`}
              data-theme-preview={interfaceThemeSlug(name)}
              aria-pressed={preferences.theme === name}
              onClick={() => control.setInterfaceTheme(name)}
            >
              <span className="theme-preset-acc" aria-hidden="true" />
              <span className="theme-preset-label">{name}</span>
            </button>
          ))}
        </fieldset>
      </div>

      <div className="setting-row">
        <div className="setting-label">
          <span className="setting-title">{t(locale, "set.languageTitle")}</span>
          <span className="setting-description">{t(locale, "set.languageBody")}</span>
        </div>
        <Segmented
          id="interface-locale"
          ariaLabel={t(locale, "set.languageTitle")}
          value={preferences.locale}
          onChange={set("locale")}
          options={LOCALE_NAME_KEYS.map(([value, nameKey]) => ({ value, label: t(locale, nameKey) }))}
        />
      </div>

      {switchRow(
        "interface-reduced-motion",
        t(locale, "set.animations"),
        t(locale, "set.animationsBody"),
        !preferences.reducedMotion,
        (next) => set("reducedMotion")(!next),
      )}

      {switchRow(
        "interface-instant-flash",
        t(locale, "set.instantFlash"),
        t(locale, "set.instantFlashBody"),
        preferences.instantFlash,
        set("instantFlash"),
      )}

      {switchRow(
        "interface-expand-sections",
        t(locale, "set.advancedEditors"),
        t(locale, "set.advancedEditorsBody"),
        preferences.expandSections,
        set("expandSections"),
      )}

      {switchRow(
        "interface-show-experimental",
        t(locale, "set.experimentalTitle"),
        t(locale, "set.experimentalBody"),
        preferences.showExperimental,
        set("showExperimental"),
      )}

      {snapshot.previewEnabled && snapshot.previewEntries.length > 0 ? (
        <div className="setting-row setting-row-block">
          <div className="setting-label">
            <span className="setting-title" id="preview-launcher-title">
              {t(locale, "set.previewsTitle")}
            </span>
            <span className="setting-description">{t(locale, "set.previewsBody")}</span>
          </div>
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
      ) : null}

      <div className="setting-row setting-row-block">
        <div className="setting-label">
          <span className="setting-title">{t(locale, "set.supportTitle")}</span>
          <span className="setting-description">{t(locale, "set.supportBody")}</span>
        </div>
        <div className="settings-support">
          <a className="app-donate" href="https://openmouse.app/donate.html" target="_blank" rel="noreferrer">
            <span className="app-donate-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.5 6H16V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5V11c0 3.31 2.69 6 6 6h2c3.31 0 6-2.69 6-6v-.5h1a2.5 2.5 0 0 0 0-5h-1.5zm0 3.5h-1V7h1a1 1 0 0 1 0 2zM7.5 13.5V7h9v4.5c0 2.48-2.02 4.5-4.5 4.5h-2c-2.48 0-4.5-2.02-4.5-4.5zM6 19a1 1 0 0 1 1-1h10a1 1 0 0 1 0 2H7a1 1 0 0 1-1-1z"/></svg>
            </span>
            <span className="app-donate-text">{t(locale, "nav.supportProject")}</span>
            <span className="app-donate-heart">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            </span>
          </a>
          <span className="app-footer-socials">
            <a href={DISCORD_URL} target="_blank" rel="noreferrer" title="OpenMouse on Discord" aria-label="OpenMouse on Discord"><DiscordIcon /></a>
            <a href={TWITTER_URL} target="_blank" rel="noreferrer" title="OpenMouse on X" aria-label="OpenMouse on X"><TwitterIcon /></a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" title="OpenMouse on GitHub" aria-label="OpenMouse on GitHub"><GitHubIcon /></a>
          </span>
        </div>
      </div>

      <button
        id="reset-interface-settings"
        className="rescan-button rescan-button-standalone"
        type="button"
        onClick={control.resetInterfacePreferences}
      >
        {t(locale, "set.reset")}
      </button>
    </section>
  );
}
