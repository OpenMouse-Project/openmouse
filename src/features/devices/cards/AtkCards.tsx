import { displayText, t, tp } from "../../../i18n/index";
import {
  ATK_R1_BUTTON_ACTIONS,
  ATK_BUTTON_CLASS,
  ATK_R1_MACRO_MAX_ACTIONS,
  ATK_R1_MACRO_MOUSE_BUTTON,
  ATK_R1_MACRO_SLOT_COUNT,
  ATK_R1_MACRO_START_TYPES,
  atkButtonActionId,
  type AtkR1MacroStepInput,
} from "@openmouse/protocol/atk";
import { useUiLocale } from "../../../shared/ui-locale";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../../../device/controller";
import type { ControlSnapshot } from "../../../device/types";
import { Segmented } from "../../../shared/ui";
import { atkSensorModes, atkSupportsMacroBindings, atkVisibleButtons } from "./atk-capabilities";
import { Circle, Plus, RefreshCw, Save, Square, Trash2 } from "lucide-react";

/**
 * Action records a step list costs. A wheel step is stored as a press and a
 * release, so it spends two of the slot's records.
 */
function atkMacroActionCount(steps: readonly AtkR1MacroStepInput[]): number {
  return steps.reduce((total, step) => total + (step.kind.startsWith("wheel") ? 2 : 1), 0);
}

function atkMacroPressIdentity(kind: AtkR1MacroStepInput["kind"], keyCode: number): string | null {
  if (kind.startsWith("wheel")) return null;
  return `${kind.startsWith("mouse") ? "mouse" : "key"}:${keyCode}`;
}

function atkMacroOpenPresses(steps: readonly AtkR1MacroStepInput[]): Set<string> {
  const open = new Set<string>();
  for (const step of steps) {
    const identity = atkMacroPressIdentity(step.kind, step.keyCode);
    if (!identity) continue;
    if (step.kind === "key-up" || step.kind === "mouse-up") open.delete(identity);
    else open.add(identity);
  }
  return open;
}

type AtkMapping = NonNullable<NonNullable<ControlSnapshot["status"]>["atkButtonMappings"]>[number];

const ATK_MACRO_KEY_CHOICES: ReadonlyArray<{ label: string; usage: number }> = [
  ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ", (letter, index) => ({ label: letter, usage: 0x04 + index })),
  ...Array.from("1234567890", (digit, index) => ({ label: digit, usage: index === 9 ? 0x27 : 0x1e + index })),
  { label: "Enter", usage: 0x28 },
  { label: "Escape", usage: 0x29 },
  { label: "Backspace", usage: 0x2a },
  { label: "Tab", usage: 0x2b },
  { label: "Space", usage: 0x2c },
  ...Array.from({ length: 12 }, (_, index) => ({ label: `F${index + 1}`, usage: 0x3a + index })),
  { label: "Left Ctrl", usage: 0xe0 },
  { label: "Left Shift", usage: 0xe1 },
  { label: "Left Alt", usage: 0xe2 },
  { label: "Left GUI", usage: 0xe3 },
  { label: "Right Ctrl", usage: 0xe4 },
  { label: "Right Shift", usage: 0xe5 },
  { label: "Right Alt", usage: 0xe6 },
  { label: "Right GUI", usage: 0xe7 },
  { label: "Arrow left", usage: 0x50 },
  { label: "Arrow down", usage: 0x51 },
  { label: "Arrow right", usage: 0x4f },
  { label: "Arrow up", usage: 0x52 },
];

const ATK_MACRO_MOUSE_CHOICES: ReadonlyArray<{ label: Parameters<typeof t>[1]; usage: number }> = [
  { label: "map.buttonLeft", usage: ATK_R1_MACRO_MOUSE_BUTTON.left },
  { label: "map.buttonRight", usage: ATK_R1_MACRO_MOUSE_BUTTON.right },
  { label: "map.buttonMiddle", usage: ATK_R1_MACRO_MOUSE_BUTTON.middle },
  { label: "map.buttonBackward", usage: ATK_R1_MACRO_MOUSE_BUTTON.back },
  { label: "map.buttonForward", usage: ATK_R1_MACRO_MOUSE_BUTTON.forward },
];

/** DOM `MouseEvent.button` values mapped to the R1 macro button masks. */
const ATK_MACRO_DOM_BUTTON: Readonly<Record<number, number>> = {
  0: ATK_R1_MACRO_MOUSE_BUTTON.left,
  2: ATK_R1_MACRO_MOUSE_BUTTON.right,
  1: ATK_R1_MACRO_MOUSE_BUTTON.middle,
  3: ATK_R1_MACRO_MOUSE_BUTTON.back,
  4: ATK_R1_MACRO_MOUSE_BUTTON.forward,
};

