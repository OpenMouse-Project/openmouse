/**
 * Where each programmable button sits on a mouse's top-down artwork, for the
 * button-assignment picture. Positions are fractions of the image (0..1 from the
 * top left), measured from the artwork the app shows.
 */

export interface ButtonSpot {
  /** The button's slot in the onboard profile: 0 left, 1 right, 2 wheel, 3 back, 4 forward. */
  button: number;
  label: string;
  x: number;
  y: number;
  /** Which side the callout label sits on. */
  side: "left" | "right" | "top";
  /** Primary clicks are not offered for remapping, so the mouse stays usable. */
  locked: boolean;
}

export interface ButtonMapLayout {
  /** Artwork width divided by height. */
  aspect: number;
  spots: readonly ButtonSpot[];
}

function spots(positions: Record<"left" | "right" | "wheel" | "back" | "forward", [number, number]>): ButtonSpot[] {
  return [
    { button: 0, label: "Primary click", x: positions.left[0], y: positions.left[1], side: "left", locked: true },
    { button: 1, label: "Secondary click", x: positions.right[0], y: positions.right[1], side: "right", locked: true },
    { button: 2, label: "Middle click", x: positions.wheel[0], y: positions.wheel[1], side: "top", locked: false },
    { button: 4, label: "Forward", x: positions.forward[0], y: positions.forward[1], side: "left", locked: false },
    { button: 3, label: "Back", x: positions.back[0], y: positions.back[1], side: "left", locked: false },
  ];
}

// PRO X 3 Superstrike artwork, 2500 x 2160.
const PRO_X3: ButtonMapLayout = {
  aspect: 2500 / 2160,
  spots: spots({ left: [0.43, 0.3], right: [0.575, 0.3], wheel: [0.5, 0.272], forward: [0.3475, 0.399], back: [0.351, 0.544] }),
};

// PRO X 2 Superstrike artwork, 4886 x 2748.
const PRO_X2: ButtonMapLayout = {
  aspect: 4886 / 2748,
  spots: spots({ left: [0.445, 0.302], right: [0.55, 0.302], wheel: [0.5015, 0.293], forward: [0.4015, 0.4], back: [0.404, 0.533] }),
};

const LAYOUTS: Record<string, ButtonMapLayout> = {
  PROX3SUPERSTRIKE: PRO_X3,
  PROX2SUPERSTRIKE: PRO_X2,
};

/** The picture layout for a mouse, or null when its button positions are not known. */
export function buttonMapLayoutFor(deviceName: string): ButtonMapLayout | null {
  return LAYOUTS[deviceName.replace(/\s+/g, "").toUpperCase()] ?? null;
}
