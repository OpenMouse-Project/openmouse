import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  detectLocale,
  loadInterfacePreferences,
  saveInterfacePreferences,
  type InterfaceLocale,
} from "../interface-preferences";
import { ensureLocale, t } from "../i18n";

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
      document.documentElement.lang = locale === "pt" ? "pt-BR" : "en";
    } catch {
      /* non-DOM environment (tests) */
    }
    if (locale !== "en") void ensureLocale(locale).then(() => setTick((n) => n + 1));
  }, [locale]);
  return [locale, setLocale];
}

const TOGGLE_STYLE: CSSProperties = {
  display: "inline-flex",
  gap: "2px",
  padding: "2px",
  border: "1px solid var(--border, #333)",
  borderRadius: "999px",
  background: "transparent",
};

function toggleButton(active: boolean): CSSProperties {
  return {
    padding: ".15rem .5rem",
    border: 0,
    borderRadius: "999px",
    background: active ? "var(--ui-accent, #e8e8ea)" : "transparent",
    color: active ? "var(--ui-accent-ink, #111)" : "inherit",
    fontSize: ".68rem",
    fontWeight: 700,
    cursor: "pointer",
    opacity: active ? 1 : 0.65,
  };
}

/** Minimal EN/PT switcher for standalone pages. Self-styled so no per-page
    CSS changes are needed; inherits border/accent tokens when present. */
export function PageLocaleToggle({
  locale,
  onChange,
}: {
  locale: InterfaceLocale;
  onChange: (next: InterfaceLocale) => void;
}): ReactNode {
  return (
    <span style={TOGGLE_STYLE} role="group" aria-label={t(locale, "page.locale")}>
      {(["en", "pt"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={locale === option}
          onClick={() => onChange(option)}
          style={toggleButton(locale === option)}
        >
          {option === "en" ? t(locale, "page.en") : t(locale, "page.pt")}
        </button>
      ))}
    </span>
  );
}
