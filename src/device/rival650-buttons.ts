import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import type { Rival650ButtonAction, Rival650ButtonName } from "@openmouse/protocol/steelseries";
import type { I18nKey } from "../i18n/index.ts";
import { hidKeyForCode } from "../features/profiles/hid-keys.ts";

export const RIVAL650_PRIMARY_BUTTON = "button1";
export const RIVAL650_CUSTOM_ASSIGNMENT = "rival650-custom";
type Rival650ReadAction = Rival650ButtonAction | { type: "raw"; bytes: readonly number[] };
type Rival650ReadMap = Record<Rival650ButtonName, Rival650ReadAction>;
type Rival650ButtonEdits = Partial<Rival650ReadMap>;
export type Rival650ButtonDraft =
  | { kind: "replace"; mapping: Rival650ReadMap }
  | { kind: "edit"; edits: Rival650ButtonEdits; fallback: Rival650ReadMap };

// The published protocol can omit this field until its Rival 650 read support ships.
type Rival650Status = MouseStatus & { rival650ButtonMappings?: Rival650ReadMap };

export const RIVAL650_BUTTON_LABELS = {
  button1: "adv.leftButton",
  button2: "adv.rightButton",
  button3: "magnetic.middleButton",
  button4: "common.back",
  button5: "conn.forward",
  button6: "map.rival650FrontSide",
  button7: "map.rival650DpiButton",
} satisfies Record<Rival650ButtonName, I18nKey>;

const mouseActions = {
  "adv.leftButton": { type: "button", target: "button1" },
  "adv.rightButton": { type: "button", target: "button2" },
  "magnetic.middleButton": { type: "button", target: "button3" },
  "common.back": { type: "button", target: "button4" },
  "conn.forward": { type: "button", target: "button5" },
  "map.rival650FrontSide": { type: "button", target: "button6" },
  "tmr.disabled": { type: "disabled" },
  "map.rival650SwitchDpi": { type: "dpiSwitch" },
  "adv.scrollUp": { type: "scrollUp" },
  "adv.scrollDown": { type: "scrollDown" },
  // Consumer usages from Rivalcfg's layout_multimedia.py.
  "prof.mute": { type: "multimedia", code: 0xe2 },
  "prof.playPause": { type: "multimedia", code: 0xcd },
  "prof.prevTrack": { type: "multimedia", code: 0xb6 },
  "prof.nextTrack": { type: "multimedia", code: 0xb5 },
  "prof.volDown": { type: "multimedia", code: 0xea },
  "prof.volUp": { type: "multimedia", code: 0xe9 },
} satisfies Partial<Record<I18nKey, Rival650ButtonAction>>;

export const RIVAL650_ACTION_LABELS: ReadonlyMap<string, I18nKey> = new Map(
  (Object.keys(mouseActions) as (keyof typeof mouseActions)[]).map(key => [key, key]),
);

export const RIVAL650_KEY_LABELS: ReadonlyMap<string, string> = new Map([
  ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ", key => [`key:Key${key}`, key] as const),
  ...Array.from("1234567890", key => [`key:Digit${key}`, key] as const),
  ...Array.from({ length: 12 }, (_, index) => [`key:F${index + 1}`, `F${index + 1}`] as const),

  ["key:ArrowLeft", "←"], ["key:ArrowRight", "→"], ["key:ArrowUp", "↑"], ["key:ArrowDown", "↓"],
  ["key:Minus", "-"], ["key:Equal", "="], ["key:BracketLeft", "["], ["key:BracketRight", "]"],
  ["key:Backslash", "\\"], ["key:Semicolon", ";"], ["key:Quote", "'"], ["key:Backquote", "`"],
  ["key:Comma", ","], ["key:Period", "."], ["key:Slash", "/"],
]);

export const RIVAL650_KEY_NAMES = {
  "key:Enter": "key.enter", "key:Escape": "key.escape", "key:Backspace": "key.backspace",
  "key:Tab": "key.tab", "key:Space": "key.space", "key:Insert": "key.insert", "key:Delete": "key.delete",
  "key:Home": "key.home", "key:End": "key.end", "key:PageUp": "key.pageUp", "key:PageDown": "key.pageDown",
} satisfies Record<string, I18nKey>;

const actions = new Map<string, Rival650ButtonAction>(Object.entries(mouseActions));
for (const key of [...Object.keys(RIVAL650_KEY_NAMES), ...RIVAL650_KEY_LABELS.keys()]) {
  const code = hidKeyForCode(key.slice("key:".length));
  if (code !== null) actions.set(key, { type: "keyboard", code });
}

const leftClick = "adv.leftButton";
export const RIVAL650_FACTORY_MAPPING = {
  button1: mouseActions[leftClick],
  button2: mouseActions["adv.rightButton"],
  button3: mouseActions["magnetic.middleButton"],
  button4: mouseActions["common.back"],
  button5: mouseActions["conn.forward"],
  button6: mouseActions["tmr.disabled"],
  button7: mouseActions["map.rival650SwitchDpi"],
} satisfies Rival650ReadMap;

const buttonNames = Object.keys(RIVAL650_FACTORY_MAPPING) as Rival650ButtonName[];
const unknownAssignments = Object.fromEntries(buttonNames.map(button => [button, ""]));
const actionLabels = new Map([...actions].map(([label, action]) => [JSON.stringify(action), label]));

export function rival650ButtonStatus(status: Rival650Status): MouseStatus {
  const observed = status.rival650ButtonMappings;
  const buttonMappings = observed ? Object.fromEntries(buttonNames.map(button => [
    button, actionLabels.get(JSON.stringify(observed[button])) ?? RIVAL650_CUSTOM_ASSIGNMENT,
  ])) : { ...unknownAssignments };
  return { ...status, buttonMappings, buttonOptions: [...actions.keys()] };
}

export function editRival650ButtonDraft(
  status: Rival650Status,
  draft: Rival650ButtonDraft | undefined,
  button: string,
  assignment: string,
): Rival650ButtonDraft | undefined {
  const action = actions.get(assignment);
  const name = buttonNames.find(entry => entry === button);
  if (!action || !name) return undefined;
  if (draft?.kind === "replace") {
    return { kind: "replace", mapping: { ...draft.mapping, [name]: action } };
  }
  const current = status.rival650ButtonMappings ?? draft?.fallback;
  if (!current) return undefined;
  const edits = { ...draft?.edits };
  if (JSON.stringify(current[name]) === JSON.stringify(action)) delete edits[name];
  else edits[name] = action;
  return { kind: "edit", edits, fallback: current };
}

export function previewRival650Buttons(status: Rival650Status, draft: Rival650ButtonDraft): void {
  if (draft.kind === "replace") {
    status.rival650ButtonMappings = draft.mapping;
  } else if (Object.keys(draft.edits).length) {
    status.rival650ButtonMappings = { ...(status.rival650ButtonMappings ?? draft.fallback), ...draft.edits };
  }
}

export function mergeRival650ButtonEdits(
  current: Rival650ReadMap,
  edits: Rival650ButtonEdits,
  missingClickMessage: string,
): Rival650ReadMap {
  const next = { ...current, ...edits };
  if (!hasLeftClick(next)) throw new Error(missingClickMessage);
  return next;
}

function hasLeftClick(mapping: Rival650ReadMap): boolean {
  return Object.values(mapping).some(action => action.type === "button" && action.target === "button1");
}

export function rival650ButtonLocked(button: string, mapping: Readonly<Record<string, string>>): boolean {
  return button === RIVAL650_PRIMARY_BUTTON || (mapping[button] === leftClick
    && Object.values(mapping).filter(action => action === leftClick).length === 1);
}
