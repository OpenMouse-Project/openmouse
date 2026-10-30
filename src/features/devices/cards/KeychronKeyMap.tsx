import type { CSSProperties, ReactNode } from "react";
import { KEYCHRON_ADVANCE_MODE, type KeychronKeySlot, type KeychronKeycodeContext } from "@openmouse/keyboard-protocol/keychron";
import type { KeychronWorkspace } from "../../../device/keychron-keyboard";
import { legendFor } from "../../../device/keychron-legend";
import { stepsToMm } from "../../../device/keychron-travel";
import { t, tp } from "../../../i18n/index";
import type { InterfaceLocale } from "../../settings/interface-preferences";

export type KeychronKeyKind = "static" | "rapid" | "advanced";

/** An advanced mode wins; otherwise rapid-trigger values make a key rapid. */
export function keyKind(slot: KeychronKeySlot | undefined): KeychronKeyKind {
  if (!slot) return "static";
  if (slot.advanceMode !== KEYCHRON_ADVANCE_MODE.none) return "advanced";
  return slot.advancePress > 0 || slot.advanceRelease > 0 ? "rapid" : "static";
}

export const keyId = (row: number, col: number): string => `${row}:${col}`;

const fixed = (value: number): string => String(Number(value.toFixed(3)));

/**
 * The keyboard drawn at its real key positions. Each key shows its legend
 * from the board's current keymap (row and column when that could not be
 * read) and its actuation in millimetres.
 */
export function KeychronKeyMap({ kc, locale, keymap, context, showTravel = true, selected, disabled, onSelect }: {
  kc: KeychronWorkspace;
  locale: InterfaceLocale;
  /** Keycodes that label the keys: a layer of the board's keymap. */
  keymap: readonly (readonly number[])[] | null;
  context?: KeychronKeycodeContext;
  /** Show each key's actuation in mm under its legend. */
  showTravel?: boolean;
  selected: ReadonlySet<string>;
  disabled: boolean;
  /** `additive` is true for Shift, Ctrl or Command clicks. */
  onSelect: (row: number, col: number, additive: boolean) => void;
}): ReactNode {
  const unit = kc.status.keychron?.unit ?? 0.1;
  const { layout, profile } = kc;
  return (
    <div className="keychron-map">
      <div className="keychron-board" role="group" aria-label={t(locale, "kb.keychronKeys")}
        style={{ "--kw": layout.width, aspectRatio: `${layout.width} / ${layout.height}` } as CSSProperties}>
        {layout.keys.map((key) => {
          const slot = profile?.keys[key.row]?.[key.col];
          const kind = keyKind(slot);
          const mm = slot ? fixed(stepsToMm(slot.distance, unit)) : null;
          const legend = keymap ? legendFor(keymap[key.row]?.[key.col], context) : null;
          const place = tp(locale, "kb.keychronKeyLabel", { row: key.row, col: key.col });
          const label = legend?.label || place;
          const id = keyId(key.row, key.col);
          const style: CSSProperties = {
            left: `${(key.x / layout.width) * 100}%`, top: `${(key.y / layout.height) * 100}%`,
            width: `${(key.w / layout.width) * 100}%`, height: `${(key.h / layout.height) * 100}%`,
            ...(key.rotation ? { transform: `rotate(${key.rotation}deg)`, transformOrigin: `${((key.rx - key.x) / key.w) * 100}% ${((key.ry - key.y) / key.h) * 100}%` } : {}),
          };
          const className = `keychron-key${showTravel ? ` is-${kind}` : ""}${legend?.unknown ? " is-unknown" : ""}${selected.has(id) ? " is-selected" : ""}${key.encoder !== null ? " is-knob" : ""}`;
          return (
            <button key={id} type="button" className={className} style={style} disabled={disabled} aria-pressed={selected.has(id)}
              title={legend?.title || place}
              aria-label={`${legend?.title || place}${mm === null || !showTravel ? "" : `, ${mm} mm`}`}
              onClick={(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => onSelect(key.row, key.col, event.shiftKey || event.ctrlKey || event.metaKey)}>
              <span className="keychron-face">
                <span>{label}</span>
                {mm === null || !showTravel ? null : <small>{mm}</small>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