const ATK_MACRO_EVENT_CODE_USAGE: Readonly<Record<string, number>> = {
  Enter: 0x28,
  Escape: 0x29,
  Backspace: 0x2a,
  Tab: 0x2b,
  Space: 0x2c,
  F1: 0x3a,
  F2: 0x3b,
  F3: 0x3c,
  F4: 0x3d,
  F5: 0x3e,
  F6: 0x3f,
  F7: 0x40,
  F8: 0x41,
  F9: 0x42,
  F10: 0x43,
  F11: 0x44,
  F12: 0x45,
  Minus: 0x2d,
  Equal: 0x2e,
  BracketLeft: 0x2f,
  BracketRight: 0x30,
  Backslash: 0x31,
  Semicolon: 0x33,
  Quote: 0x34,
  Backquote: 0x35,
  Comma: 0x36,
  Period: 0x37,
  Slash: 0x38,
  ArrowLeft: 0x50,
  ArrowDown: 0x51,
  ArrowRight: 0x4f,
  ArrowUp: 0x52,
  ControlLeft: 0xe0,
  ShiftLeft: 0xe1,
  AltLeft: 0xe2,
  MetaLeft: 0xe3,
  ControlRight: 0xe4,
  ShiftRight: 0xe5,
  AltRight: 0xe6,
  MetaRight: 0xe7,
};

function atkMacroUsageForCode(code: string): number | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return 0x04 + letter[1]!.charCodeAt(0) - 0x41;
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1] === "0" ? 0x27 : 0x1e + Number(digit[1]) - 1;
  return ATK_MACRO_EVENT_CODE_USAGE[code] ?? null;
}

function atkMacroStartLabel(value: number, locale: ControlSnapshot["preferences"]["locale"]): string {
  if (value === ATK_R1_MACRO_START_TYPES.stopImmediately) return t(locale, "macro.atkStopImmediately");
  if (value === ATK_R1_MACRO_START_TYPES.repeatUntilAnyKeyPress) return t(locale, "macro.atkRepeatAny");
  if (value === ATK_R1_MACRO_START_TYPES.repeatUntilTriggerPress) return t(locale, "macro.atkRepeatTrigger");
  if (value <= 249) return `${t(locale, "macro.atkLoopCount")} ${value}`;
  return `${t(locale, "macro.atkStartMode")} 0x${value.toString(16).padStart(2, "0")}`;
}

function atkButtonActionLabel(id: string, fallback: string, locale: ControlSnapshot["preferences"]["locale"]): string {
  switch (id) {
    case "disabled": return t(locale, "tmr.disabled");
    case "left-click": return t(locale, "tmr.leftClick");
    case "right-click": return t(locale, "tmr.rightClick");
    case "middle-click": return t(locale, "map.middleClick");
    case "back": return t(locale, "map.buttonBackward");
    case "forward": return t(locale, "map.buttonForward");
    case "dpi-cycle": return t(locale, "atk.action.dpiCycle");
    case "dpi-up": return t(locale, "atk.action.dpiUp");
    case "dpi-down": return t(locale, "atk.action.dpiDown");
    case "scroll-left": return t(locale, "atk.action.scrollLeft");
    case "scroll-right": return t(locale, "atk.action.scrollRight");
    case "wheel-up": return t(locale, "atk.action.wheelUp");
    case "wheel-down": return t(locale, "atk.action.wheelDown");
    default: return displayText(locale, fallback);
  }
}

function atkButtonNameLabel(mapping: AtkMapping, locale: ControlSnapshot["preferences"]["locale"]): string {
  switch (mapping.id) {
    case "left": return t(locale, "map.buttonLeft");
    case "right": return t(locale, "map.buttonRight");
    case "middle": return t(locale, "map.buttonMiddle");
    case "back": return t(locale, "map.buttonBackward");
    case "forward": return t(locale, "map.buttonForward");
    case "bottom": return t(locale, "atk.button.bottom");
    default: return displayText(locale, mapping.name);
  }
}

function atkAssignmentLabel(
  mapping: AtkMapping,
  locale: ControlSnapshot["preferences"]["locale"],
): string {
  if (mapping.keyClass === ATK_BUTTON_CLASS.macro && mapping.value1 < ATK_R1_MACRO_SLOT_COUNT) {
    return `${t(locale, "macro.option")} ${mapping.value1 + 1} · ${atkMacroStartLabel(mapping.value2, locale)}`;
  }
  const actionId = atkButtonActionId(mapping.keyClass, mapping.value1, mapping.value2);
  return actionId
    ? atkButtonActionLabel(actionId, mapping.action, locale)
    : `${t(locale, "atk.action.unsupported")} (${mapping.raw})`;
}

function atkMacroSlotValue(macroId: number): string {
  return `macro:${macroId}`;
}

