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
export type InterfaceColorMode = "Light" | "Dark" | "System";

export interface InterfacePreferences {
  theme: InterfaceTheme;
  colorMode: InterfaceColorMode;
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
  theme: "Mono",
  colorMode: "System",
  reducedMotion: false,
  expandSections: false,
  showExperimental: true,
  instantFlash: false,
};

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
