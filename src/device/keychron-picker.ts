import { keychronKeycodeCatalog } from "@openmouse/keyboard-protocol/keychron";
import type { KeychronCatalogCategory, KeychronCatalogEntry, KeychronKeycodeContext } from "@openmouse/keyboard-protocol/keychron";

export type PickerGroup = Pick<KeychronCatalogCategory, "id" | "label"> & { entries: readonly KeychronCatalogEntry[] };

/** The keycodes this board's firmware can be set to, grouped for the picker. */
export function pickerCatalog(context: Required<KeychronKeycodeContext>, layerCount: number): KeychronCatalogCategory[] {
  return keychronKeycodeCatalog({ ...context, layerCount });
}

/** Every search word must appear in the entry's label or title, ignoring case. */
export function entryMatches(entry: KeychronCatalogEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${entry.label} ${entry.title}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * What the picker lists. With a search, every category is searched and only
 * those with hits are shown; without one, the chosen category is shown.
 */
export function pickerGroups(catalog: readonly KeychronCatalogCategory[], categoryId: string, query: string): PickerGroup[] {
  if (query.trim() === "") {
    const category = catalog.find((entry) => entry.id === categoryId) ?? catalog[0];
    return category ? [category] : [];
  }
  return catalog
    .map((category) => ({ id: category.id, label: category.label, entries: category.entries.filter((entry) => entryMatches(entry, query)) }))
    .filter((group) => group.entries.length > 0);
}
