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

export interface InterfacePreferences {
  theme: InterfaceTheme;
  colorMode: InterfaceColorMode;
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

export function loadInterfacePreferences(storage: Storage): InterfacePreferences {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as Partial<InterfacePreferences>;
    return {
      theme: THEMES.includes(saved.theme as InterfaceTheme) ? saved.theme as InterfaceTheme : "Mono",
      colorMode: saved.colorMode === "Light" || saved.colorMode === "Dark" ? saved.colorMode : "System",
      reducedMotion: saved.reducedMotion === true,
      expandSections: saved.expandSections === true,
      showExperimental: saved.showExperimental !== false,
      instantFlash: saved.instantFlash === true,
      glassIntensity: clampGlassIntensity(saved.glassIntensity),
    };
  } catch {
    return { ...DEFAULT_INTERFACE_PREFERENCES };
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
