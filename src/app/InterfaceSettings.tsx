import { useState, type ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import { LOCALE_NAME_KEYS, t } from "../i18n";
import { interfaceThemeSlug, type InterfaceTheme } from "../interface-preferences";
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
