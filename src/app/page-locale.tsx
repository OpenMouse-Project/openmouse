import { useEffect, useState, type ReactNode } from "react";
import {
  detectLocale,
  loadInterfacePreferences,
  saveInterfacePreferences,
  type InterfaceLocale,
} from "../interface-preferences";
import { ensureLocale, LOCALE_NAME_KEYS, t } from "../i18n";

/** BCP-47 tag for the <html lang> attribute; only locales whose region
    matters for correct rendering need an entry here (others fall through
    to the bare code). */
const HTML_LANG: Partial<Record<InterfaceLocale, string>> = {
  pt: "pt-BR",
  zh: "zh-Hans",
};

/** Standalone-page locale state. Reads the shared interface preference (so a
    choice made in the control app carries over), falls back to the browser
    language on first run, and persists back to the same key. */
export function usePageLocale(): [InterfaceLocale, (next: InterfaceLocale) => void] {
  const [locale, setLocaleState] = useState<InterfaceLocale>(() => {
    try {
      return loadInterfacePreferences(window.localStorage).locale;
    } catch {
      return detectLocale();
    }
  });
  const setLocale = (next: InterfaceLocale): void => {
    // Resolve the table before committing so the switch never flashes
    // English fallback strings.
    const apply = (): void => {
      setLocaleState(next);
      try {
        const prefs = loadInterfacePreferences(window.localStorage);
        saveInterfacePreferences(window.localStorage, { ...prefs, locale: next });
      } catch {
        /* storage unavailable (private mode) — in-memory choice still applies */
      }
    };
    if (next === "en") apply();
    else void ensureLocale(next).then(apply);
  };
  // A stored non-English locale resolves after first paint; bump a tick to
  // swap the fallback strings once the table arrives.
  const [, setTick] = useState(0);
  useEffect(() => {
    try {
      document.documentElement.lang = HTML_LANG[locale] ?? locale;
    } catch {
      /* non-DOM environment (tests) */
    }
    if (locale !== "en") void ensureLocale(locale).then(() => setTick((n) => n + 1));
  }, [locale]);
  return [locale, setLocale];
}

/** Language dropdown for standalone pages (landing, supported, donate, …).
    A <select> scales to any number of locales without layout rework —
    self-styled with the "page-locale-select" class so it inherits the
    site's own tokens; see landing.css. */
export function PageLocaleToggle({
  locale,
  onChange,
}: {
  locale: InterfaceLocale;
  onChange: (next: InterfaceLocale) => void;
}): ReactNode {
  return (
    <select
      className="page-locale-select"
      aria-label={t(locale, "page.locale")}
      value={locale}
      onChange={(event) => onChange(event.currentTarget.value as InterfaceLocale)}
    >
      {LOCALE_NAME_KEYS.map(([option, nameKey]) => (
        <option key={option} value={option}>{t(locale, nameKey)}</option>
      ))}
    </select>
  );
}
