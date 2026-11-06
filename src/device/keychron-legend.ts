import { keychronKeycodeLegend } from "@openmouse/keyboard-protocol/keychron";
import type { KeychronKeycodeContext } from "@openmouse/keyboard-protocol/keychron";

/**
 * Short legend and tooltip for a keycode read from the board; empty for an
 * unassigned key. Pass the board's keycode context, or layer and custom keys
 * are shown wrongly. `unknown` keys carry their hex value as the label.
 */
export function legendFor(code: number | null | undefined, context?: KeychronKeycodeContext): { label: string; title: string; unknown: boolean } {
  if (code === null || code === undefined) return { label: "", title: "", unknown: false };
  const { label, title, unknown } = keychronKeycodeLegend(code, context);
  return { label, title, unknown };
}
