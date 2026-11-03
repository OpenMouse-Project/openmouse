import type { MchoseRgb } from "@openmouse/keyboard-protocol/mchose";

/** Per-key colour data as the colour picker's hex string, and back. */
export function mchoseRgbToHex({ r, g, b }: MchoseRgb): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function mchoseHexToRgb(hex: string): MchoseRgb {
  return { r: parseInt(hex.slice(1, 3), 16) || 0, g: parseInt(hex.slice(3, 5), 16) || 0, b: parseInt(hex.slice(5, 7), 16) || 0 };
}

/** Starting colour for the per-key colour picker. */
export const MCHOSE_DEFAULT_KEY_COLOR = mchoseRgbToHex({ r: 255, g: 255, b: 255 });

/** One colour stop of a gradient: `at` runs 0 to 1 along the bar. */
export interface MchoseGradientStop {
  at: number;
  color: string;
}

/** The gradient's colour at `t` (0 to 1), blending the two stops around it. */
export function mchoseGradientColor(stops: readonly MchoseGradientStop[], t: number): MchoseRgb {
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  const after = sorted.findIndex((stop) => stop.at >= t);
  if (after <= 0) return mchoseHexToRgb((after === 0 ? sorted[0] : sorted[sorted.length - 1])!.color);
  const from = sorted[after - 1]!;
  const to = sorted[after]!;
  const mix = to.at === from.at ? 0 : (t - from.at) / (to.at - from.at);
  const a = mchoseHexToRgb(from.color);
  const b = mchoseHexToRgb(to.color);
  return { r: Math.round(a.r + (b.r - a.r) * mix), g: Math.round(a.g + (b.g - a.g) * mix), b: Math.round(a.b + (b.b - a.b) * mix) };
}

/**
 * Paint a gradient across keys at `angle` degrees (0 runs left to right, 90
 * top to bottom), stretched so the first and last keys get the end stops.
 */
export function mchoseGradientKeys(
  keys: readonly { index: number; row: number; x: number; width: number }[],
  stops: readonly MchoseGradientStop[],
  angle: number,
): { index: number; color: MchoseRgb }[] {
  const rad = (angle * Math.PI) / 180;
  // Key units on both axes, so a diagonal follows the keyboard's real shape.
  const along = keys.map((key) => (key.x + key.width / 2) * Math.cos(rad) + (key.row + 0.5) * Math.sin(rad));
  const min = Math.min(...along);
  const span = Math.max(...along) - min || 1;
  return keys.map((key, n) => ({ index: key.index, color: mchoseGradientColor(stops, (along[n]! - min) / span) }));
}

/** Starting stops for the gradient editor. */
export const MCHOSE_DEFAULT_GRADIENT: readonly MchoseGradientStop[] = [{ at: 0, color: "#ff2d6f" }, { at: 1, color: "#2dc8ff" }];

/** A key's custom colour when it is reset: off, as the keyboard ships. */
export const MCHOSE_KEY_COLOR_OFF: MchoseRgb = { r: 0, g: 0, b: 0 };

/** The keyboard flashes a key blue between its two calibration presses; the panel's dot matches that LED colour. */
export const MCHOSE_CALIBRATION_PENDING = "#3b82f6";
