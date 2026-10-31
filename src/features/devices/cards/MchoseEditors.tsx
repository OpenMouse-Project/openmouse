import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Lightbulb, Play, SkipBack, SkipForward, Square, Sun, SunDim, Volume1, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import {
  MCHOSE_ACTION_TYPE,
  MCHOSE_BRIGHTNESS_MAX,
  MCHOSE_DKS_DEFAULT_POINTS,
  MCHOSE_MACRO_COUNT,
  MCHOSE_MACRO_MODE,
  MCHOSE_MEDIA_NAMES,
  MCHOSE_MOD_TAP_HOLD_RANGE_MS,
  MCHOSE_MODIFIER,
  MCHOSE_MOUSE_NAMES,
  MCHOSE_SPECIAL_NAMES,
  MCHOSE_SPEED_MAX,
  MCHOSE_SYSTEM_NAMES,
  MCHOSE_USAGE_NAMES,
  mchoseActionLabel,
  mchoseActionsEqual,
  mchoseMediaAction,
  mchoseModel,
} from "@openmouse/keyboard-protocol/mchose";
import type {
  MchoseAction,
  MchoseDks,
  MchoseDksAction,
  MchoseEffect,
  MchoseLayoutKey,
  MchoseLightZone,
  MchoseMacro,
  MchoseMacroStep,
  MchoseRgb,
} from "@openmouse/keyboard-protocol/mchose";
import * as control from "../../../device/controller";
import type { MchoseWorkspace } from "../../../device/mchose-workspace";
import {
  MCHOSE_DEFAULT_GRADIENT, MCHOSE_DEFAULT_KEY_COLOR, MCHOSE_KEY_COLOR_OFF, mchoseGradientColor, mchoseGradientKeys, mchoseHexToRgb, mchoseRgbToHex,
  type MchoseGradientStop,
} from "../../../device/mchose-colors";
import type { InterfaceLocale } from "../../settings/interface-preferences";
import { displayText, t, tp } from "../../../i18n/index";
import { ColorPicker } from "../../../shared/ColorPicker";
import { OptionMenu, Segmented, SliderField, StepperSlider, SwitchRow } from "../../../shared/ui";
import { hidKeyForCode } from "../../profiles/hid-keys";

const NONE: MchoseAction = { type: 0, code1: 0, code2: 0 };

export function keyRows(layout: readonly MchoseLayoutKey[]): MchoseLayoutKey[][] {
  // As many rows as the model has: a board with an F-row or numpad brings its own.
  const rows = [...new Set(layout.map((key) => key.row))].sort((a, b) => a - b);
  return rows.map((row) => layout.filter((key) => key.row === row).sort((a, b) => a.x - b.x));
}

/** Short keycap names, so a 1u key never wraps its label. */
const KEYCAP: Readonly<Record<string, string>> = {
  Backspace: "Bksp", Insert: "Ins", Delete: "Del", "Page Up": "PgUp", "Page Down": "PgDn", PgUp: "PgUp", PgDn: "PgDn",
  "Caps Lock": "Caps", "Print Screen": "PrtSc", "Scroll Lock": "ScrLk", "Num Lock": "NumLk", Pause: "Pause",
  Up: "\u2191", Down: "\u2193", Left: "\u2190", Right: "\u2192",
  "Right Shift": "RShift", "Right Ctrl": "RCtrl", "Right Alt": "RAlt", "Right Win": "RWin",
  LShift: "Shift", LCtrl: "Ctrl", LAlt: "Alt", Disabled: "\u2013",
  Command: "\u2318", Option: "\u2325", "Right Command": "R\u2318", "Right Option": "R\u2325",
};

/** Mac layers (2 and 3) name Win and Alt as Command and Option, as the vendor app does. */
const macName = (text: string): string => text.replace(/\bWin\b/g, "Command").replace(/\b[LR]?Alt\b/g, "Option");

/** Media keys draw as icons on a keycap, as in the vendor app; the name stays in the tooltip. */
const KEYCAP_ICON: Readonly<Record<string, LucideIcon>> = {
  "Previous track": SkipBack, "Next track": SkipForward, "Play / pause": Play, Stop: Square,
  Mute: VolumeX, "Volume down": Volume1, "Volume up": Volume2, "Lighting on / off": Lightbulb,
  "Screen brightness up": Sun, "Screen brightness down": SunDim,
};

/** Modifier symbols for combinations on a keycap: "Ctrl+Z" shows as "⌃Z". */
const MODIFIER_SYMBOL: readonly [string, string][] = [["Ctrl+", "⌃"], ["Shift+", "⇧"], ["Alt+", "⌥"], ["Win+", "⊞"], ["Option+", "⌥"], ["Command+", "⌘"]];

export function keycapLabel(text: string): string {
  if (KEYCAP[text]) return KEYCAP[text]!;
  if (!text.includes("+") || text.endsWith("+")) return text;
  const parts = text.split("+");
  const key = parts.pop()!;
  const combo = parts.map((part) => MODIFIER_SYMBOL.find(([name]) => name === `${part}+`)?.[1] ?? part).join("");
  return combo + (KEYCAP[key] ?? key);
}

