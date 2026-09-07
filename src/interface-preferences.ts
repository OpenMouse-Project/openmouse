export type InterfaceTheme =
  | "Emerald"
  | "Violet"
  | "Ice"
  | "Ember"
  | "Mono"
  | "Miku"
  | "Catppuccin Mocha"
  | "Catppuccin Macchiato"
  | "Catppuccin Frappé"
  | "NieR: Automata"
  | "Liquid Glass";
export type InterfaceColorMode = "Light" | "Dark" | "System";
export type InterfaceLocale = "en" | "pt" | "es" | "fr" | "de" | "zh" | "ja" | "ko" | "ru";

/** Every supported locale, in picker order. Each entry's `match` decides
    which `navigator.language` prefixes resolve to it on first run — checked
    in this array's order, so a more specific code should come first. */
export const LOCALES: ReadonlyArray<{ code: InterfaceLocale; match: readonly string[] }> = [
  { code: "pt", match: ["pt"] },
  { code: "es", match: ["es"] },
  { code: "fr", match: ["fr"] },
  { code: "de", match: ["de"] },
  { code: "zh", match: ["zh"] },
  { code: "ja", match: ["ja"] },
  { code: "ko", match: ["ko"] },
  { code: "ru", match: ["ru"] },
  { code: "en", match: ["en"] },
];

export interface InterfacePreferences {
  theme: InterfaceTheme;
  colorMode: InterfaceColorMode;
  locale: InterfaceLocale;
  reducedMotion: boolean;
  expandSections: boolean;
  showExperimental: boolean;
  instantFlash: boolean;
  glassIntensity: number;
}

const STORAGE_KEY = "openmouse-interface-settings-v1";
const THEMES: readonly InterfaceTheme[] = [
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
  "Liquid Glass",
];

export const DEFAULT_INTERFACE_PREFERENCES: InterfacePreferences = {
  theme: "Mono",
  colorMode: "System",
  locale: "en",
  reducedMotion: false,
  expandSections: false,
  showExperimental: true,
  instantFlash: false,
  glassIntensity: 100,
};

function clampGlassIntensity(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_INTERFACE_PREFERENCES.glassIntensity;
  return Math.min(100, Math.max(0, Math.round(number)));
}

/** OS-level preference. Used only as the initial default so an explicit
    site choice always wins over the system setting. */
export function systemPrefersReducedMotion(): boolean {
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
  } catch {
    // Ignore and fall through to the animated default below.
  }
  return false;
}

/** First-run locale from the browser, guarded for Node/tests. */
export function detectLocale(): InterfaceLocale {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
      const lang = navigator.language.toLowerCase();
      const found = LOCALES.find((locale) => locale.match.some((prefix) => lang.startsWith(prefix)));
      if (found) return found.code;
    }
  } catch {
    // Ignore and fall through to English below.
  }
  return "en";
}

function coerceLocale(value: unknown): InterfaceLocale {
  if (LOCALES.some((locale) => locale.code === value)) return value as InterfaceLocale;
  // No saved choice yet: follow the browser once, then persist it.
  return detectLocale();
}

export function loadInterfacePreferences(storage: Storage): InterfacePreferences {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as Partial<InterfacePreferences>;
    return {
      theme: THEMES.includes(saved.theme as InterfaceTheme) ? saved.theme as InterfaceTheme : "Mono",
      colorMode: saved.colorMode === "Light" || saved.colorMode === "Dark" ? saved.colorMode : "System",
      locale: coerceLocale(saved.locale),
      reducedMotion:
        typeof saved.reducedMotion === "boolean" ? saved.reducedMotion : systemPrefersReducedMotion(),
      expandSections: saved.expandSections === true,
      showExperimental: saved.showExperimental !== false,
      instantFlash: saved.instantFlash === true,
      glassIntensity: clampGlassIntensity(saved.glassIntensity),
    };
  } catch {
    return { ...DEFAULT_INTERFACE_PREFERENCES, reducedMotion: systemPrefersReducedMotion(), locale: detectLocale() };
  }
}

export function saveInterfacePreferences(storage: Storage, preferences: InterfacePreferences): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

/** Dataset value for the theme selector. Display names carry spaces, one
    accent, and a colon; the stylesheet matches lowercase hyphenated slugs,
    so every run of non-alphanumerics collapses to a single dash. */
export function interfaceThemeSlug(theme: InterfaceTheme): string {
  return theme
    .toLowerCase()
    .replace("é", "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