function atkMappingSelectionValue(mapping: AtkMapping): string {
  if (mapping.keyClass === ATK_BUTTON_CLASS.macro && mapping.value1 < ATK_R1_MACRO_SLOT_COUNT) {
    return atkMacroSlotValue(mapping.value1);
  }
  return atkButtonActionId(mapping.keyClass, mapping.value1, mapping.value2) ?? "";
}

function atkMacroSlotFromValue(value: string): number | null {
  const match = /^macro:(\d+)$/.exec(value);
  if (!match) return null;
  const macroId = Number(match[1]);
  return macroId >= 0 && macroId < ATK_R1_MACRO_SLOT_COUNT ? macroId : null;
}

function AtkMacroStepRow({
  step,
  index,
  disabled,
  locale,
  onChange,
  onRemove,
}: {
  step: AtkR1MacroStepInput;
  index: number;
  disabled: boolean;
  locale: ControlSnapshot["preferences"]["locale"];
  onChange: (next: AtkR1MacroStepInput) => void;
  onRemove: () => void;
}): ReactNode {
  const isKeyStep = step.kind === "key-down" || step.kind === "key-up";
  const isMouseStep = step.kind === "mouse-down" || step.kind === "mouse-up";
  const knownKey = isKeyStep && ATK_MACRO_KEY_CHOICES.some((choice) => choice.usage === step.keyCode);
  return (
    <div className="macro-step" data-macro-recorder-control>
      <span className="macro-step-index">{index + 1}</span>
      <label>
        {t(locale, "macro.whStepType")}
        <select
          value={step.kind}
          disabled={disabled}
          onChange={(event) => {
            const kind = event.currentTarget.value as AtkR1MacroStepInput["kind"];
            const keyCode = kind.startsWith("wheel")
              ? 0
              : kind.startsWith("mouse")
                ? ATK_R1_MACRO_MOUSE_BUTTON.left
                : step.kind.startsWith("mouse")
                  ? 0x04
                  : step.keyCode || 0x04;
            onChange({
              kind,
              keyCode,
              holdTime: step.holdTime,
            });
          }}
        >
          <option value="key-down">{t(locale, "macro.stepDown")}</option>
          <option value="key-up">{t(locale, "macro.stepUp")}</option>
          <option value="mouse-down">{t(locale, "macro.stepMouseDown")}</option>
          <option value="mouse-up">{t(locale, "macro.stepMouseUp")}</option>
          <option value="wheel-up">{t(locale, "macro.whUp")}</option>
          <option value="wheel-down">{t(locale, "macro.whDown")}</option>
        </select>
      </label>
      {isKeyStep ? (
        <>
          <label>
            {t(locale, "macro.whKey")}
            <select
              value={knownKey ? String(step.keyCode) : "custom"}
              disabled={disabled}
              onChange={(event) => {
                const value = event.currentTarget.value;
                onChange({
                  kind: step.kind,
                  keyCode: value === "custom" ? 0 : Number(value),
                  holdTime: step.holdTime,
                });
              }}
            >
              {!knownKey ? <option value="custom">{t(locale, "macro.colCode")}</option> : null}
              {ATK_MACRO_KEY_CHOICES.map((choice) => (
                <option key={choice.usage} value={choice.usage}>{choice.label}</option>
              ))}
              {knownKey ? <option value="custom">{t(locale, "macro.colCode")}</option> : null}
            </select>
          </label>
          {!knownKey ? (
            <label>
              {t(locale, "macro.colCode")}
              <input
                type="number"
                min={0}
                max={255}
                value={step.keyCode}
                disabled={disabled}
                onChange={(event) => onChange({
                  kind: step.kind,
                  keyCode: Math.min(255, Math.max(0, Number(event.currentTarget.value) || 0)),
                  holdTime: step.holdTime,
                })}
              />
            </label>
          ) : null}
        </>
      ) : isMouseStep ? (
        <label>
          {t(locale, "macro.whButton")}
          <select
            value={step.keyCode}
            disabled={disabled}
            onChange={(event) => onChange({
              kind: step.kind,
              keyCode: Number(event.currentTarget.value),
              holdTime: step.holdTime,
            })}
          >
            {ATK_MACRO_MOUSE_CHOICES.map((choice) => (
              <option key={choice.usage} value={choice.usage}>{t(locale, choice.label)}</option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        {t(locale, "macro.colDelay")}
        <input
          type="number"
          min={0}
          max={65535}
          value={step.holdTime}
          disabled={disabled}
          onChange={(event) => onChange({
            kind: step.kind,
            keyCode: step.keyCode,
            holdTime: Math.min(65535, Math.max(0, Number(event.currentTarget.value) || 0)),
          })}
        />
      </label>
      <button
        type="button"
        className="ksnake-macro-delete"
        disabled={disabled}
        onClick={onRemove}
        aria-label={tp(locale, "macro.removeStep", { n: index + 1 })}
        title={t(locale, "macro.removeStepTitle")}
      >
        <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

export function AtkProfileCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const __uiLocale = useUiLocale();
  const status = snapshot.status;
  if (!status || status.activeProfile === null || status.atkProfileCount === undefined) return null;
  return (
    <article id="atk-profile-status" className="setting-card">
      <div className="setting-heading compact">
        <div><h2>{displayText(__uiLocale, "Configuration bank")}</h2></div>
        <output>{status.activeProfile} / {status.atkProfileCount}</output>
      </div>
      <Segmented
        ariaLabel={displayText(__uiLocale, "Active configuration bank")}
        options={Array.from({ length: status.atkProfileCount }, (_, index) => ({
          value: index + 1,
          label: String(index + 1),
        }))}
        value={status.activeProfile}
        disabled={snapshot.settingInProgress}
        onChange={(profile) => void control.selectAtkR1Profile(profile)}
      />
      <small className="setting-note"> {displayText(__uiLocale, "Switching changes the active firmware-managed bank and requires readback from the mouse.")} </small>
    </article>
  );
}

export function AtkButtonCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const __uiLocale = useUiLocale();
  const mappings = atkVisibleButtons(snapshot.status?.atkButtonMappings, snapshot.status?.atkCatalogFeatures);
  const macroBindings = atkSupportsMacroBindings(snapshot.status);
  if (!mappings.length) return null;
  return (
    <article id="atk-button-status" className="setting-card">
      <div className="setting-heading compact">
        <div><h2>{displayText(__uiLocale, "Onboard assignments")}</h2></div>
        <output>{mappings.length}</output>
      </div>
      <div className="button-remap-list">
        {mappings.map((mapping) => {
          const selection = atkMappingSelectionValue(mapping);
          return (
          <div className="button-remap-row" key={mapping.id}>
            <span>{atkButtonNameLabel(mapping, __uiLocale)}</span>
            <span className="button-map-select-wrap">
              <select
                aria-label={atkButtonNameLabel(mapping, __uiLocale)}
                value={selection}
                disabled={snapshot.settingInProgress || !mapping.checksumValid}
                title={`EEPROM 0x${mapping.address.toString(16).padStart(4, "0")} · ${mapping.raw}`}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  const macroId = atkMacroSlotFromValue(value);
                  if (macroId !== null) {
                    const startType = mapping.keyClass === ATK_BUTTON_CLASS.macro
                      ? mapping.value2
                      : ATK_R1_MACRO_START_TYPES.stopImmediately;
                    void control.applyAtkR1ButtonMacroSlot(mapping.id, macroId, startType);
                    return;
                  }
                  void control.applyAtkR1ButtonAction(mapping.id, value);
                }}
              >
                {selection === "" ? (
                  <option value="" disabled>{atkAssignmentLabel(mapping, __uiLocale)}</option>
                ) : null}
                {ATK_R1_BUTTON_ACTIONS.map((action) => (
                  <option key={action.id} value={action.id}>
                    {atkButtonActionLabel(action.id, action.label, __uiLocale)}
                  </option>
                ))}
                {macroBindings ? (
                  <optgroup label={t(__uiLocale, "macro.option")}>
                    {Array.from({ length: ATK_R1_MACRO_SLOT_COUNT }, (_, index) => (
                      <option key={index} value={atkMacroSlotValue(index)}>
                        {t(__uiLocale, "macro.option")} {index + 1}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </span>
          </div>
          );
        })}
      </div>
      <small className="setting-note"> {displayText(__uiLocale, "Written to the active bank with readback and automatic rollback if the mouse rejects the assignment.")} </small>
    </article>
  );
}

export function AtkMacroCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;
  const mappings = atkVisibleButtons(snapshot.status?.atkButtonMappings, snapshot.status?.atkCatalogFeatures);
  const [buttonId, setButtonId] = useState<string>(mappings[0]?.id ?? "");
  const [slot, setSlot] = useState(0);
  const [drafts, setDrafts] = useState<Record<number, AtkR1MacroStepInput[]>>({});
  const [startType, setStartType] = useState<number>(ATK_R1_MACRO_START_TYPES.stopImmediately);
  const [macroReading, setMacroReading] = useState(false);
  const [macroReadError, setMacroReadError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<HTMLDivElement | null>(null);
  const recordingLastRef = useRef<number | null>(null);
  const selectedButton = mappings.find((mapping) => mapping.id === buttonId) ?? mappings[0];
  const steps = drafts[slot] ?? [];
  const disabled = snapshot.settingInProgress || snapshot.pending.busy || macroReading;

  const updateSteps = (
    update: AtkR1MacroStepInput[] | ((current: AtkR1MacroStepInput[]) => AtkR1MacroStepInput[]),
  ): void => {
    setDrafts((current) => {
      const previous = current[slot] ?? [];
      const next = typeof update === "function" ? update(previous) : update;
      return { ...current, [slot]: next };
    });
  };

  const readMacro = async (): Promise<void> => {
    if (disabled || recording) return;
    setMacroReading(true);
    setMacroReadError(null);
    try {
      const readSteps = await control.readAtkR1Macro(slot);
      setDrafts((current) => ({ ...current, [slot]: readSteps }));
      const binding = mappings.find((mapping) =>
        mapping.keyClass === ATK_BUTTON_CLASS.macro && mapping.value1 === slot);
      if (binding) setStartType(binding.value2);
      if (readSteps.length === 0) setMacroReadError(t(locale, "macro.atkReadEmpty"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setMacroReadError(
        /vendor action type/.test(message) || /unsupported/.test(message)
          ? `${t(locale, "macro.atkReadUnsupported")} ${message}`
          : `${t(locale, "macro.atkReadFailed")}${message ? ` ${message}` : ""}`,
      );
    } finally {
      setMacroReading(false);
    }
  };

  useEffect(() => {
    if (!snapshot.hasActiveDevice || drafts[slot] !== undefined) return undefined;
    let cancelled = false;
    setMacroReading(true);
    setMacroReadError(null);
    void control.readAtkR1Macro(slot)
      .then((readSteps) => {
        if (cancelled) return;
        setDrafts((current) => ({ ...current, [slot]: readSteps }));
        const binding = mappings.find((mapping) =>
          mapping.keyClass === ATK_BUTTON_CLASS.macro && mapping.value1 === slot);
        if (binding) setStartType(binding.value2);
        if (readSteps.length === 0) setMacroReadError(t(locale, "macro.atkReadEmpty"));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        setMacroReadError(
          /vendor action type/.test(message) || /unsupported/.test(message)
            ? `${t(locale, "macro.atkReadUnsupported")} ${message}`
            : `${t(locale, "macro.atkReadFailed")}${message ? ` ${message}` : ""}`,
        );
      })
      .finally(() => {
        if (!cancelled) setMacroReading(false);
      });
    return () => {
      cancelled = true;
    };
    // Read once when the slot changes; manual edits in a draft are preserved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);

  useEffect(() => {
    if (!recording) return undefined;
    recorderRef.current?.focus();
    const isRecorderControl = (target: EventTarget | null): boolean => (
      target instanceof Element && Boolean(target.closest("[data-macro-recorder-control]"))
    );
    const held = new Set<string>();
    const append = (kind: AtkR1MacroStepInput["kind"], keyCode: number, at: number): void => {
      const previous = recordingLastRef.current;
      recordingLastRef.current = at;
      // The slot stores a wait *after* each record, so the time just measured
      // belongs to the step that finished, not to the one being added: a press
      // carries its own hold and the release after it carries the gap to the
      // next press. Stamping the new step shifts every measurement by one
      // place — the rule below is the one the GM3 recorder already follows,
      // where it came from a vendor capture.
      const elapsed = previous === null
        ? 0
        : Math.min(65535, Math.max(0, Math.round(at - previous)));
      setDrafts((current) => {
        const currentSteps = current[slot] ?? [];
        const stamped = currentSteps.length === 0
          ? currentSteps
          : currentSteps.map((step, index) => (index === currentSteps.length - 1
            ? { ...step, holdTime: elapsed }
            : step));
        const release = kind === "key-up" || kind === "mouse-up";
        const identity = atkMacroPressIdentity(kind, keyCode);
        if (release) {
          if (!identity || !atkMacroOpenPresses(stamped).has(identity)) return current;
        } else {
          const openPresses = atkMacroOpenPresses(stamped).size;
          if (atkMacroActionCount(stamped) + openPresses + 2 > ATK_R1_MACRO_MAX_ACTIONS) {
            return current;
          }
        }
        const next = [...stamped, { kind, keyCode, holdTime: 0 }];
        return atkMacroActionCount(next) > ATK_R1_MACRO_MAX_ACTIONS
          ? current
          : { ...current, [slot]: next };
      });
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isRecorderControl(event.target)) return;
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setRecording(false);
        return;
      }
      if (event.repeat) return;
      const usage = atkMacroUsageForCode(event.code);
      if (usage === null) return;
      event.preventDefault();
      event.stopPropagation();
      held.add(`key:${usage}`);
      append("key-down", usage, event.timeStamp);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      const usage = atkMacroUsageForCode(event.code);
      if (usage === null) return;
      const closesCapturedPress = held.delete(`key:${usage}`);
      const onControl = isRecorderControl(event.target);
      if (onControl && !closesCapturedPress) return;
      if (!onControl) {
        event.preventDefault();
        event.stopPropagation();
      }
      append("key-up", usage, event.timeStamp);
    };
    const onMouseDown = (event: MouseEvent): void => {
      if (isRecorderControl(event.target)) return;
      const button = ATK_MACRO_DOM_BUTTON[event.button];
      if (button === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      held.add(`mouse:${button}`);
      append("mouse-down", button, event.timeStamp);
    };
    const onMouseUp = (event: MouseEvent): void => {
      const button = ATK_MACRO_DOM_BUTTON[event.button];
      if (button === undefined) return;
      const closesCapturedPress = held.delete(`mouse:${button}`);
      const onControl = isRecorderControl(event.target);
      if (onControl && !closesCapturedPress) return;
      if (!onControl) {
        event.preventDefault();
        event.stopPropagation();
      }
      append("mouse-up", button, event.timeStamp);
    };
    const onContextMenu = (event: MouseEvent): void => {
      if (isRecorderControl(event.target)) return;
      event.preventDefault();
    };
    const onWheel = (event: WheelEvent): void => {
      if (isRecorderControl(event.target) || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      append(event.deltaY < 0 ? "wheel-up" : "wheel-down", 0, event.timeStamp);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, [recording, slot]);

  if (!selectedButton) return null;

  const addStep = (): void => {
    updateSteps((current) => atkMacroActionCount(current) + 2 <= ATK_R1_MACRO_MAX_ACTIONS
      ? [
          ...current,
          { kind: "key-down", keyCode: 0x04, holdTime: 20 },
          { kind: "key-up", keyCode: 0x04, holdTime: 20 },
        ]
      : current);
  };
  const updateStep = (index: number, next: AtkR1MacroStepInput): void => {
    updateSteps((current) => {
      const replaced = current.map((step, at) => (at === index ? next : step));
      return atkMacroActionCount(replaced) > ATK_R1_MACRO_MAX_ACTIONS ? current : replaced;
    });
  };
  const removeStep = (index: number): void => {
    updateSteps((current) => current.filter((_, at) => at !== index));
  };
  const startRecording = (): void => {
    recordingLastRef.current = null;
    setRecording(true);
  };
  const clearSlot = async (): Promise<void> => {
    if (disabled || recording) return;
    await control.clearAtkR1Macro(slot);
    updateSteps([]);
    // Reading the slot straight back is the point of the button: the device has
    // no other way to say the macro is gone, and a slot it would not empty has
    // to show its stored steps instead of an empty editor.
    await readMacro();
  };

  return (
    <article id="atk-macro-settings" className="setting-card">
      <div className="setting-heading compact">
        <div>
          <h2>{t(locale, "macro.build")}</h2>
          <p className="ksnake-macro-lead">{t(locale, "macro.atkLead")}</p>
        </div>
      </div>
      <div className="button-remap-list">
        <div className="button-remap-row">
          <span>{t(locale, "macro.whButton")}</span>
          <span className="button-map-select-wrap">
            <select
              value={selectedButton.id}
              disabled={disabled || recording}
              data-macro-recorder-control
              onChange={(event) => {
                setButtonId(event.currentTarget.value);
                setRecording(false);
              }}
            >
              {mappings.map((mapping) => (
                <option key={mapping.id} value={mapping.id}>{atkButtonNameLabel(mapping, locale)}</option>
              ))}
            </select>
          </span>
        </div>
      </div>
      <label className="ksnake-macro-slot-picker">
        <span>{t(locale, "macro.slotLabel")}</span>
        <select
          value={slot}
          disabled={disabled || recording}
          data-macro-recorder-control
          onChange={(event) => {
            setSlot(Number(event.currentTarget.value));
            setRecording(false);
          }}
        >
          {Array.from({ length: ATK_R1_MACRO_SLOT_COUNT }, (_, index) => {
            const count = drafts[index]?.length ?? 0;
            return (
              <option key={index} value={index}>
                {t(locale, "macro.option")} {index + 1}
                {count ? ` · ${tp(locale, "macro.steps", { n: count })}` : ` · ${t(locale, "macro.empty")}`}
              </option>
            );
          })}
        </select>
      </label>
      <div className="setting-action">
        <label className="ksnake-macro-timing-picker">
          <span>{t(locale, "macro.atkStartMode")}</span>
          <select
            value={startType}
            disabled={disabled || recording}
            data-macro-recorder-control
            onChange={(event) => setStartType(Number(event.currentTarget.value))}
          >
            <option value={ATK_R1_MACRO_START_TYPES.stopImmediately}>{t(locale, "macro.atkStopImmediately")}</option>
            <option value={ATK_R1_MACRO_START_TYPES.repeatUntilAnyKeyPress}>{t(locale, "macro.atkRepeatAny")}</option>
            <option value={ATK_R1_MACRO_START_TYPES.repeatUntilTriggerPress}>{t(locale, "macro.atkRepeatTrigger")}</option>
          </select>
        </label>
      </div>
      <div
        ref={recorderRef}
        className={`ksnake-macro-recorder${recording ? " is-recording" : ""}`}
        tabIndex={-1}
      >
        <div className="ksnake-macro-recorder-status">
          <span className="ksnake-macro-recorder-dot" aria-hidden="true" />
          <span>
            <strong>{recording ? t(locale, "macro.recording") : t(locale, "macro.addActions")}</strong>
            <span>{recording
              ? tp(locale, "macro.eventsHint", { n: steps.length })
              : t(locale, "macro.recorderHint")}</span>
          </span>
        </div>
        <div className="ksnake-macro-recorder-actions">
          {recording ? (
            <button
              className="ksnake-macro-stop"
              type="button"
              data-macro-recorder-control
              onClick={() => setRecording(false)}
            >
              <Square size={14} strokeWidth={2.2} aria-hidden="true" />
              {t(locale, "macro.stopRecording")}
            </button>
          ) : (
            <button
              className="ksnake-macro-record"
              type="button"
              data-macro-recorder-control
              disabled={disabled}
              onClick={startRecording}
            >
              <Circle size={14} strokeWidth={2.2} aria-hidden="true" />
              {t(locale, "macro.recordInput")}
            </button>
          )}
          <button
            className="ksnake-macro-manual-add"
            type="button"
            data-macro-recorder-control
            disabled={disabled || recording}
            onClick={addStep}
          >
            <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
            {t(locale, "macro.addManually")}
          </button>
        </div>
      </div>
      {macroReadError ? <p className="field-note" role="alert">{macroReadError}</p> : null}
      {macroReading ? (
        <p className="field-note">{t(locale, "macro.atkReading")}</p>
      ) : steps.length === 0 ? (
        <p className="field-note">{t(locale, "macro.noActions")}</p>
      ) : (
        <div className="macro-steps">
          {steps.map((step, index) => (
            <AtkMacroStepRow
              key={`${slot}-${index}`}
              step={step}
              index={index}
              disabled={disabled || recording}
              locale={locale}
              onChange={(next) => updateStep(index, next)}
              onRemove={() => removeStep(index)}
            />
          ))}
        </div>
      )}
      <div className="setting-action ksnake-macro-actions">
        <button
          type="button"
          data-macro-recorder-control
          disabled={disabled || recording || !snapshot.hasActiveDevice}
          onClick={() => void readMacro()}
        >
          <RefreshCw size={16} strokeWidth={2.2} aria-hidden="true" />
          {macroReading ? t(locale, "macro.atkReading") : t(locale, "macro.atkRead")}
        </button>
        <button
          type="button"
          data-macro-recorder-control
          disabled={disabled || recording || !snapshot.hasActiveDevice}
          onClick={() => void clearSlot()}
        >
          <Trash2 size={16} strokeWidth={2.2} aria-hidden="true" />
          {t(locale, "macro.clearSlot")}
        </button>
        <button
          className="ksnake-macro-save"
          type="button"
          data-macro-recorder-control
          disabled={disabled || recording || steps.length === 0}
          onClick={() => void control.applyAtkR1Macro(
            selectedButton.id,
            steps,
            { startType, runCount: 1, macroId: slot },
          )}
        >
          <Save size={16} strokeWidth={2.2} aria-hidden="true" />
          {t(locale, "macro.save")}
        </button>
      </div>
      <small className="setting-note">{t(locale, "macro.atkNotice")}</small>
    </article>
  );
}


export function AtkReceiverCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const __uiLocale = useUiLocale();
  const [pairingPrepared, setPairingPrepared] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const startPairingRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pairingPrepared) startPairingRef.current?.focus();
  }, [pairingPrepared]);
  const closePreparation = (): void => {
    setPairingPrepared(false);
    window.requestAnimationFrame(() => cardRef.current?.focus());
  };
  const startPairing = (): void => {
    closePreparation();
    void control.pairAtkR1SePlusReceiver();
  };
  const receiver = snapshot.status?.atkReceiver;
  if (!receiver) return null;
  const receiverName = snapshot.status?.name ?? "VXE R1";
  const pairing = receiver.pairingStatus === null
    ? "Unavailable"
    : receiver.pairingSecondsRemaining
      ? `Status ${receiver.pairingStatus} · ${receiver.pairingSecondsRemaining}s remaining`
      : `Status ${receiver.pairingStatus}`;
  return (
    <article ref={cardRef} id="atk-receiver-status" className="setting-card" tabIndex={-1}>
      <div className="setting-heading compact">
        <div><h2>{displayText(__uiLocale, "Receiver")}</h2></div>
        <output>{displayText(__uiLocale, receiver.online ? "Mouse online" : "Mouse offline")}</output>
      </div>
      <div className="button-remap-list">
        <div className="button-remap-row"><span>{t(__uiLocale, "ctl.pairModel")}</span><output>{receiverName}</output></div>
        <div className="button-remap-row"><span>{displayText(__uiLocale, "RF identifier")}</span><output>{receiver.rfId}</output></div>
        <div className="button-remap-row"><span>{displayText(__uiLocale, "Pairing state")}</span><output>{displayText(__uiLocale, pairing)}</output></div>
      </div>
      {snapshot.atkR1SePlusPairingAvailable ? (
        pairingPrepared ? (
          <div className="setting-action">
            <small className="setting-note"> {displayText(__uiLocale, "Unplug the mouse cable and select 2.4 GHz mode. After starting, hold left click, wheel click, and right click until the indicator flashes, then release.")} </small>
            <button
              ref={startPairingRef}
              className="om-btn is-primary"
              type="button"
              disabled={snapshot.settingInProgress}
              onClick={startPairing}
            > {displayText(__uiLocale, "Ready, start pairing")} </button>
            <button type="button" className="om-btn is-ghost" disabled={snapshot.settingInProgress} onClick={closePreparation}>{displayText(__uiLocale, "Cancel")}</button>
          </div>
        ) : (
          <div className="setting-action">
            <small className="setting-note">{tp(__uiLocale, "ctl.pairVerified", { name: receiverName })}</small>
            <button type="button" className="om-btn" disabled={snapshot.settingInProgress} onClick={() => setPairingPrepared(true)}>{tp(__uiLocale, "ctl.pairReceiver", { name: receiverName })}</button>
          </div>
        )
      ) : (
        <small className="setting-note">{displayText(__uiLocale, "Pairing controls are unavailable on this receiver model.")}</small>
      )}
    </article>
  );
}

const ATK_SENSOR_MODE_LABELS = ["Basic Mode", "ATK Shard Competitive Firmware", "ATK Shard Competitive Firmware MAX"] as const;
const ATK_DONGLE_LIGHT_LABELS = ["adv.ledOff", "adv.ledConnectRate", "adv.ledBatteryStatus", "adv.ledBatteryWarning"] as const;

/**
 * F1 Ultimate extras, grouped like the ATK HUB pages: sensor sampling rate
 * lives with polling under Performance, while scroll anti-mistouch and the
 * receiver dongle LED live under Advanced (HUB Parameter page). Each control
 * renders only when the driver actually reported the field; all three were
 * verified on the F1 Ultimate 2.0 (CID 01, MID 08 over 373B:11D9).
 */
export function AtkSensorCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const __uiLocale = useUiLocale();
  const sensorMode = snapshot.status?.atkSensorMode ?? null;
  if (sensorMode == null) return null;
  // Vendor catalog: noAthleticsMax mice expose Basic and Shard only, so the
  // MAX option is dropped rather than offered and rejected by the device.
  const modes = atkSensorModes(snapshot.status?.atkCatalogFeatures);
  return (
    <article id="atk-sensor-mode" className="setting-card">
      <div className="setting-heading compact">
        <div><h2>{displayText(__uiLocale, "Sensor Sampling Rate")}</h2></div>
      </div>
      <Segmented
        ariaLabel={displayText(__uiLocale, "Sensor sampling mode")}
        options={modes.map((value) => ({ value, label: displayText(__uiLocale, ATK_SENSOR_MODE_LABELS[value]) }))}
        value={sensorMode}
        disabled={snapshot.settingInProgress}
        className={modes.length === 3 ? "three" : undefined}
        onChange={(mode) => void control.selectAtkSensorMode(mode)}
      />
      <small className="setting-note setting-note-stable">
        {displayText(__uiLocale, sensorMode === 2
          ? "In this mode, the mouse sensor is in high performance state, high scanning frequency, more responsive control."
          : sensorMode === 1
            ? "ATK Shard competitive firmware: balanced scan rate for match play."
            : "Basic sensor mode for daily work and maximum battery life.")}
      </small>
    </article>
  );
}

export function AtkDongleCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const __uiLocale = useUiLocale();
  const dongleLight = snapshot.status?.atkDongleLight ?? (snapshot.status?.atkSensorMode != null ? 2 : null);
  if (dongleLight == null) return null;
  return (
    <article id="atk-dongle-light" className="setting-card">
      <div className="setting-heading compact">
        <div><h2>{t(__uiLocale, "adv.dongleLed")}</h2></div>
      </div>
      <small className="setting-note">{t(__uiLocale, "adv.effect")}</small>
      <Segmented
        ariaLabel={displayText(__uiLocale, "Dongle LED effect")}
        options={ATK_DONGLE_LIGHT_LABELS.map((label, value) => ({ value, label: t(__uiLocale, label) }))}
        value={dongleLight}
        disabled={snapshot.settingInProgress}
        onChange={(mode) => void control.selectAtkDongleLight(mode)}
      />
      <small className="setting-note"> {displayText(__uiLocale, "Effect on the 8K receiver; write-only, confirmed on the LED.")} </small>
    </article>
  );
}
