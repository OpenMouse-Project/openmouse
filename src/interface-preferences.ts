export type InterfaceDensity = "Compact" | "Comfortable";
export type InterfaceTheme = "Emerald" | "Violet" | "Ice" | "Ember" | "Mono";

export interface InterfacePreferences {
  density: InterfaceDensity;
  theme: InterfaceTheme;
  reducedMotion: boolean;
  expandSections: boolean;
  showExperimental: boolean;
}

const STORAGE_KEY = "openmouse-interface-settings-v1";
const THEMES: readonly InterfaceTheme[] = ["Emerald", "Violet", "Ice", "Ember", "Mono"];

export const DEFAULT_INTERFACE_PREFERENCES: InterfacePreferences = {
  density: "Compact",
  theme: "Emerald",
  reducedMotion: false,
  expandSections: false,
  showExperimental: true,
};

export function loadInterfacePreferences(storage: Storage): InterfacePreferences {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as Partial<InterfacePreferences>;
    return {
      density: saved.density === "Comfortable" ? "Comfortable" : "Compact",
      theme: THEMES.includes(saved.theme as InterfaceTheme) ? saved.theme as InterfaceTheme : "Emerald",
      reducedMotion: saved.reducedMotion === true,
      expandSections: saved.expandSections === true,
      showExperimental: saved.showExperimental !== false,
    };
  } catch {
    return { ...DEFAULT_INTERFACE_PREFERENCES };
  }
}

export function saveInterfacePreferences(storage: Storage, preferences: InterfacePreferences): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}