export function KeyDeck({ locale, layout, label, sub, swatch, depth, muted, selected, onToggle, disabled, ariaLabel }: {
  locale: InterfaceLocale;
  layout: readonly MchoseLayoutKey[];
  label: (key: MchoseLayoutKey) => string;
  sub?: (key: MchoseLayoutKey) => string | null;
  /** A colour (hex) to show as a dot on the keycap. */
  swatch?: (key: MchoseLayoutKey) => string | null;
  /** How far the key is pressed right now, 0 to 1, drawn as a fill from the bottom. */
  depth?: (key: MchoseLayoutKey) => number;
  muted?: (key: MchoseLayoutKey) => boolean;
  selected: ReadonlySet<number>;
  onToggle: (index: number) => void;
  disabled: boolean;
  ariaLabel: string;
}): ReactNode {
  const rows = useMemo(() => keyRows(layout), [layout]);
  return (
    <div className="keyboard-key-deck">
      <div className="mchose-deck" role="group" aria-label={ariaLabel}>
        {rows.map((keys, row) => (
          <div className="mchose-deck-row" key={row}>
            {keys.map((key) => {
              const isSelected = selected.has(key.index);
              const shown = label(key);
              const detail = sub?.(key) ?? null;
              const dot = swatch?.(key) ?? null;
              const Icon = KEYCAP_ICON[shown];
              return (
                <button
                  type="button" key={key.index} disabled={disabled}
                  className={`keyboard-key mchose-key${isSelected ? " is-selected" : ""}${muted?.(key) ? " is-muted" : ""}${!Icon && keycapLabel(shown).length > 3 && key.width < 1.5 ? " is-tight" : ""}`}
                  style={{ flexGrow: key.width }}
                  aria-pressed={isSelected}
                  aria-label={displayText(locale, detail ? `${shown} · ${detail}` : shown)}
                  title={displayText(locale, detail ? `${shown} · ${detail}` : shown)}
                  onClick={() => onToggle(key.index)}
                >
                  <span>{Icon ? <Icon size={16} aria-hidden="true" /> : displayText(locale, keycapLabel(shown))}</span>
                  {detail ? <small>{displayText(locale, keycapLabel(detail))}</small> : null}
                  {depth?.(key) ? <i className="mchose-depth" aria-hidden="true" style={{ "--depth": depth(key) } as CSSProperties} /> : null}
                  {dot ? <i className="mchose-swatch" aria-hidden="true" style={{ "--swatch": dot } as CSSProperties} /> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** An action's name, or its raw bytes when it has none. */
function actionName(action: MchoseAction | undefined, fallback: string): string {
  if (!action) return fallback;
  return mchoseActionLabel(action) ?? `${action.type.toString(16)}:${action.code1.toString(16)}:${action.code2.toString(16)}`;
}

/**
 * What a key shows on a layer: `action`'s name, or what the layer has there
 * from the factory (the key itself on layer 0) while it holds that or nothing.
 */
function slotLabel(mchose: MchoseWorkspace, layer: number, key: MchoseLayoutKey, action = mchose.keymap[layer]?.[key.index]): string {
  const factory = mchose.defaults[layer]?.[key.index];
  const label = !action || action.type === 0 || (factory && mchoseActionsEqual(action, factory))
    ? (layer && factory && mchoseActionLabel(factory)) || key.label
    : actionName(action, key.label);
  return layer > 1 ? macName(label) : label;
}

/** A key's name in decks that are not about one layer: its Mac layer name while the keyboard uses the Mac layers. */
export function deckLabel(mchose: MchoseWorkspace, key: MchoseLayoutKey): string {
  // Until the factory Mac layer is read there is no Mac name to give, so the key keeps its own.
  const factory = mchose.settings?.macMode ? mchose.defaults[2]?.[key.index] : undefined;
  return factory ? slotLabel(mchose, 2, key, factory) : key.label;
}

type Category = "none" | "key" | "shortcut" | "mouse" | "media" | "system" | "special" | "macro" | "disabled";
const CATEGORY_LABEL: Record<Category, Parameters<typeof t>[1]> = {
  none: "kb.mchCatNone", key: "kb.mchCatKey", shortcut: "kb.mchCatShortcut", mouse: "kb.mchCatMouse", media: "kb.mchCatMedia", system: "kb.mchCatSystem",
  special: "kb.mchCatSpecial", macro: "kb.mchCatMacro", disabled: "kb.mchCatDisabled",
};
const MODIFIER_BITS = [MCHOSE_MODIFIER.leftCtrl, MCHOSE_MODIFIER.leftShift, MCHOSE_MODIFIER.leftAlt, MCHOSE_MODIFIER.leftWin] as const;
const MODIFIER_KEYS = ["Ctrl", "Shift", "Alt", "Win"] as const;
const MODIFIER_USAGES = [0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7];
const MODIFIER_USAGE_NAMES = ["Ctrl", "Shift", "Alt", "Win", "Right Ctrl", "Right Shift", "Right Alt", "Right Win"];

function categoryOf(action: MchoseAction): Category {
  switch (action.type) {
    case MCHOSE_ACTION_TYPE.mouse: case MCHOSE_ACTION_TYPE.wheel: return "mouse";
    case MCHOSE_ACTION_TYPE.media: return "media";
    case MCHOSE_ACTION_TYPE.system: return "system";
    case MCHOSE_ACTION_TYPE.special: return "special";
    case MCHOSE_ACTION_TYPE.macro: return "macro";
    case 0: return "none";
    default: return action.type === MCHOSE_ACTION_TYPE.key && action.code1 === 0 && action.code2 === 0 ? "disabled" : "key";
  }
}

/**
 * Ready-made shortcuts, as the vendor app lists them: [modifiers, usage, name].
 * They are ordinary modifier+key actions; Mac layers get the Command versions.
 */
const SHORTCUTS: readonly (readonly [number, number, string])[] = [
  [1, 0x06, "Copy"], [1, 0x19, "Paste"], [1, 0x1b, "Cut"], [1, 0x1d, "Undo"], [1, 0x1c, "Redo"], [1, 0x04, "Select all"],
  [1, 0x16, "Save"], [1, 0x12, "Open"], [1, 0x11, "New"], [1, 0x09, "Find"], [1, 0x17, "New tab"], [1, 0x1a, "Close tab"],
  [1, 0x2e, "Zoom in"], [1, 0x2d, "Zoom out"], [1, 0x27, "Actual size"], [4, 0x50, "Back"], [4, 0x4f, "Forward"],
  [4, 0x3d, "Close window"], [4, 0x2b, "Switch window"], [8, 0x07, "Show desktop"], [8, 0x08, "File Explorer"], [8, 0x0c, "Settings"],
  [8, 0x0f, "Lock computer"], [0x0a, 0x16, "Screen snip"], [8, 0x0a, "Xbox Game Bar"], [8, 0x37, "Emoji"], [3, 0x29, "Task Manager"],
];
const MAC_SHORTCUTS: readonly (readonly [number, number, string])[] = [
  [8, 0x06, "Copy"], [8, 0x19, "Paste"], [8, 0x1b, "Cut"], [8, 0x1d, "Undo"], [0x0a, 0x1d, "Redo"], [8, 0x04, "Select all"],
  [8, 0x16, "Save"], [8, 0x12, "Open"], [8, 0x11, "New"], [8, 0x09, "Find"], [8, 0x17, "New tab"], [8, 0x1a, "Close tab"],
  [8, 0x2e, "Zoom in"], [8, 0x2d, "Zoom out"], [8, 0x2c, "Spotlight"], [1, 0x52, "Mission Control"], [0x09, 0x14, "Lock screen"],
  [0x0a, 0x20, "Screenshot"], [0x0c, 0x29, "Force Quit"], [0x09, 0x2c, "Emoji"],
];

/** Choices of one category, as [value, action, English label]. */
function choices(category: Category, mac = false): { action: MchoseAction; label: string }[] {
  switch (category) {
    case "shortcut": return (mac ? MAC_SHORTCUTS : SHORTCUTS).map(([code1, code2, label]) => ({ action: { type: MCHOSE_ACTION_TYPE.key, code1, code2 }, label }));
    case "key": return [
      ...Object.entries(MCHOSE_USAGE_NAMES).map(([usage, label]) => ({ action: { type: MCHOSE_ACTION_TYPE.key, code1: 0, code2: Number(usage) }, label })),
      ...MODIFIER_USAGE_NAMES.map((label, bit) => ({ action: { type: MCHOSE_ACTION_TYPE.key, code1: 1 << bit, code2: 0 }, label })),
    ];
    case "mouse": return [
      ...Object.entries(MCHOSE_MOUSE_NAMES).map(([bit, label]) => ({ action: { type: MCHOSE_ACTION_TYPE.mouse, code1: Number(bit), code2: 0 }, label })),
      { action: { type: MCHOSE_ACTION_TYPE.wheel, code1: 0, code2: 1 }, label: "Wheel up" },
      { action: { type: MCHOSE_ACTION_TYPE.wheel, code1: 0, code2: 0xff }, label: "Wheel down" },
    ];
    case "media": return Object.entries(MCHOSE_MEDIA_NAMES).map(([usage, label]) => ({ action: mchoseMediaAction(Number(usage)), label }));
    case "system": return Object.entries(MCHOSE_SYSTEM_NAMES).map(([code, label]) => ({ action: { type: MCHOSE_ACTION_TYPE.system, code1: Number(code), code2: 0 }, label }));
    case "special": return Object.entries(MCHOSE_SPECIAL_NAMES).map(([value, label]) => ({ action: { type: MCHOSE_ACTION_TYPE.special, code1: Number(value) >> 8, code2: Number(value) & 0xff }, label }));
    case "macro": return Array.from({ length: MCHOSE_MACRO_COUNT }, (_, n) => ({ action: { type: MCHOSE_ACTION_TYPE.macro, code1: n, code2: 0 }, label: `Macro ${n + 1}` }));
    case "disabled": return [{ action: { type: MCHOSE_ACTION_TYPE.key, code1: 0, code2: 0 }, label: "Disabled" }];
    case "none": return [{ action: NONE, label: "\u2013" }];
  }
}

const actionKey = (action: MchoseAction): number => (action.type << 16) | (action.code1 << 8) | action.code2;
const KEYMAP_CATEGORIES: readonly Category[] = ["key", "shortcut", "mouse", "media", "system", "special", "macro", "disabled"];
/** Actions an advanced key can send: anything but a macro, or nothing. */
const ADVANCED_CATEGORIES: readonly Category[] = ["none", "key", "shortcut", "mouse", "media", "system", "special"];

/** Pick any action the keymap can hold: a key with modifiers, mouse, media, system, keyboard function, macro or nothing. */
export function ActionPicker({ id, locale, value, onChange, disabled, categories, mac }: {
  id: string;
  locale: InterfaceLocale;
  value: MchoseAction;
  onChange: (action: MchoseAction) => void;
  disabled: boolean;
  categories?: readonly Category[];
  /** Name modifiers as on a Mac layer. */
  mac?: boolean;
}): ReactNode {
  const allowed = categories ?? KEYMAP_CATEGORIES;
  const [category, setCategory] = useState<Category>(() => allowed.includes(categoryOf(value)) ? categoryOf(value) : allowed[0]!);
  // Follow the value's category, but stay on Shortcuts while the value is one of them.
  useEffect(() => {
    const inShortcuts = category === "shortcut" && choices("shortcut", mac).some(({ action }) => mchoseActionsEqual(action, value));
    if (!inShortcuts && allowed.includes(categoryOf(value))) setCategory(categoryOf(value));
  }, [actionKey(value)]);
  const list = useMemo(() => choices(category, mac), [category, mac]);
  const isKey = category === "key" && value.type === MCHOSE_ACTION_TYPE.key && value.code2 !== 0;
  const base = isKey ? { ...value, code1: 0 } : value;
  const options = list.map(({ action, label }) => ({ value: actionKey(action), label: displayText(locale, mac ? macName(label) : label) }));
  const selected = list.some(({ action }) => mchoseActionsEqual(action, base)) ? actionKey(base) : null;
  return (
    <div className="mchose-picker">
      <OptionMenu id={`${id}-category`} ariaLabel={t(locale, "kb.mchCategory")} value={category} disabled={disabled}
        options={allowed.map((entry) => ({ value: entry, label: t(locale, CATEGORY_LABEL[entry]) }))}
        onChange={(next) => {
          // Switching category only browses; picking an action is what changes the key. Categories with one choice pick it.
          setCategory(next);
          if (next === "none" || next === "disabled") onChange(choices(next, mac)[0]!.action);
        }} />
      {category === "none" ? null : <OptionMenu id={`${id}-action`} ariaLabel={t(locale, "kb.mchAction")} value={selected} disabled={disabled} options={options}
        onChange={(next) => {
          const action = list.find((entry) => actionKey(entry.action) === next)?.action;
          if (!action) return;
          // A plain key keeps the modifiers already chosen for it.
          onChange(isKey && action.code2 !== 0 ? { ...action, code1: value.code1 } : action);
        }} />}
      {category === "key" && value.code2 !== 0 ? (
        <div className="mchose-modifiers" role="group" aria-label={t(locale, "kb.mchModifiers")}>
          {MODIFIER_BITS.map((bit, n) => {
            const on = (value.code1 & bit) !== 0;
            return (
              <button key={bit} type="button" className={`om-btn is-sm mchose-chip${on ? " is-on" : ""}`} aria-pressed={on} disabled={disabled}
                onClick={() => onChange({ ...value, code1: on ? value.code1 & ~bit : value.code1 | bit })}>
                {displayText(locale, mac ? macName(MODIFIER_KEYS[n]!) : MODIFIER_KEYS[n])}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const LAYERS: readonly Parameters<typeof t>[1][] = ["kb.mchLayerWin", "kb.mchLayerWinFn", "kb.mchLayerMac", "kb.mchLayerMacFn"];

/** `baseOnly` greys out the Fn layers, where the vendor app does not offer advanced keys. */
function LayerSwitch({ locale, layer, onChange, disabled, baseOnly }: { locale: InterfaceLocale; layer: number; onChange: (layer: number) => void; disabled: boolean; baseOnly?: boolean }): ReactNode {
  return <Segmented id="mchose-layer" ariaLabel={t(locale, "kb.mchLayer")} value={layer} disabled={disabled}
    options={LAYERS.map((key, value) => ({ value, label: t(locale, key), disabled: baseOnly && value % 2 === 1 }))} onChange={onChange} />;
}

export function RemapCard({ locale, mchose, disabled }: { locale: InterfaceLocale; mchose: MchoseWorkspace; disabled: boolean }): ReactNode {
  const [layer, setLayer] = useState(0);
  const [index, setIndex] = useState<number | null>(null);
  const actions = mchose.keymap[layer] ?? [];
  const current = index === null ? null : actions[index] ?? null;
  const advanced = current !== null && current.type >= MCHOSE_ACTION_TYPE.dks && current.type <= MCHOSE_ACTION_TYPE.layerTap;
  // Every key of this layer that differs from the factory keymap, for "Restore this layer".
  const changedSlots = mchose.layout.flatMap(({ index: slot }) => {
    const factory = mchose.defaults[layer]?.[slot];
    return factory && actions[slot] && !mchoseActionsEqual(actions[slot]!, factory) ? [{ index: slot, action: factory }] : [];
  });
  const restoreLayer = async (): Promise<void> => {
    if (!window.confirm(t(locale, "kb.mchRestoreLayerConfirm"))) return;
    setIndex(null);
    await control.applyKeyboardCommand({ kind: "mchoseKeymap", layer, updates: changedSlots });
  };
  const assign = (action: MchoseAction): Promise<void> =>
    index === null ? Promise.resolve() : control.applyKeyboardCommand({ kind: "mchoseKeymap", layer, updates: [{ index, action }] });
  return (
    <article id="keyboard-bindings-card" className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.mchRemapTitle")}</h2>
        <small className="setting-note">{tp(locale, "kb.mchProfileScope", { n: mchose.profile + 1 })}</small>
      </div></div>
      <LayerSwitch locale={locale} layer={layer} disabled={disabled} onChange={(next) => { setLayer(next); setIndex(null); }} />
      <div className="keyboard-selection-actions">
        <button type="button" className="om-btn is-sm" disabled={disabled || !changedSlots.length} onClick={() => void restoreLayer()}>{t(locale, "kb.mchRestoreLayer")}</button>
      </div>
      {actions.length === 0 ? <p className="keyboard-empty">{t(locale, "kb.reading")}</p> : (
        <>
          <KeyDeck locale={locale} layout={mchose.layout} disabled={disabled} ariaLabel={t(locale, "kb.mchRemapTitle")}
            label={(key) => slotLabel(mchose, layer, key)}
            muted={(key) => (actions[key.index]?.type ?? 0) === 0}
            selected={new Set(index === null ? [] : [index])} onToggle={setIndex} />
          {current ? (
            <div className="mchose-editor">
              <p className="mchose-assigned">{tp(locale, "kb.mchAssigned", { action: displayText(locale, current.type === 0 ? "\u2013" : layer > 1 ? macName(actionName(current, "")) : actionName(current, "")) })}</p>
              {advanced ? <p className="setting-note">{t(locale, "kb.mchAdvancedHere")}</p> : null}
              <ActionPicker key={`${layer}:${index}`} id="mchose-remap" mac={layer > 1} locale={locale} value={advanced ? NONE : current} disabled={disabled}
                onChange={(action) => { if (!mchoseActionsEqual(action, current)) void assign(action); }} />
              <div className="mchose-apply">
                <button type="button" className="om-btn is-ghost" disabled={disabled} onClick={() => void control.applyKeyboardCommand({ kind: "mchoseAdvancedClear", layer, index: index! })}>{t(locale, "kb.mchRestoreKey")}</button>
              </div>
            </div>
          ) : <p className="keyboard-empty">{t(locale, "kb.mchSelectKey")}</p>}
        </>
      )}
    </article>
  );
}

type AdvancedKind = "dks" | "modTap" | "toggle" | "snapTap" | "socd";
const ADVANCED_TYPE: Record<AdvancedKind, number> = {
  dks: MCHOSE_ACTION_TYPE.dks, modTap: MCHOSE_ACTION_TYPE.modTap, toggle: MCHOSE_ACTION_TYPE.toggle,
  snapTap: MCHOSE_ACTION_TYPE.snapTap, socd: MCHOSE_ACTION_TYPE.socd,
};
const isPairKind = (kind: AdvancedKind): kind is "snapTap" | "socd" => kind === "snapTap" || kind === "socd";

/** Slots the profile's four layers point at; mod-tap, rapid snap, SOCD and layer-tap share one table. */
function slotsUsed(keymap: MchoseWorkspace["keymap"]): { dks: number; toggle: number; shared: number } {
  const used = { dks: new Set<number>(), toggle: new Set<number>(), shared: new Set<number>() };
  for (const action of keymap.flat()) {
    const table = action.type === MCHOSE_ACTION_TYPE.dks ? used.dks : action.type === MCHOSE_ACTION_TYPE.toggle ? used.toggle
      : action.type >= MCHOSE_ACTION_TYPE.modTap && action.type <= MCHOSE_ACTION_TYPE.layerTap ? used.shared : null;
    table?.add(action.code1);
  }
  return { dks: used.dks.size, toggle: used.toggle.size, shared: used.shared.size };
}
const SOCD_RULES: readonly { value: number; label: Parameters<typeof t>[1]; note: Parameters<typeof t>[1] }[] = [
  { value: 0, label: "kb.mchSocdLast", note: "kb.mchSocdLastNote" },
  { value: 1, label: "kb.mchSocdFirst", note: "kb.mchSocdFirstNote" },
  { value: 2, label: "kb.mchSocdSecond", note: "kb.mchSocdSecondNote" },
  { value: 3, label: "kb.mchSocdCancel", note: "kb.mchSocdCancelNote" },
];
const ZONES: readonly Parameters<typeof t>[1][] = ["kb.mchDksZone1", "kb.mchDksZone2", "kb.mchDksZone3", "kb.mchDksZone4"];
const emptyDks = (): MchoseDks => ({
  points: [...MCHOSE_DKS_DEFAULT_POINTS],
  actions: [0, 1, 2, 3].map(() => ({ action: { ...NONE }, zones: [0, 0, 0, 0] })) as MchoseDks["actions"],
});

function DksEditor({ locale, value, onChange, disabled, mac }: { locale: InterfaceLocale; value: MchoseDks; onChange: (dks: MchoseDks) => void; disabled: boolean; mac: boolean }): ReactNode {
  const setAction = (n: number, patch: Partial<MchoseDksAction>): void =>
    onChange({ ...value, actions: value.actions.map((entry, i) => (i === n ? { ...entry, ...patch } : entry)) as MchoseDks["actions"] });
  // Clicking a point cycles how long the action stays held from there: off, then 1 to the points left.
  const cycle = (n: number, zone: number): void => {
    const entry = value.actions[n]!;
    const max = zone === 3 ? 1 : 4 - zone;
    const next = entry.zones[zone]! >= max ? 0 : entry.zones[zone]! + 1;
    setAction(n, { zones: entry.zones.map((v, i) => (i === zone ? next : v)) as MchoseDksAction["zones"] });
  };
  return (
    <div className="mchose-dks">
      <p className="setting-note">{t(locale, "kb.mchDksNote")}</p>
      <div className="mchose-dks-points">
        {value.points.map((point, n) => (
          <SliderField unit="mm" key={n} id={`mchose-dks-point-${n}`} label={t(locale, ZONES[n]!)} value={point / 10} min={0.1} max={3.4} step={0.1}
            scale={["0.1", "", "3.4"]} formatValue={(mm) => `${mm.toFixed(1)} mm`} disabled={disabled}
            onCommit={(mm) => onChange({ ...value, points: value.points.map((p, i) => (i === n ? Math.round(mm * 10) : p)) as MchoseDks["points"] })} />
        ))}
      </div>
      <div className="mchose-dks-grid" role="group" aria-label={t(locale, "kb.mchDks")}>
        <span />
        {ZONES.map((zone) => <span key={zone} className="mchose-dks-head">{t(locale, zone)}</span>)}
        {value.actions.map((entry, n) => (
          <div className="mchose-dks-row" key={n}>
            <div className="mchose-dks-action">
              <h4>{tp(locale, "kb.mchDksAction", { n: n + 1 })}</h4>
              <ActionPicker id={`mchose-dks-${n}`} mac={mac} locale={locale} value={entry.action} disabled={disabled} categories={ADVANCED_CATEGORIES} onChange={(action) => setAction(n, { action })} />
            </div>
            <div className="mchose-dks-track">
              {entry.zones.map((span, zone) => span > 0 ? (
                <span key={`bar-${zone}`} className="mchose-dks-bar" style={{ gridColumn: `${zone + 1} / span ${Math.min(span, 4 - zone)}` }} aria-hidden="true" />
              ) : null)}
              {entry.zones.map((span, zone) => (
                <button key={zone} type="button"
                  className={`mchose-dks-cell${span > 0 ? " is-on" : entry.zones.some((s, z) => z < zone && s > zone - z) ? " is-covered" : ""}`} style={{ gridColumn: zone + 1 }} disabled={disabled}
                  aria-label={span > 0 ? tp(locale, "kb.mchDksHold", { zone: t(locale, ZONES[zone]!), n: span }) : tp(locale, "kb.mchDksOff", { zone: t(locale, ZONES[zone]!) })}
                  title={span > 0 ? tp(locale, "kb.mchDksHold", { zone: t(locale, ZONES[zone]!), n: span }) : tp(locale, "kb.mchDksOff", { zone: t(locale, ZONES[zone]!) })}
                  onClick={() => cycle(n, zone)}>
                  {span > 0 ? span : entry.zones.some((held, from) => from < zone && held > zone - from) ? "" : "\u2013"}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdvancedCard({ locale, mchose, disabled }: { locale: InterfaceLocale; mchose: MchoseWorkspace; disabled: boolean }): ReactNode {
  const [layer, setLayer] = useState(0);
  const [index, setIndex] = useState<number | null>(null);
  const actions = mchose.keymap[layer] ?? [];
  const current = index === null ? null : actions[index] ?? null;
  const existing = (Object.keys(ADVANCED_TYPE) as AdvancedKind[]).find((kind) => current?.type === ADVANCED_TYPE[kind]) ?? null;
  const [kind, setKind] = useState<AdvancedKind>("dks");
  const advanced = mchose.advanced;
  const slot = current && existing ? current.code1 : null;
  const [dks, setDks] = useState<MchoseDks>(emptyDks);
  const [tap, setTap] = useState<MchoseAction>(NONE);
  const [hold, setHold] = useState<MchoseAction>(NONE);
  const [holdMs, setHoldMs] = useState(200);
  const [toggle, setToggle] = useState<MchoseAction>(NONE);
  const [partner, setPartner] = useState<number | null>(null);
  const [rule, setRule] = useState(0);
  useEffect(() => {
    if (existing) setKind(existing);
    const stored = advanced && slot !== null ? advanced : null;
    setDks(existing === "dks" && stored ? stored.dks[slot!] ?? emptyDks() : emptyDks());
    setTap(existing === "modTap" && stored ? stored.modTap[slot!]?.tap ?? NONE : NONE);
    setHold(existing === "modTap" && stored ? stored.modTap[slot!]?.hold ?? NONE : NONE);
    setHoldMs(existing === "modTap" && current ? current.code2 * 10 || 200 : 200);
    setToggle(existing === "toggle" && stored ? stored.toggle[slot!] ?? NONE : NONE);
    setPartner(existing && isPairKind(existing) && current ? current.code2 : null);
    setRule(existing === "socd" && index !== null ? mchose.travel[index]?.priority ?? 0 : 0);
  }, [index, layer, current ? actionKey(current) : -1, advanced]);
  const save = (): Promise<void> => {
    if (index === null) return Promise.resolve();
    if (isPairKind(kind)) {
      if (partner === null) return Promise.resolve();
      return control.applyKeyboardCommand({ kind: "mchosePair", layer, first: index, second: partner, pair: kind, priority: kind === "socd" ? rule : 0 });
    }
    const binding = kind === "dks" ? { kind, dks } as const
      : kind === "modTap" ? { kind, entry: { tap, hold }, holdMs } as const
        : { kind, action: toggle } as const;
    return control.applyKeyboardCommand({ kind: "mchoseAdvanced", layer, index, binding });
  };
  const bound = new Set(actions.flatMap((action, slotIndex) => action.type >= MCHOSE_ACTION_TYPE.dks && action.type <= MCHOSE_ACTION_TYPE.layerTap ? [slotIndex] : []));
  const layerTap = current?.type === MCHOSE_ACTION_TYPE.layerTap;
  const keyName = (slotIndex: number): string => mchose.layout.find((key) => key.index === slotIndex)?.label ?? String(slotIndex);
  return (
    <article className="setting-card keyboard-workspace-card is-wide">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.mchAdvancedTitle")}</h2>
        <small className="setting-note">{t(locale, "kb.mchAdvancedNote")}</small>
        <small className="setting-note">{tp(locale, "kb.mchSlotsUsed", slotsUsed(mchose.keymap))}</small>
      </div></div>
      <LayerSwitch locale={locale} layer={layer} disabled={disabled} baseOnly onChange={(next) => { setLayer(next); setIndex(null); }} />
      <KeyDeck locale={locale} layout={mchose.layout} disabled={disabled} ariaLabel={t(locale, "kb.mchAdvancedTitle")}
        label={(key) => slotLabel(mchose, layer, key, bound.has(key.index) ? undefined : actions[key.index])} sub={(key) => (bound.has(key.index) ? actionName(actions[key.index], "") : null)}
        muted={(key) => !bound.has(key.index)}
        selected={new Set(index === null ? [] : isPairKind(kind) && partner !== null ? [index, partner] : [index])} onToggle={setIndex} />
      {/* Every binding on this layer, as the vendor app lists them; a click selects the key. */}
      {bound.size ? (
        <>
          <h4>{tp(locale, "kb.mchBindingsOnLayer", { n: bound.size })}</h4>
          <ul className="wooting-akc-list">
            {[...bound].map((slot) => (
              <li key={slot}>
                <button type="button" className="om-btn is-ghost is-sm" disabled={disabled} onClick={() => setIndex(slot)}>{displayText(locale, keyName(slot))}</button>
                <span>{displayText(locale, actionName(actions[slot], ""))}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {index === null ? <p className="keyboard-empty">{t(locale, "kb.mchSelectKey")}</p> : (
        <>
          {layerTap ? <p className="setting-note">{tp(locale, "kb.mchLayerTapKept", { key: displayText(locale, keyName(current!.code2)) })}</p> : null}
          <Segmented id="mchose-advanced-kind" ariaLabel={t(locale, "kb.mchAdvancedKind")} value={kind} disabled={disabled}
            options={[
              { value: "dks", label: t(locale, "kb.mchDks") }, { value: "modTap", label: t(locale, "kb.mchModTap") }, { value: "toggle", label: t(locale, "kb.mchToggle") },
              { value: "snapTap", label: t(locale, "kb.mchSnapTap") }, { value: "socd", label: displayText(locale, "SOCD") },
            ]}
            onChange={setKind} />
          {kind === "dks" ? <DksEditor mac={layer > 1} locale={locale} value={dks} onChange={setDks} disabled={disabled} /> : null}
          {kind === "modTap" ? (
            <div className="mchose-editor">
              <p className="setting-note">{t(locale, "kb.mchModTapNote")} {t(locale, "kb.mchModTapModifierNote")}</p>
              <div className="mchose-pair">
                <section><h4>{t(locale, "kb.mchTap")}</h4>
                  <ActionPicker id="mchose-mt-tap" mac={layer > 1} locale={locale} value={tap} onChange={setTap} disabled={disabled} categories={ADVANCED_CATEGORIES} /></section>
                <section><h4>{t(locale, "kb.mchHold")}</h4>
                  <ActionPicker id="mchose-mt-hold" mac={layer > 1} locale={locale} value={hold} onChange={setHold} disabled={disabled} categories={ADVANCED_CATEGORIES} /></section>
              </div>
              <SliderField unit="ms" id="mchose-mt-time" label={t(locale, "kb.mchHoldTime")} value={holdMs} min={MCHOSE_MOD_TAP_HOLD_RANGE_MS.min} max={MCHOSE_MOD_TAP_HOLD_RANGE_MS.max}
                step={10} scale={["10", "", "2550"]} formatValue={(ms) => `${ms} ms`} disabled={disabled} onCommit={setHoldMs} />
            </div>
          ) : null}
          {isPairKind(kind) ? (
            <div className="mchose-editor">
              <p className="setting-note">{t(locale, kind === "socd" ? "kb.mchSocdNote" : "kb.mchSnapTapNote")}</p>
              <div className="mchose-picker">
                <OptionMenu id="mchose-pair-first" ariaLabel={t(locale, "kb.mchPairFirst")} value={index} disabled
                  options={[{ value: index, label: tp(locale, "kb.mchPairFirstValue", { key: displayText(locale, keyName(index)) }) }]} onChange={() => undefined} />
                <OptionMenu id="mchose-pair-second" ariaLabel={t(locale, "kb.mchPairSecond")} value={partner} disabled={disabled}
                  options={mchose.layout.filter((key) => key.index !== index).map((key) => ({ value: key.index, label: tp(locale, "kb.mchPairSecondValue", { key: displayText(locale, key.label) }) }))}
                  onChange={setPartner} />
              </div>
              {kind === "socd" ? (
                <div className="mchose-rules" role="radiogroup" aria-label={t(locale, "kb.mchSocdRule")}>
                  {SOCD_RULES.map((entry) => (
                    <button key={entry.value} type="button" role="radio" aria-checked={rule === entry.value} disabled={disabled}
                      className={`mchose-rule${rule === entry.value ? " is-on" : ""}`} onClick={() => setRule(entry.value)}>
                      <span>{t(locale, entry.label)}</span>
                      <small>{t(locale, entry.note)}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {kind === "toggle" ? (
            <div className="mchose-editor">
              <p className="setting-note">{t(locale, "kb.mchToggleNote")}</p>
              <ActionPicker id="mchose-tgl" mac={layer > 1} locale={locale} value={toggle} onChange={setToggle} disabled={disabled} categories={ADVANCED_CATEGORIES} />
            </div>
          ) : null}
          <div className="mchose-apply">
            {existing ? <button type="button" className="om-btn is-ghost" disabled={disabled} onClick={() => void control.applyKeyboardCommand({ kind: "mchoseAdvancedClear", layer, index })}>{t(locale, "kb.mchAdvancedRemove")}</button> : null}
            <button type="button" className="om-btn is-primary" disabled={disabled || (isPairKind(kind) && partner === null)} onClick={() => void save()}>{t(locale, "kb.mchApply")}</button>
          </div>
        </>
      )}
    </article>
  );
}

/**
 * Key test: lights up keys as the computer receives them, so a remapped key
 * shows what it sends. Runs only in the browser; nothing is written.
 */
/** The HID usage a plain key action sends: its key, or the one modifier it holds. */
function sentUsage(action: MchoseAction | undefined): number | null {
  if (!action || action.type !== MCHOSE_ACTION_TYPE.key) return null;
  if (action.code2) return action.code2;
  const bit = MODIFIER_BITS_ALL.indexOf(action.code1);
  return bit >= 0 ? 0xe0 + bit : null;
}
const MODIFIER_BITS_ALL = [1, 2, 4, 8, 16, 32, 64, 128];

export function KeyTestCard({ locale, mchose }: { locale: InterfaceLocale; mchose: MchoseWorkspace; disabled: boolean }): ReactNode {
  const [down, setDown] = useState<ReadonlySet<number>>(new Set());
  const [log, setLog] = useState<readonly { label: string; down: boolean }[]>([]);
  // Match what the computer receives to the key that sends it on the layer in use (Win and Alt swap on the Mac layers).
  const layer = mchose.settings?.macMode ? 2 : 0;
  // Every key sending a usage lights for it; a key remapped to a macro or media action no longer answers for its own key.
  const byUsage = useMemo(() => {
    const keys = new Map<number, MchoseLayoutKey[]>();
    for (const key of mchose.layout) {
      const action = mchose.keymap[layer]?.[key.index];
      const usage = !action || action.type === 0 ? key.usage : sentUsage(action);
      if (usage !== null) keys.set(usage, [...(keys.get(usage) ?? []), key]);
    }
    return keys;
  }, [mchose.layout, mchose.keymap, layer]);
  useEffect(() => {
    // The keys each press lit, so its release clears the same ones even if the keymap changed in between.
    const lit = new Map<string, number[]>();
    const handle = (pressed: boolean) => (event: KeyboardEvent) => {
      // Typing in a field (a profile name, a macro delay) is not a key test.
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
      const usage = MODIFIER_CODES[event.code] ?? hidKeyForCode(event.code);
      const keys = usage === null || usage === undefined ? [] : byUsage.get(usage) ?? [];
      const label = keys[0] ? deckLabel(mchose, keys[0]) : event.code;
      if (event.repeat) return;
      const indexes = pressed ? keys.map((key) => key.index) : lit.get(event.code) ?? [];
      if (pressed) lit.set(event.code, indexes); else lit.delete(event.code);
      setDown((current) => {
        const next = new Set(current);
        for (const index of indexes) { if (pressed) next.add(index); else next.delete(index); }
        return next;
      });
      setLog((current) => [{ label, down: pressed }, ...current].slice(0, 12));
    };
    const keydown = handle(true);
    const keyup = handle(false);
    const clear = (): void => setDown(new Set());
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", clear);
    return () => { window.removeEventListener("keydown", keydown); window.removeEventListener("keyup", keyup); window.removeEventListener("blur", clear); };
  }, [byUsage, mchose]);
  return (
    <article className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.mchTesterTitle")}</h2>
        <small className="setting-note">{t(locale, "kb.mchTesterNote")}</small>
      </div></div>
      <KeyDeck locale={locale} layout={mchose.layout} disabled={false} ariaLabel={t(locale, "kb.mchTesterTitle")}
        label={(key) => deckLabel(mchose, key)} selected={down} onToggle={() => undefined} />
      <ol className="mchose-test-log" aria-live="polite">
        {log.length === 0 ? <li className="setting-note">{t(locale, "kb.mchTesterEmpty")}</li> : log.map((entry, n) => (
          <li key={n} className={entry.down ? "is-down" : ""}>
            {displayText(locale, `${keycapLabel(entry.label)} ${entry.down ? "\u2193" : "\u2191"}`)}
          </li>
        ))}
      </ol>
    </article>
  );
}

const MODIFIER_CODES: Readonly<Record<string, number>> = {
  ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3, ControlRight: 0xe4, ShiftRight: 0xe5, AltRight: 0xe6, MetaRight: 0xe7,
};
const MOUSE_BITS: Readonly<Record<number, number>> = { 0: 0x01, 1: 0x04, 2: 0x02, 3: 0x08, 4: 0x10 };

function stepLabel(locale: InterfaceLocale, step: MchoseMacroStep): string {
  if (step.kind === "mouse") return MCHOSE_MOUSE_NAMES[step.code] ?? `Mouse ${step.code}`;
  if (step.code === 0) return t(locale, "kb.mchMacroWait");
  const modifier = MODIFIER_USAGES.indexOf(step.code);
  return modifier >= 0 ? MODIFIER_USAGE_NAMES[modifier]! : MCHOSE_USAGE_NAMES[step.code] ?? `Key 0x${step.code.toString(16)}`;
}

export function MacroCard({ locale, mchose, disabled }: { locale: InterfaceLocale; mchose: MchoseWorkspace; disabled: boolean }): ReactNode {
  const stored = mchose.macros;
  const [slot, setSlot] = useState(0);
  const [draft, setDraft] = useState<MchoseMacro[] | null>(stored ? stored.map((macro) => ({ ...macro, steps: [...macro.steps] })) : null);
  const [recording, setRecording] = useState(false);
  const last = useRef(0);
  const confirmed = JSON.stringify(stored);
  useEffect(() => setDraft(stored ? stored.map((macro) => ({ ...macro, steps: [...macro.steps] })) : null), [confirmed]);
  const macro = draft?.[slot];
  const edit = (next: MchoseMacro): void => setDraft((current) => current && current.map((entry, i) => (i === slot ? next : entry)));
  const push = (step: Omit<MchoseMacroStep, "delayMs">, at: number): void => {
    // The wait before this step belongs to the previous one; measure it at the event.
    const wait = last.current > 0 ? Math.min(65535, Math.round(at - last.current)) : null;
    last.current = at;
    setDraft((current) => {
      if (!current) return current;
      const steps = [...current[slot]!.steps];
      if (wait !== null && steps.length > 0) steps[steps.length - 1] = { ...steps[steps.length - 1]!, delayMs: wait };
      steps.push({ ...step, delayMs: 0 });
      return current.map((entry, i) => (i === slot ? { ...entry, steps } : entry));
    });
  };
  useEffect(() => {
    if (!recording) return;
    last.current = 0;
    // Keys pressed while recording; a release is recorded only for one of these, so no step lacks its press.
    const held = new Set<number>();
    const key = (down: boolean) => (event: KeyboardEvent) => {
      if (event.repeat) return;
      const code = MODIFIER_CODES[event.code] ?? hidKeyForCode(event.code);
      if (code === null || code === undefined) return;
      if (down) {
        // Typing in a field (a delay, a name) is not part of the macro.
        if ((event.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
        held.add(code);
      } else if (!held.delete(code)) return;
      event.preventDefault();
      push({ kind: "key", code, down }, event.timeStamp);
    };
    const keydown = key(true);
    const keyup = key(false);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      // Keys still held when recording stops get their release, so no press is left open.
      for (const code of held) push({ kind: "key", code, down: false }, performance.now());
    };
  }, [recording, slot]);
  const changed = draft !== null && JSON.stringify(draft) !== confirmed;
  const setStep = (n: number, patch: Partial<MchoseMacroStep>): void => macro && edit({ ...macro, steps: macro.steps.map((step, i) => (i === n ? { ...step, ...patch } : step)) });
  return (
    <article className="setting-card keyboard-workspace-card is-wide">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.mchMacroTitle")}</h2>
        <small className="setting-note">{t(locale, "kb.mchMacroNote")}</small>
      </div></div>
      {!draft || !macro ? <p className="keyboard-empty">{t(locale, "kb.reading")}</p> : (
        <>
          <div className="mchose-picker">
          <OptionMenu id="mchose-macro-slot" ariaLabel={t(locale, "kb.mchMacroSlot")} value={slot} disabled={disabled || recording}
            options={draft.map((entry, n) => ({ value: n, label: tp(locale, entry.steps.length ? "kb.mchMacroN" : "kb.mchMacroEmpty", { n: n + 1 }) }))} onChange={setSlot} />
          <OptionMenu id="mchose-macro-mode" ariaLabel={t(locale, "kb.mchMacroMode")} value={macro.mode} disabled={disabled}
            options={[
              { value: MCHOSE_MACRO_MODE.whileHeld, label: t(locale, "kb.mchMacroWhileHeld") },
              { value: MCHOSE_MACRO_MODE.once, label: t(locale, "kb.mchMacroOnce") },
              { value: MCHOSE_MACRO_MODE.toggle, label: t(locale, "kb.mchMacroToggle") },
            ]}
            onChange={(mode) => edit({ ...macro, mode })} />
          </div>
          <ol className="mchose-macro-steps">
            {macro.steps.map((step, n) => (
              <li key={n} className="mchose-macro-step">
                <span className="mchose-step-index">{n + 1}</span>
                <span className="mchose-step-name">{displayText(locale, stepLabel(locale, step))}</span>
                <Segmented id={`mchose-step-${n}-dir`} ariaLabel={t(locale, "kb.mchMacroDirection")} value={step.down ? 1 : 0} disabled={disabled || step.code === 0}
                  options={[{ value: 1, label: t(locale, "kb.mchMacroDown") }, { value: 0, label: t(locale, "kb.mchMacroUp") }]} onChange={(dir) => setStep(n, { down: dir === 1 })} />
                <label className="mchose-delay">
                  <span>{t(locale, "kb.mchMacroDelay")}</span>
                  <input type="number" min={0} max={65535} step={1} value={step.delayMs} disabled={disabled}
                    onChange={(event) => setStep(n, { delayMs: Math.max(0, Math.min(65535, Math.round(Number(event.currentTarget.value) || 0))) })} />
                  <span className="mchose-unit">{"ms"}</span>
                </label>
                <button type="button" className="om-btn is-sm is-ghost" disabled={disabled} aria-label={t(locale, "kb.mchMacroRemoveStep")}
                  onClick={() => edit({ ...macro, steps: macro.steps.filter((_, i) => i !== n) })}>{t(locale, "kb.mchMacroRemoveStep")}</button>
              </li>
            ))}
          </ol>
          {macro.steps.length === 0 ? <p className="keyboard-empty">{t(locale, "kb.mchMacroNoSteps")}</p> : null}
          <div className="keyboard-selection-actions">
            <button type="button" className={`om-btn is-sm${recording ? " is-danger" : ""}`} aria-pressed={recording} disabled={disabled} onClick={() => setRecording(!recording)}>{t(locale, recording ? "kb.mchMacroStop" : "kb.mchMacroRecord")}</button>
            <button type="button" className="om-btn is-sm" disabled={disabled || recording}
              onClick={() => edit({ ...macro, steps: [...macro.steps, { kind: "key", code: 0, down: false, delayMs: 100 }] })}>{t(locale, "kb.mchMacroAddDelay")}</button>
            {[0, 2, 1].map((button) => (
              <button key={button} type="button" className="om-btn is-sm" disabled={disabled || recording}
                onClick={() => edit({ ...macro, steps: [...macro.steps, { kind: "mouse", code: MOUSE_BITS[button]!, down: true, delayMs: 20 }, { kind: "mouse", code: MOUSE_BITS[button]!, down: false, delayMs: 0 }] })}>
                {displayText(locale, `+ ${MCHOSE_MOUSE_NAMES[MOUSE_BITS[button]!]}`)}
              </button>
            ))}
            <button type="button" className="om-btn is-sm" disabled={disabled || recording || macro.steps.length === 0} onClick={() => edit({ ...macro, steps: [] })}>{t(locale, "kb.mchMacroClear")}</button>
          </div>
          {recording ? <p className="setting-note">{t(locale, "kb.mchMacroRecording")}</p> : null}
          <div className="mchose-apply">
            <button type="button" className="om-btn is-primary" disabled={disabled || recording || !changed} onClick={() => void control.applyKeyboardCommand({ kind: "mchoseMacros", macros: draft })}>{t(locale, "kb.mchApply")}</button>
          </div>
        </>
      )}
    </article>
  );
}


function ZoneEditor({ id, locale, zone, effects, onChange, disabled, direction, onDirection }: {
  id: string;
  locale: InterfaceLocale;
  zone: MchoseLightZone;
  effects: readonly MchoseEffect[];
  onChange: (zone: MchoseLightZone) => void;
  disabled: boolean;
  direction?: number;
  onDirection?: (direction: number) => void;
}): ReactNode {
  const effect = effects.find((entry) => entry.value === zone.effect);
  const known = effect !== undefined;
  return (
    <div className="keyboard-fields">
      <OptionMenu id={`${id}-effect`} ariaLabel={t(locale, "kb.mchEffect")} value={known ? zone.effect : null} disabled={disabled}
        options={effects.map((entry) => ({ value: entry.value, label: displayText(locale, entry.name) }))} onChange={(next) => onChange({ ...zone, effect: next })} />
      {!known ? <p className="setting-note">{tp(locale, "kb.mchEffectRaw", { n: zone.effect })}</p> : null}
      <StepperSlider id={`${id}-brightness`} label={t(locale, "kb.mchBrightness")} value={zone.brightness} min={0} max={MCHOSE_BRIGHTNESS_MAX} step={1}
        scale={["0", "", String(MCHOSE_BRIGHTNESS_MAX)]} formatValue={(v) => `${v}%`} disabled={disabled} onCommit={(brightness) => onChange({ ...zone, brightness })} />
      {effect?.speed !== false ? (
        <StepperSlider id={`${id}-speed`} label={t(locale, "kb.mchSpeed")} value={zone.speed} min={0} max={MCHOSE_SPEED_MAX} step={1}
          scale={["0", "", String(MCHOSE_SPEED_MAX)]} formatValue={(v) => String(v + 1)} disabled={disabled} onCommit={(speed) => onChange({ ...zone, speed })} />
      ) : null}
      {effect?.direction && direction !== undefined && onDirection ? (
        <SwitchRow id={`${id}-direction`} label={t(locale, "kb.mchReverse")} value={direction !== 0} disabled={disabled} onChange={(on) => onDirection(on ? 1 : 0)} />
      ) : null}
      {effect?.color !== false ? (
        <>
          <SwitchRow id={`${id}-rainbow`} label={t(locale, "kb.mchRainbow")} value={zone.rainbow} disabled={disabled} onChange={(rainbow) => onChange({ ...zone, rainbow })} />
          {!zone.rainbow ? <ColorPicker id={`${id}-color`} ariaLabel={t(locale, "kb.mchColor")} disabled={disabled} value={mchoseRgbToHex(zone.color)} onChange={(hex) => onChange({ ...zone, color: mchoseHexToRgb(hex) })} /> : null}
        </>
      ) : null}
    </div>
  );
}

export function LightingCard({ locale, mchose, disabled }: { locale: InterfaceLocale; mchose: MchoseWorkspace; disabled: boolean }): ReactNode {
  const lighting = mchose.lighting;
  const [draft, setDraft] = useState(lighting);
  const confirmed = JSON.stringify(lighting);
  useEffect(() => setDraft(lighting), [confirmed]);
  const changed = draft !== null && JSON.stringify(draft) !== confirmed;
  return (
    <article id="keyboard-lighting-card" className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.mchLightTitle")}</h2>
        <small className="setting-note">{tp(locale, "kb.mchProfileScope", { n: mchose.profile + 1 })}</small>
      </div></div>
      {!draft ? <p className="keyboard-empty">{t(locale, "kb.reading")}</p> : (
        <>
          <div className="arbiter-light-grid">
            <section className="keyboard-tuning-group">
              <h4>{t(locale, "kb.mchBacklight")}</h4>
              <ZoneEditor id="mchose-main" locale={locale} zone={draft.main} effects={mchoseModel(mchose.product.productId)!.effects.main} disabled={disabled}
                onChange={(main) => setDraft({ ...draft, main: { ...main, direction: draft.main.direction } })}
                direction={draft.main.direction} onDirection={(direction) => setDraft({ ...draft, main: { ...draft.main, direction } })} />
            </section>
            {mchoseModel(mchose.product.productId)!.effects.side ? <section className="keyboard-tuning-group">
              <h4>{t(locale, "kb.mchSideLight")}</h4>
              <ZoneEditor id="mchose-side" locale={locale} zone={draft.side} effects={mchoseModel(mchose.product.productId)!.effects.side!} disabled={disabled}
                onChange={(side) => setDraft({ ...draft, side })} />
            </section> : null}
          </div>
          <div className="mchose-apply">
            <button type="button" className="om-btn is-primary" disabled={disabled || !changed} onClick={() => void control.applyKeyboardCommand({ kind: "mchoseLighting", lighting: draft })}>{t(locale, "kb.mchApply")}</button>
          </div>
        </>
      )}
    </article>
  );
}

const GRADIENT_ANGLES = [{ value: 0, label: "\u2192" }, { value: 90, label: "\u2193" }, { value: 45, label: "\u2198" }, { value: 315, label: "\u2197" }];

/** A gradient bar like an image editor's: click to add a stop, drag stops to move them, pick each stop's colour. */
function GradientEditor({ locale, disabled, onPaint }: { locale: InterfaceLocale; disabled: boolean; onPaint: (stops: readonly MchoseGradientStop[], angle: number) => void }): ReactNode {
  const [stops, setStops] = useState<MchoseGradientStop[]>(() => MCHOSE_DEFAULT_GRADIENT.map((stop) => ({ ...stop })));
  const [active, setActive] = useState(0);
  const [angle, setAngle] = useState(0);
  const bar = useRef<HTMLDivElement | null>(null);
  const placeAt = (clientX: number): number => {
    const box = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width));
  };
  const update = (n: number, patch: Partial<MchoseGradientStop>): void => setStops((current) => current.map((stop, i) => (i === n ? { ...stop, ...patch } : stop)));
  const css = [...stops].sort((a, b) => a.at - b.at).map((stop) => `${stop.color} ${Math.round(stop.at * 1000) / 10}%`).join(", ");
  return (
    <div className="mchose-gradient-editor">
      <h4>{t(locale, "kb.mchGradientTitle")}</h4>
      <small className="setting-note">{t(locale, "kb.mchGradientNote")}</small>
      <div ref={bar} className="mchose-gradient" style={{ "--gradient": `linear-gradient(90deg, ${css})` } as CSSProperties}
        onPointerDown={(event) => {
          if (disabled || event.target !== event.currentTarget) return;
          const at = placeAt(event.clientX);
          setStops((current) => [...current, { at, color: mchoseRgbToHex(mchoseGradientColor(current, at)) }]);
          setActive(stops.length);
        }}>
        {stops.map((stop, n) => (
          <button key={n} type="button" disabled={disabled} className={`mchose-gradient-stop${n === active ? " is-on" : ""}`}
            style={{ insetInlineStart: `${stop.at * 100}%`, "--swatch": stop.color } as CSSProperties}
            aria-label={tp(locale, "kb.mchGradientStop", { n: n + 1, at: Math.round(stop.at * 100) })} aria-pressed={n === active}
            onPointerDown={(event) => { setActive(n); event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) update(n, { at: placeAt(event.clientX) }); }}
            onKeyDown={(event) => {
              const step = event.key === "ArrowLeft" ? -0.01 : event.key === "ArrowRight" ? 0.01 : 0;
              if (step) { event.preventDefault(); update(n, { at: Math.min(1, Math.max(0, stop.at + step)) }); }
            }} />
        ))}
      </div>
      <div className="mchose-color-row">
        <div className="arbiter-palette">
          <ColorPicker id="mchose-gradient-color" ariaLabel={t(locale, "kb.mchColor")} disabled={disabled} value={stops[active]?.color ?? MCHOSE_DEFAULT_KEY_COLOR} onChange={(color) => update(active, { color })} />
        </div>
        <div className="keyboard-selection-actions">
          <Segmented id="mchose-gradient-angle" ariaLabel={t(locale, "kb.mchGradientDirection")} value={angle} disabled={disabled}
            options={GRADIENT_ANGLES.map((entry) => ({ value: entry.value, label: entry.label }))} onChange={setAngle} />
          <button type="button" className="om-btn is-sm" disabled={disabled || stops.length < 3}
            onClick={() => { setStops((current) => current.filter((_, i) => i !== active)); setActive(0); }}>{t(locale, "kb.mchGradientRemove")}</button>
          <button type="button" className="om-btn is-primary" disabled={disabled} onClick={() => onPaint(stops, angle)}>{t(locale, "kb.mchGradientPaint")}</button>
        </div>
      </div>
    </div>
  );
}

export function KeyColorCard({ locale, mchose, disabled }: { locale: InterfaceLocale; mchose: MchoseWorkspace; disabled: boolean }): ReactNode {
  const colors = mchose.colors;
  const [selected, setSelected] = useState<readonly number[]>([]);
  const [color, setColor] = useState(MCHOSE_DEFAULT_KEY_COLOR);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const toggle = (index: number): void => setSelected((current) => current.includes(index) ? current.filter((i) => i !== index) : [...current, index]);
  const custom = mchose.lighting?.main.effect === 0;
  const setColors = (updates: { index: number; color: MchoseRgb }[]): Promise<boolean> => control.runKeyboardCommand({ kind: "mchoseKeyColors", updates });
  const paint = async (stops: readonly MchoseGradientStop[], angle: number): Promise<void> => {
    const keys = selected.length ? mchose.layout.filter((key) => chosen.has(key.index)) : mchose.layout;
    if (!(await setColors(mchoseGradientKeys(keys, stops, angle)))) return;
    // Per-key colours only show with the Custom effect.
    const lighting = mchose.lighting;
    if (lighting && !custom) await control.applyKeyboardCommand({ kind: "mchoseLighting", lighting: { ...lighting, main: { ...lighting.main, effect: 0 } } });
  };
  return (
    <article className="setting-card keyboard-workspace-card is-wide">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.mchKeyColorsTitle")}</h2>
        <small className="setting-note">{t(locale, custom ? "kb.mchKeyColorsNote" : "kb.mchKeyColorsInactive")}</small>
      </div></div>
      {!colors ? <p className="keyboard-empty">{t(locale, "kb.reading")}</p> : (
        <>
          <KeyDeck locale={locale} layout={mchose.layout} disabled={disabled} ariaLabel={t(locale, "kb.mchKeyColorsTitle")}
            label={(key) => deckLabel(mchose, key)} swatch={(key) => { const c = colors[key.index]; return c ? mchoseRgbToHex(c) : null; }}
            selected={chosen} onToggle={toggle} />
          <div className="keyboard-selection-actions">
            <span className="keyboard-selection-count">{tp(locale, "kb.selectedCount", { n: selected.length })}</span>
            <button type="button" className="om-btn is-sm" disabled={disabled} onClick={() => setSelected(mchose.layout.map((key) => key.index))}>{t(locale, "kb.selectAll")}</button>
            <button type="button" className="om-btn is-sm" disabled={disabled || selected.length === 0} onClick={() => setSelected([])}>{t(locale, "kb.clearSelection")}</button>
            <button type="button" className="om-btn is-sm" disabled={disabled || selected.length === 0}
              onClick={() => void setColors(selected.map((index) => ({ index, color: MCHOSE_KEY_COLOR_OFF })))}>{t(locale, "kb.mchResetSelected")}</button>
            <button type="button" className="om-btn is-sm" disabled={disabled}
              onClick={() => { if (window.confirm(t(locale, "kb.mchResetAllConfirm"))) void setColors(mchose.layout.map(({ index }) => ({ index, color: MCHOSE_KEY_COLOR_OFF }))); }}>{t(locale, "kb.mchResetAll")}</button>
          </div>
          <div className="mchose-color-row">
            <div className="arbiter-palette">
              <ColorPicker id="mchose-key-color" ariaLabel={t(locale, "kb.mchColor")} disabled={disabled} value={color} onChange={setColor} />
            </div>
            <button type="button" className="om-btn" disabled={disabled || selected.length === 0}
              onClick={() => void setColors(selected.map((index) => ({ index, color: mchoseHexToRgb(color) })))}>{t(locale, "kb.mchApply")}</button>
          </div>
          <GradientEditor locale={locale} disabled={disabled} onPaint={(stops, angle) => void paint(stops, angle)} />
        </>
      )}
    </article>
  );
}
