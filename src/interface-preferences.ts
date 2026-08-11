export type InterfaceDensity = "Compact" | "Comfortable";
export type InterfaceTheme =
  | "Emerald"
  | "Violet"
  | "Ice"
  | "Ember"
  | "Mono"
  | "Miku"
  | "Catppuccin Mocha"
  | "Catppuccin Macchiato"
  | "Catppuccin Frappé";

export interface InterfacePreferences {
  density: InterfaceDensity;
  theme: InterfaceTheme;
  reducedMotion: boolean;
  expandSections: boolean;
  showExperimental: boolean;
  instantFlash: boolean;
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
];

export const DEFAULT_INTERFACE_PREFERENCES: InterfacePreferences = {
  density: "Compact",
  theme: "Mono",
  reducedMotion: false,
  expandSections: false,
  showExperimental: true,
  instantFlash: false,
};

export function loadInterfacePreferences(storage: Storage): InterfacePreferences {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as Partial<InterfacePreferences>;
    return {
      density: saved.density === "Comfortable" ? "Comfortable" : "Compact",
      theme: THEMES.includes(saved.theme as InterfaceTheme) ? saved.theme as InterfaceTheme : "Mono",
      reducedMotion: saved.reducedMotion === true,
      expandSections: saved.expandSections === true,
      showExperimental: saved.showExperimental !== false,
      instantFlash: saved.instantFlash === true,
    };
  } catch {
    return { ...DEFAULT_INTERFACE_PREFERENCES };
  }
}

export function saveInterfacePreferences(storage: Storage, preferences: InterfacePreferences): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

/** Dataset value for the theme selector. Display names carry spaces (and one
    accent) for the dropdown, but the stylesheet matches slugs. */
export function interfaceThemeSlug(theme: InterfaceTheme): string {
  return theme.toLowerCase().replace("é", "e").replace(/\s+/g, "-");
}
