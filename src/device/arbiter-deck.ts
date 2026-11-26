import { arbiterLayout, arbiterMatrixToWire } from "@openmouse/keyboard-protocol/arbiter";
import type { ArbiterProduct, ArbiterTable } from "@openmouse/keyboard-protocol/arbiter";

/** Keycap widths in keyboard units; a drawing aid only, the keyboard reports none. */
export function keyWeight(code: number, rowHasIso: boolean): number {
  switch (code) {
    case 8: return 2;
    case 9: return 1.5;
    case 20: return 1.75;
    case 13: return 2.25;
    case 160: return rowHasIso ? 1.25 : 2.25;
    case 161: return 1.75;
    case 162: case 91: case 164: return 1.25;
    case 32: return 6.25;
    default: return 1;
  }
}

export interface DeckKey {
  matrix: number;
  wire: number;
  code: number;
  name: string;
}

/** Keys of one table, in physical rows. Placeholders that are not on the wire are left out. */
export function deckRows(product: ArbiterProduct, table: ArbiterTable): DeckKey[][] {
  const rows = new Map<number, DeckKey[]>();
  arbiterLayout(product).matrix.forEach((key, matrix) => {
    const wire = arbiterMatrixToWire(product, table, matrix);
    if (wire === null || key.name === "None") return;
    const row = rows.get(key.line) ?? [];
    row.push({ matrix, wire, code: key.keyCode, name: key.name });
    rows.set(key.line, row);
  });
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, keys]) => keys);
}

