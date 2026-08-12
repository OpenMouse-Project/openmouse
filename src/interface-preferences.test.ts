import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INTERFACE_PREFERENCES,
  interfaceThemeSlug,
  loadInterfacePreferences,
  saveInterfacePreferences,
  type InterfaceTheme,
} from "./interface-preferences.ts";

class MemoryStorage implements Storage {
  #values = new Map<string, string>();
  get length(): number { return this.#values.size; }
  clear(): void { this.#values.clear(); }
  getItem(key: string): string | null { return this.#values.get(key) ?? null; }
  key(index: number): string | null { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string): void { this.#values.delete(key); }
  setItem(key: string, value: string): void { this.#values.set(key, value); }
}

test("interface preferences restore only supported values", () => {
  const storage = new MemoryStorage();
  saveInterfacePreferences(storage, {
    theme: "Violet",
    reducedMotion: true,
    expandSections: true,
    showExperimental: false,
    instantFlash: true,
  });

  assert.deepEqual(loadInterfacePreferences(storage), {
    theme: "Violet",
    reducedMotion: true,
    expandSections: true,
    showExperimental: false,
    instantFlash: true,
  });
});

test("interface preferences fall back safely for malformed storage", () => {
  const storage = new MemoryStorage();
  storage.setItem("openmouse-interface-settings-v1", "not json");

  assert.deepEqual(loadInterfacePreferences(storage), DEFAULT_INTERFACE_PREFERENCES);
});

test("every interface theme persists and maps to its stylesheet slug", () => {
  const themes: ReadonlyArray<[InterfaceTheme, string]> = [
    ["Emerald", "emerald"],
    ["Violet", "violet"],
    ["Ice", "ice"],
    ["Ember", "ember"],
    ["Mono", "mono"],
    ["Miku", "miku"],
    ["Catppuccin Mocha", "catppuccin-mocha"],
    ["Catppuccin Macchiato", "catppuccin-macchiato"],
    ["Catppuccin Frappé", "catppuccin-frappe"],
  ];

  for (const [theme, slug] of themes) {
    const storage = new MemoryStorage();
    saveInterfacePreferences(storage, {
      ...DEFAULT_INTERFACE_PREFERENCES,
      theme,
    });

    assert.equal(loadInterfacePreferences(storage).theme, theme);
    assert.equal(interfaceThemeSlug(theme), slug);
  }
});
