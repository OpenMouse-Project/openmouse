import type { ReactNode } from "react";

/** Keys per row as keyboard units: a 65% board, drawn as an illustration rather than a model of any layout. */
const ROWS: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 1],
  [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25, 1],
  [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.75, 1, 1],
  [1.25, 1.25, 1.25, 6.25, 1, 1, 1, 1, 1, 1],
];

const UNIT = 20;
const GAP = 3;
const PAD = 10;
const WIDTH = 15 * UNIT + PAD * 2;
const HEIGHT = ROWS.length * UNIT + PAD * 2;

/** Stand-in artwork for keyboards that have no product render. */
export function KeyboardArt({ label }: { label: string }): ReactNode {
  return (
    <svg className="keyboard-art" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <rect className="keyboard-art-body" x="0.5" y="0.5" width={WIDTH - 1} height={HEIGHT - 1} rx="8" />
      {ROWS.map((row, rowIndex) => {
        let x = PAD;
        return row.map((units, keyIndex) => {
          const key = <rect key={`${rowIndex}-${keyIndex}`} className="keyboard-art-key" x={x + GAP / 2} y={PAD + rowIndex * UNIT + GAP / 2} width={units * UNIT - GAP} height={UNIT - GAP} rx="2.5" />;
          x += units * UNIT;
          return key;
        });
      })}
    </svg>
  );
}
