import type { KeychronKeyShape } from "@openmouse/keyboard-protocol/keychron";

export type KeychronLayoutKey = KeychronKeyShape;

export interface KeychronLayout {
  keys: readonly KeychronLayoutKey[];
  width: number;
  height: number;
  /** False when no physical layout is known and the keys are the matrix drawn as a plain grid. */
  physical: boolean;
}

/**
 * The board's physical layout, or its matrix as a uniform grid when none is
 * known. The layout tables are large, so they load on demand; the shared
 * `import()` keeps them out of the main bundle.
 */
export async function loadKeychronLayout(productId: number, rows: number, cols: number): Promise<KeychronLayout> {
  const { keychronLayoutFor } = await import("./keychron-layout-data.ts");
  const known = keychronLayoutFor(productId);
  if (known && known.keys.length > 0) return { keys: known.keys, width: known.width, height: known.height, physical: true };
  const keys: KeychronLayoutKey[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) keys.push({ row, col, x: col, y: row, w: 1, h: 1, rotation: 0, rx: 0, ry: 0, encoder: null });
  }
  return { keys, width: cols, height: rows, physical: false };
}
