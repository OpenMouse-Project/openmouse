import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  WootingAkcPayloadWrite,
  WootingDksAction,
  WootingRapidTriggerTarget,
  WootingRgbEffect,
} from "@openmouse/keyboard-protocol/wooting";
import {
  wootingColorToRgb565,
  wootingDksChangeLabel,
  wootingDksPayload,
  wootingJitActivationLabel,
  wootingRgb565ToColor,
  wootingRgbEffectDefaults,
  wootingRgbEffectFields,
  wootingRgbLayerLimit,
  wootingSocdModeLabel,
} from "@openmouse/keyboard-protocol/wooting";
import type { ControlSnapshot } from "../../../device/types";
import * as control from "../../../device/controller";
import { WootingKeyMap } from "./WootingKeyMap";
import { WOOTING_60_LAYOUT, WOOTING_KEY_MATRIX_INDEX } from "./wooting-layout";
import {
  buildWootingRapidTriggerMap,
  wootingRapidTriggerBase,
  wootingRapidTriggerStrict,
  type WootingRapidTriggerState,
} from "./wooting-rapid-trigger";
import { OptionMenu, Segmented, StepperSlider } from "../../../shared/ui";
import { displayText, t, tp } from "../../../i18n/index";
import type { InterfaceLocale } from "../../settings/interface-preferences";

const MAX_MM = 4;
const round2 = (v: number): number => Math.round(v * 100) / 100;

const RGB_EFFECT_LABELS = {
  wave: "rgb.effect.wave",
  scan: "rgb.effect.scan",
  breath: "rgb.effect.breath",
  cycle: "rgb.effect.cycle",
  keyRipple: "rgb.effect.keyRipple",
  keyTrail: "rgb.effect.keyTrail",
  analogTouch: "rgb.effect.analogTouch",
  analogJelly: "rgb.effect.analogJelly",
  analogBomb: "rgb.effect.analogBomb",
  analogMixing: "rgb.effect.analogMixing",
  rapidTrigger: "rgb.effect.rapidTrigger",
  snake: "rgb.effect.snake",
  heatmap: "rgb.effect.heatmap",
  noise: "rgb.effect.noise",
  spiral: "rgb.effect.spiral",
} as const satisfies Record<WootingRgbEffect["kind"], string>;

const RGB_EFFECT_KINDS = Object.keys(RGB_EFFECT_LABELS) as WootingRgbEffect["kind"][];

const AKC_KIND_LABELS = {
  toggleKey: "kb.wootingAkcToggle",
  modTap: "kb.wootingAkcModTap",
  rappySnappy: "kb.wootingAkcRappy",
  socd: "kb.wootingAkcSocd",
  dks: "kb.wootingAkcDks",
} as const;

const AKC_KINDS = Object.keys(AKC_KIND_LABELS) as WootingAkcPayloadWrite["kind"][];
const AKC_LIMIT = 40;

const KEY_LABEL_BY_MATRIX = new Map<number, string>();
for (const key of WOOTING_60_LAYOUT.flat()) {
  const matrix = WOOTING_KEY_MATRIX_INDEX.get(key.id);
  if (matrix != null) KEY_LABEL_BY_MATRIX.set(matrix, key.label);
}

const colorToHex = (color: number): string => {
  const { red, green, blue } = wootingRgb565ToColor(color);
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
};

const hexToColor = (hex: string): number => {
  const value = hex.replace("#", "");
  return wootingColorToRgb565({
    red: parseInt(value.slice(0, 2), 16),
    green: parseInt(value.slice(2, 4), 16),
    blue: parseInt(value.slice(4, 6), 16),
  });
};

/**
 * Raw effect parameter input. The protobuf carries no ranges or units, so the
 * field commits the number as-is.
 */
function WootingEffectNumber({ label, value, disabled, onCommit }: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}): ReactNode {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  const commit = (): void => {
    const next = Number(text);
    if (!Number.isFinite(next) || next === value) {
      setText(String(value));
      return;
    }
    void onCommit(next);
  };
  return (
    <input
      type="number"
      step={1}
      aria-label={label}
      disabled={disabled}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(event) => setText(event.currentTarget.value)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.currentTarget.blur();
      }}
    />
  );
}

/** Descriptor keys are property names, but the effect union has no index signature. */
const effectFieldValue = (effect: WootingRgbEffect, key: string): unknown => (effect as unknown as Record<string, unknown>)[key];

/** Copy one descriptor-selected field without narrowing the 15-way effect union. */
const withEffectField = (effect: WootingRgbEffect, key: string, value: number | boolean): WootingRgbEffect =>
  ({ ...effect, [key]: value } as WootingRgbEffect);
/** Single-item AKC editor. The package write path is one packet, so this stays per key/layer. */
function WootingAkcEditor({ locale, matrixKey, busy, canSave, onSave }: {
  locale: InterfaceLocale;
  matrixKey: number | null;
  busy: boolean;
  canSave: boolean;
  onSave: (payload: WootingAkcPayloadWrite | null) => void;
}): ReactNode {
  const [kind, setKind] = useState<WootingAkcPayloadWrite["kind"]>("toggleKey");
  const form = useRef<HTMLFormElement>(null);
  const submit = (event: Event): void => {
    event.preventDefault();
    const element = form.current;
    if (!element || matrixKey === null) return;
    const data = new FormData(element);
    const required = (name: string): number => Number(data.get(name) ?? 0);
    const optional = (name: string): number | undefined => {
      const raw = data.get(name);
      const text = typeof raw === "string" ? raw.trim() : "";
      return text === "" ? undefined : Number(text);
    };
    let payload: WootingAkcPayloadWrite;
    if (kind === "toggleKey") {
      payload = { kind, keybind: required("keybind") };
    } else if (kind === "modTap") {
      payload = {
        kind,
        tapKey: required("tapKey"),
        holdKey: required("holdKey"),
        ...(optional("holdDuration") === undefined ? {} : { holdDurationRaw: optional("holdDuration")! }),
        jitActivation: required("jitActivation"),
      };
    } else if (kind === "rappySnappy") {
      payload = { kind, secondaryKey: required("secondaryKey"), socdMode: required("socdMode") };
    } else if (kind === "socd") {
      payload = {
        kind,
        secondaryKey: required("secondaryKey"),
        socdMode: required("socdMode"),
        inputBothOnBottomOut: data.get("bottomOut") === "on",
      };
    } else {
      const actions = [0, 1, 2, 3].map((action) => ({
        keybind: optional(`dksKey${action}`) ?? null,
        transitions: [0, 1, 2, 3].map((point) => required(`dksTransition${action}-${point}`)) as unknown as WootingDksAction["transitions"],
      })) as [WootingDksAction, WootingDksAction, WootingDksAction, WootingDksAction];
      payload = wootingDksPayload(actions, optional("secondaryActuation"));
    }
    onSave(payload);
  };
  const numberField = (name: string, label: string) => (
    <label className="keyboard-field"><span>{label}</span><input name={name} type="number" step={1} defaultValue={0} disabled={busy} /></label>
  );
  const modeField = (name: string, label: string, values: readonly number[], nameOf: (value: number) => string, value = 0) => (
    <label className="keyboard-field"><span>{label}</span>
      <select name={name} defaultValue={value} disabled={busy}>
        {values.map((mode) => <option key={mode} value={mode}>{displayText(locale, nameOf(mode))}</option>)}
      </select>
    </label>
  );
  return (
    <form ref={form} className="wooting-akc-editor" onSubmit={(event) => submit(event)}>
      <div className="wooting-rgb-fields">
        <div className="keyboard-field">
          <span>{t(locale, "kb.wootingAkcKind")}</span>
          <OptionMenu
            ariaLabel={t(locale, "kb.wootingAkcKind")}
            value={kind}
            disabled={busy}
            options={AKC_KINDS.map((option) => ({ value: option, label: t(locale, AKC_KIND_LABELS[option]) }))}
            onChange={setKind}
          />
        </div>
        {kind === "toggleKey" ? numberField("keybind", t(locale, "kb.wootingAkcKeybind")) : null}
        {kind === "modTap" ? (
          <>
            {numberField("tapKey", t(locale, "kb.wootingAkcTapKey"))}
            {numberField("holdKey", t(locale, "kb.wootingAkcHoldKey"))}
            {numberField("holdDuration", t(locale, "kb.wootingAkcDuration"))}
            {modeField("jitActivation", t(locale, "kb.wootingAkcJit"), [0, 1, 2, 3], wootingJitActivationLabel)}
          </>
        ) : null}
        {kind === "rappySnappy" || kind === "socd" ? (
          <>
            {numberField("secondaryKey", t(locale, "kb.wootingAkcSecondary"))}
            {modeField("socdMode", t(locale, "kb.wootingAkcMode"), [0, 1, 2, 3, 4], wootingSocdModeLabel, 3)}
          </>
        ) : null}
        {kind === "socd" ? (
          <label className="keyboard-field"><span>{t(locale, "kb.wootingAkcBottomOut")}</span><input name="bottomOut" type="checkbox" disabled={busy} /></label>
        ) : null}
        {kind === "dks" ? (
          <>
            <div className="wooting-akc-dks">
              {[0, 1, 2, 3].map((action) => (
                <div className="wooting-akc-dks-row" key={action}>
                  <label className="keyboard-field"><span>{t(locale, "kb.wootingAkcKeybind")}</span><input name={`dksKey${action}`} type="number" step={1} disabled={busy} /></label>
                  {[0, 1, 2, 3].map((point) => (
                    <label className="keyboard-field" key={point}>
                      <span>{displayText(locale, wootingDksChangeLabel(point))}</span>
                      <select name={`dksTransition${action}-${point}`} defaultValue={0} disabled={busy}>
                        {[0, 1, 2, 3].map((change) => <option key={change} value={change}>{displayText(locale, wootingDksChangeLabel(change))}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            {numberField("secondaryActuation", t(locale, "kb.wootingAkcSecondaryActuation"))}
          </>
        ) : null}
      </div>
      <div className="wooting-rgb-actions">
        <button type="submit" className="om-btn" disabled={busy || matrixKey === null || !canSave}>{t(locale, "kb.wootingAkcSave")}</button>
        <button type="button" className="om-btn" disabled={busy || matrixKey === null} onClick={() => onSave(null)}>{t(locale, "kb.wootingAkcRemove")}</button>
      </div>
    </form>
  );
}

/** Drawing order keys that map to a real 60% matrix position. */
const SELECTABLE_KEYS = WOOTING_60_LAYOUT.flat().filter((key) => WOOTING_KEY_MATRIX_INDEX.get(key.id) != null);


/**
 * Millimetre slider plus a number field for fine tuning. Both commit through
 * the caller, so the device write and its read-back stay the only source of
 * truth; the field is never edited optimistically.
 */
function WootingMmControl({ id, label, value, badge, disabled, onCommit }: {
  id: string;
  label: string;
  value: number | null;
  badge?: string;
  disabled: boolean;
  onCommit: (mm: number) => void | Promise<void>;
}): ReactNode {
  const [text, setText] = useState(value == null ? "" : round2(value).toFixed(2));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value == null ? "" : round2(value).toFixed(2));
  }, [value, focused]);
  const commitText = (): void => {
    const current = value == null ? null : round2(value);
    if (text.trim() === "") {
      setText(current == null ? "" : current.toFixed(2));
      return;
    }
    const next = Number(text.replace(",", "."));
    if (!Number.isFinite(next) || next < 0 || next > MAX_MM) {
      setText(current == null ? "" : current.toFixed(2));
      return;
    }
    const clamped = round2(Math.max(0, Math.min(MAX_MM, next)));
    if (clamped === current) {
      setText(current.toFixed(2));
      return;
    }
    setText(clamped.toFixed(2));
    void onCommit(clamped);
  };
  return (
    <div className="wooting-mm-control">
      <StepperSlider
        id={id}
        label={label}
        badge={badge}
        value={value ?? 0}
        min={0}
        max={MAX_MM}
        step={0.05}
        scale={["0", "", "4.0"]}
        formatValue={(mm) => `${mm.toFixed(2)} mm`}
        disabled={disabled}
        onCommit={onCommit}
      />
      <label className="wooting-mm-input">
        <span>{"mm"}</span>
        <input
          type="number"
          min={0}
          max={MAX_MM}
          step={0.05}
          inputMode="decimal"
          aria-label={label}
          disabled={disabled}
          value={text}
          onFocus={() => setFocused(true)}
          onChange={(event) => setText(event.currentTarget.value)}
          onBlur={() => { setFocused(false); commitText(); }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.currentTarget.blur();
          }}
        />
      </label>
    </div>
  );
}

/** Live reads plus explicit saves of the active profile's per-key actuation and rapid trigger. */
export function WootingKeyboardPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  if (!keyboard) return null;
  const locale = snapshot.preferences.locale;
  const status = keyboard.workspace.wooting;
  const busy = keyboard.trigger.busy;
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [staticColor, setStaticColor] = useState<string | null>(null);
  const [akcLayer, setAkcLayer] = useState(0);
  const unknown = "–";
  const global = status?.analogProfile?.global;
  const value = (v: string | number | null | undefined) => v == null ? unknown : String(v);
  const state = (v: boolean | null | undefined) => v == null ? unknown : t(locale, v ? "tmr.enabled" : "tmr.disabled");
  const mixed = t(locale, "kb.wootingMixed");
  const capabilities = status?.capabilities ?? null;
  const actuationSupported = capabilities?.perKeyActuation ?? false;
  const rtSupport = capabilities?.perKeyRapidTrigger ?? "none";
  const rgb = keyboard.workspace.wootingRgb ?? null;
  const rgbCore = rgb?.core ?? null;
  const rgbBase = rgbCore?.base ?? null;
  const rgbLayers = rgbCore?.layers ?? [];
  const rgbLimit = wootingRgbLayerLimit(keyboard.productId);
  const rgbSupported = capabilities?.transport === "arm" && rgbLimit > 0;
  const rgbColors1 = rgb?.colors1 ?? null;
  const rgbColors2 = rgb?.colors2 ?? null;
  const staticHex = staticColor ?? (rgbColors1?.rows[0]?.[0] == null ? "#ffffff" : colorToHex(rgbColors1.rows[0][0]));
  const rtProfile = status?.perKeyRapidTrigger ?? null;
  const rtMap = buildWootingRapidTriggerMap(rtProfile);
  const rtBase = wootingRapidTriggerBase(status?.analogProfile);
  const savedActuation = status?.analogProfile?.actuationMm ?? null;
  const overrideList = status?.perKeyActuation?.overrides ?? [];
  const overrideMap = new Map(overrideList.map((o) => [o.key, o.actuationMm] as const));
  const selectedMatrices = [...selectedIds]
    .map((id) => WOOTING_KEY_MATRIX_INDEX.get(id))
    .filter((matrix): matrix is number => matrix != null);
  const selectedCount = selectedMatrices.length;
  const akcMatrixKey = selectedCount === 1 ? selectedMatrices[0] ?? null : null;
  const akcCombos = status?.akc?.combos ?? [];
  const allSelected = SELECTABLE_KEYS.every((key) => selectedIds.has(key.id));
  const selectedKeycap = selectedCount === 1 ? SELECTABLE_KEYS.find((key) => key.id === [...selectedIds][0]) ?? null : null;
  const toggleKey = (id: string): void => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const actuationValues = selectedMatrices.map((matrix) => overrideMap.get(matrix) ?? savedActuation);
  const actuationMixed = new Set(actuationValues.map((mm) => mm == null ? "unknown" : round2(mm))).size > 1;
  const actuationValue = actuationMixed ? null : actuationValues[0] ?? null;
  const overrideCount = selectedMatrices.filter((matrix) => overrideMap.has(matrix)).length;
  const keySource = selectedCount === 0
    ? null
    : overrideCount === selectedCount
      ? t(locale, "kb.wootingKeyOverride")
      : overrideCount === 0
        ? t(locale, "kb.wootingKeyDefault")
        : mixed;
  const selectedRt: WootingRapidTriggerState[] = selectedMatrices.map((matrix) => rtMap.byMatrix.get(matrix) ?? { kind: "base" });
  const rtKinds = new Set(selectedRt.map((entry) => entry.kind));
  const rtCommonKind = rtKinds.size === 1 ? selectedRt[0]?.kind ?? null : null;
  const customRt = selectedRt.filter((entry): entry is Extract<WootingRapidTriggerState, { kind: "custom" }> => entry.kind === "custom");
  const rtSensitivities = customRt.map((entry) => entry.sensitivityMm == null ? "unknown" : round2(entry.sensitivityMm));
  const rtSensitivityMixed = new Set(rtSensitivities).size > 1;
  const rtSensitivity = rtSensitivityMixed ? null : customRt[0]?.sensitivityMm ?? rtBase.sensitivityMm;
  const rtSecondaries = customRt.map((entry) => entry.secondarySensitivityMm == null ? "unknown" : round2(entry.secondarySensitivityMm));
  const rtSecondary = new Set(rtSecondaries).size === 1 ? customRt[0]?.secondarySensitivityMm ?? null : null;
  const rtContinuous = selectedRt.map((entry) => entry.kind === "custom" ? entry.continuous ?? false : rtBase.continuous ?? false);
  const rtStrict = wootingRapidTriggerStrict(rtContinuous[0] ?? null);
  const rtOverrides = [...rtMap.byMatrix.values()].filter((entry) => entry.kind !== "base").length;
  const rtLabels = {
    base: t(locale, "kb.wootingRtFollow"),
    off: t(locale, "kb.wootingRtOff"),
    custom: t(locale, "kb.wootingRtCustom"),
  } as const;
  const rtSource = rtCommonKind === null ? (selectedCount > 1 ? mixed : null) : rtLabels[rtCommonKind];
  const writeRt = (target: WootingRapidTriggerTarget | null): void => {
    if (selectedMatrices.length === 0) return;
    void control.applyKeyboardCommand({ kind: "wootingKeyRapidTrigger", keys: selectedMatrices, target });
  };
  const selectRtMode = (mode: WootingRapidTriggerState["kind"]): void => {
    if (mode === "base") { writeRt(null); return; }
    if (mode === "off") { writeRt({ enabled: false }); return; }
    if (rtSupport !== "full" || rtSensitivity === null) return;
    writeRt({
      sensitivityMm: rtSensitivity,
      ...(rtSecondary === null ? {} : { secondarySensitivityMm: rtSecondary }),
      continuous: !rtStrict,
    });
  };
  const stageRgbCore = (layers: WootingRgbEffect[], base = rgbBase): void => {
    if (!base) return;
    void control.applyKeyboardCommand({ kind: "wootingRgbApply", core: { base, layers }, save: false });
  };
  const updateRgbEffect = (index: number, key: string, value: number | boolean): void => {
    stageRgbCore(rgbLayers.map((layer, layerIndex) => layerIndex === index ? withEffectField(layer, key, value) : layer));
  };
  const row = (label: string, v: string | number | null | undefined) => (
    <div><dt>{label}</dt><dd>{value(v)}</dd></div>
  );
  return (
    <section className="keyboard-panel" data-workspace-host role="tabpanel" aria-labelledby={`workspace-tab-${snapshot.workspaceTab}`}>
      {keyboard.trigger.statusText ? <output className="keyboard-status" role="status">{displayText(locale, keyboard.trigger.statusText)}</output> : null}
      <article className="setting-card keyboard-identity-card keyboard-workspace-card" hidden={snapshot.workspaceTab !== "overview"}>
        <div className="setting-heading"><div><h2>{keyboard.name}</h2><small className="setting-note">{t(locale, "kb.wootingReadOnly")}</small></div>
          <button type="button" className="om-btn" disabled={busy} onClick={() => control.applyKeyboardCommand({ kind: "refresh" })}>{t(locale, "kb.refresh")}</button></div>
        <dl className="keyboard-identity wooting-identity">
          {row(t(locale, "kb.identityFirmware"), keyboard.identity.firmwareVersion)}
          {row(t(locale, "kb.identitySerial"), keyboard.identity.serial)}
          {row(t(locale, "kb.wootingLayout"), status?.layout)}
          {row(t(locale, "fprof.active"), status?.activeProfile == null ? null : status.profileNames[status.activeProfile] ?? String(status.activeProfile + 1))}
          {row(t(locale, "tab.profiles"), status?.profileCount)}
        </dl>
      </article>
      <article className="setting-card keyboard-workspace-card" hidden={snapshot.workspaceTab !== "overview"}>
        <div className="setting-heading"><h2>{t(locale, "ov.setupTitle")}</h2></div>
        <dl className="keyboard-identity wooting-identity">
          {row(t(locale, "kb.travel"), savedActuation == null ? null : `${savedActuation.toFixed(2)} mm`)}
          {row(t(locale, "kb.rapidGroup"), state(rtBase.enabled))}
          {row(t(locale, "kb.wootingRtSensitivity"), rtBase.sensitivityMm == null ? null : `${round2(rtBase.sensitivityMm).toFixed(2)} mm`)}
          {row(t(locale, "kb.wootingAnalogKeys"), status?.analogSnapshot?.available ? status.analogSnapshot.keys.length : null)}
        </dl>
      </article>
      <article className="setting-card keyboard-workspace-card" hidden={snapshot.workspaceTab !== "performance"}>
        <div className="setting-heading"><div><h2>{t(locale, "kb.wootingMap")}</h2><small className="setting-note">{t(locale, "kb.selectionHint")}</small></div></div>
        <WootingKeyMap snapshot={status?.analogSnapshot} locale={locale} defaultMm={savedActuation} overrides={overrideMap} rapidTrigger={rtMap.byMatrix} rapidTriggerBase={rtBase} selected={selectedIds} disabled={busy} onSelect={toggleKey} />
        <div className="keyboard-selection-actions">
          <span className="keyboard-selection-count">{tp(locale, "kb.selectedCount", { n: selectedCount })}</span>
          <button type="button" className="om-btn" disabled={busy || allSelected} onClick={() => setSelectedIds(new Set(SELECTABLE_KEYS.map((key) => key.id)))}>{t(locale, "kb.selectAll")}</button>
          <button type="button" className="om-btn" disabled={busy || selectedCount === 0} onClick={() => setSelectedIds(new Set())}>{t(locale, "kb.clearSelection")}</button>
        </div>
        {selectedCount > 0 ? (
          <div className="wooting-key-editor">
            <dl className="keyboard-identity">
              {row(t(locale, "kb.wootingKey"), selectedKeycap?.label ?? tp(locale, "kb.selectedCount", { n: selectedCount }))}
              {row(t(locale, "kb.wootingKeySource"), keySource)}
            </dl>
            {actuationSupported ? (
              <>
                <WootingMmControl
                  id="wooting-key-actuation"
                  label={t(locale, "kb.travel")}
                  value={actuationValue}
                  badge={actuationMixed ? mixed : undefined}
                  disabled={busy}
                  onCommit={(actuationMm) => control.applyKeyboardCommand({ kind: "wootingKeyActuation", keys: selectedMatrices, actuationMm })}
                />
                <button type="button" className="om-btn" disabled={busy || overrideCount === 0} onClick={() => void control.applyKeyboardCommand({ kind: "wootingKeyActuation", keys: selectedMatrices, actuationMm: null })}>{t(locale, "kb.wootingKeyReset")}</button>
              </>
            ) : <p className="setting-note">{t(locale, "kb.wootingActuationUnsupported")}</p>}
            <p className="setting-note">{t(locale, "kb.wootingKeyRtNote")}</p>
          </div>
        ) : <p className="setting-note">{t(locale, "kb.selectPrompt")}</p>}
      </article>
      {status?.perKeyRapidTrigger !== undefined ? (
      <article className="setting-card keyboard-workspace-card wooting-rt-card" hidden={snapshot.workspaceTab !== "performance"}>
        <div className="setting-heading"><div><h2>{t(locale, "kb.wootingRtPerKey")}</h2><small className="setting-note">{t(locale, "kb.wootingRtNote")}</small></div></div>
        {rtProfile === null || rtSupport === "none" ? <p className="setting-note">{t(locale, "kb.wootingRtUnsupported")}</p> : selectedCount === 0 ? <p className="setting-note">{t(locale, "kb.selectPrompt")}</p> : (
          <>
            <div className="wooting-rt-editor">
              <dl className="keyboard-identity">
                {row(t(locale, "kb.wootingKey"), selectedKeycap?.label ?? tp(locale, "kb.selectedCount", { n: selectedCount }))}
                {row(t(locale, "kb.wootingRtSource"), rtSource)}
                {row(t(locale, "kb.wootingRtProfile"), state(rtBase.enabled))}
                {row(t(locale, "kb.wootingRtSensitivity"), rtBase.sensitivityMm == null ? null : `${round2(rtBase.sensitivityMm).toFixed(2)} mm`)}
                {row(t(locale, "kb.wootingRtStrict"), rtBase.strict == null ? null : state(rtBase.strict))}
              </dl>
              <Segmented
                ariaLabel={t(locale, "kb.wootingRtMode")}
                value={rtCommonKind}
                disabled={busy}
                onChange={selectRtMode}
                options={[
                  { value: "base" as const, label: rtLabels.base },
                  { value: "off" as const, label: rtLabels.off },
                  { value: "custom" as const, label: rtLabels.custom, disabled: rtSupport !== "full" || (rtSensitivity === null && rtCommonKind !== "custom") },
                ]}
              />
              {rtCommonKind === "custom" && rtSupport === "full" ? (
                <>
                  <WootingMmControl
                    id="wooting-key-rt-sensitivity"
                    label={t(locale, "kb.wootingRtSensitivity")}
                    value={rtSensitivity}
                    badge={rtSensitivityMixed ? mixed : undefined}
                    disabled={busy}
                    onCommit={(sensitivityMm) => writeRt({
                      sensitivityMm,
                      ...(rtSecondary === null ? {} : { secondarySensitivityMm: rtSecondary }),
                      continuous: !rtStrict,
                    })}
                  />
                  <div className="wooting-fields">
                    <label className="keyboard-field"><span>{t(locale, "kb.wootingRtStrict")}</span>
                      <input type="checkbox" disabled={busy || rtSensitivity === null} checked={rtStrict} onChange={(e) => writeRt({
                        sensitivityMm: rtSensitivity ?? 0,
                        ...(rtSecondary === null ? {} : { secondarySensitivityMm: rtSecondary }),
                        continuous: !e.currentTarget.checked,
                      })} />
                    </label>
                  </div>
                  <p className="setting-note">{t(locale, "kb.wootingRtStrictHint")}</p>
                </>
              ) : null}
            </div>
            {rtOverrides === 0 ? <p className="setting-note">{t(locale, "kb.wootingRtNoOverrides")}</p> : null}
            {rtMap.unmapped.length > 0 ? (
              <div className="wooting-unmapped">
                <p className="setting-note">{t(locale, "kb.wootingRtUnmapped")}</p>
                <ul>
                  {rtMap.unmapped.map((entry) => (
                    <li key={entry.matrix}>
                      <span>{entry.row === null || entry.col === null ? `0x${entry.matrix.toString(16)}` : tp(locale, "kb.keyPosition", { row: entry.row + 1, col: entry.col + 1 })}</span>
                      <span>{rtLabels[entry.state.kind]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </article>
      ) : null}
      <article className="setting-card keyboard-workspace-card wooting-rgb-card" hidden={snapshot.workspaceTab !== "lighting"}>
        <div className="setting-heading"><div><h2>{t(locale, "tab.lighting")}</h2><small className="setting-note">{t(locale, "kb.wootingRgbNote")}</small></div></div>
        {!rgbSupported ? <p className="setting-note">{t(locale, "kb.wootingRgbArmOnly")}</p> : !rgbCore || !rgbBase ? <p className="setting-note">{t(locale, "kb.wootingRgbReadFailed")}</p> : (
          <>
            <StepperSlider
              id="wooting-rgb-brightness"
              label={t(locale, "light.brightness")}
              value={rgbBase.brightness}
              min={0}
              max={255}
              step={1}
              scale={["0", "", "255"]}
              formatValue={(brightness) => String(brightness)}
              disabled={busy}
              onCommit={(brightness) => stageRgbCore(rgbLayers, { ...rgbBase, brightness })}
            />
            <div className="wooting-rgb-layers">
              {rgbLayers.map((effect, index) => (
                <div className="wooting-rgb-layer" key={`${effect.kind}-${index}`}>
                  <div className="wooting-rgb-layer-head">
                    <strong>{t(locale, RGB_EFFECT_LABELS[effect.kind])}</strong>
                    <button type="button" className="om-btn" disabled={busy} onClick={() => stageRgbCore(rgbLayers.filter((_, layerIndex) => layerIndex !== index))}>{t(locale, "kb.wootingRgbRemove")}</button>
                  </div>
                  <div className="wooting-rgb-fields">
                    {wootingRgbEffectFields(effect.kind).map((field) => {
                      const fieldValue = effectFieldValue(effect, field.key);
                      return (
                        <div className="keyboard-field" key={field.key}>
                          <span>{displayText(locale, field.label)}</span>
                          {field.kind === "boolean" ? (
                            <input type="checkbox" aria-label={displayText(locale, field.label)} disabled={busy} checked={Boolean(fieldValue)} onChange={(event) => updateRgbEffect(index, field.key, event.currentTarget.checked)} />
                          ) : field.kind === "enum" ? (
                            <OptionMenu
                              ariaLabel={displayText(locale, field.label)}
                              value={Number(fieldValue ?? 0)}
                              disabled={busy}
                              options={Object.entries(field.options ?? {}).map(([value, label]) => ({ value: Number(value), label: displayText(locale, label) }))}
                              onChange={(value) => updateRgbEffect(index, field.key, value)}
                            />
                          ) : field.kind === "color" ? (
                            <input type="color" aria-label={displayText(locale, field.label)} disabled={busy} value={fieldValue == null ? "#ffffff" : colorToHex(Number(fieldValue))} onChange={(event) => updateRgbEffect(index, field.key, hexToColor(event.currentTarget.value))} />
                          ) : (
                            <WootingEffectNumber label={displayText(locale, field.label)} value={Number(fieldValue ?? 0)} disabled={busy} onCommit={(value) => updateRgbEffect(index, field.key, value)} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <OptionMenu
              ariaLabel={t(locale, "kb.wootingRgbAddEffect")}
              value={null}
              disabled={busy || rgbLayers.length >= rgbLimit}
              options={RGB_EFFECT_KINDS.map((kind) => ({ value: kind, label: t(locale, RGB_EFFECT_LABELS[kind]) }))}
              onChange={(kind) => stageRgbCore([...rgbLayers, wootingRgbEffectDefaults(kind)])}
            />
            {rgbLayers.length >= rgbLimit ? <p className="setting-note">{t(locale, "kb.wootingRgbLayersFull")}</p> : null}
            <div className="wooting-fields">
              <label className="keyboard-field"><span>{t(locale, "kb.wootingRgbStaticColor")}</span>
                <input type="color" disabled={busy || !rgbColors1 || !rgbColors2} value={staticHex} onChange={(event) => setStaticColor(event.currentTarget.value)} />
              </label>
            </div>
            <div className="wooting-rgb-actions">
              <button type="button" className="om-btn" disabled={busy || !rgbColors1 || !rgbColors2} onClick={() => {
                if (!rgbColors1 || !rgbColors2) return;
                const color = hexToColor(staticHex);
                void control.applyKeyboardCommand({
                  kind: "wootingRgbApply",
                  core: { base: rgbBase, layers: [{ kind: "analogBomb", baseBrightness: 127, useAnalogCurve: false }] },
                  colors1: rgbColors1.rows.map((row) => row.map(() => color)),
                  colors2: rgbColors2.rows.map((row) => row.map(() => color)),
                  save: false,
                });
              }}>{t(locale, "kb.wootingRgbStatic")}</button>
              <button type="button" className="om-btn" disabled={busy} onClick={() => void control.applyKeyboardCommand({ kind: "wootingRgbApply", save: true })}>{t(locale, "kb.wootingRgbSave")}</button>
            </div>
            <p className="setting-note">{t(locale, "kb.wootingRgbStaged")}</p>
          </>
        )}
      </article>
      <article className="setting-card keyboard-workspace-card wooting-profiles-card" hidden={snapshot.workspaceTab !== "profiles"}>
        <div className="setting-heading"><h2>{t(locale, "tab.profiles")}</h2></div>
        {status?.profileCount ? (
          <ul className="wooting-profiles">
            {Array.from({ length: status.profileCount }, (_, slot) => {
              const active = status.activeProfile === slot;
              return (
                <li key={slot} className={active ? "is-active" : ""}>
                  <span>{status.profileNames[slot] ?? tp(locale, "fprof.profileName", { n: slot + 1 })}</span>
                  {active ? <em>{t(locale, "fprof.active")}</em> : <button type="button" className="om-btn" disabled={busy} onClick={() => void control.applyKeyboardCommand({ kind: "wootingProfileSwitch", slot })}>{t(locale, "fprof.enable")}</button>}
                </li>
              );
            })}
          </ul>
        ) : <p className="setting-note">{t(locale, "kb.wootingProfilesEmpty")}</p>}
        <p className="setting-note">{t(locale, "kb.wootingProfileNote")}</p>
      </article>
      <article className="setting-card keyboard-workspace-card wooting-akc-card" hidden={snapshot.workspaceTab !== "advanced"}>
        <div className="setting-heading"><div><h2>{t(locale, "kb.wootingAkc")}</h2><small className="setting-note">{t(locale, "kb.wootingAkcNote")}</small></div></div>
        {capabilities?.transport !== "arm" ? <p className="setting-note">{t(locale, "kb.wootingAkcArmOnly")}</p> : (
          <>
            {akcMatrixKey === null ? <p className="setting-note">{t(locale, "kb.wootingAkcSelectKey")}</p> : (
              <>
                <div className="wooting-fields">
                  <div className="keyboard-field"><span>{t(locale, "kb.wootingAkcLayer")}</span>
                    <OptionMenu
                      ariaLabel={t(locale, "kb.wootingAkcLayer")}
                      value={akcLayer}
                      disabled={busy}
                      options={[0, 1, 2, 3].map((layer) => ({ value: layer, label: String(layer + 1) }))}
                      onChange={setAkcLayer}
                    />
                  </div>
                </div>
                <WootingAkcEditor
                  locale={locale}
                  matrixKey={akcMatrixKey}
                  busy={busy}
                  canSave={akcCombos.length < AKC_LIMIT || akcCombos.some((combo) => combo.keyIndex === akcMatrixKey && combo.layer === akcLayer)}
                  onSave={(payload) => void control.applyKeyboardCommand({ kind: "wootingAkcItem", keyIndex: akcMatrixKey, layer: akcLayer, payload })}
                />
                {akcCombos.length >= AKC_LIMIT ? <p className="setting-note">{t(locale, "kb.wootingAkcLimit")}</p> : null}
              </>
            )}
            {akcCombos.length === 0 ? <p className="setting-note">{t(locale, "kb.wootingAkcEmpty")}</p> : (
              <ul className="wooting-akc-list">
                {akcCombos.map((combo, index) => (
                  <li key={`${combo.keyIndex}-${combo.layer}-${index}`}>
                    <span>
                      {combo.kind === "unknown" ? t(locale, "kb.wootingAkcKind") : t(locale, AKC_KIND_LABELS[combo.kind])}
                      {" · "}
                      {KEY_LABEL_BY_MATRIX.get(combo.keyIndex) ?? `0x${combo.keyIndex.toString(16)}`}
                      {" · "}
                      {t(locale, "kb.wootingAkcLayer")} {combo.layer + 1}
                    </span>
                    <button type="button" className="om-btn" disabled={busy} onClick={() => void control.applyKeyboardCommand({ kind: "wootingAkcItem", keyIndex: combo.keyIndex, layer: combo.layer, payload: null })}>{t(locale, "kb.wootingAkcRemove")}</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </article>
      <article className="setting-card keyboard-workspace-card" hidden={snapshot.workspaceTab !== "advanced"}>
        <div className="setting-heading"><h2>{t(locale, "kb.wootingGlobal")}</h2></div>
        <dl className="keyboard-identity">
          {row(t(locale, "adv.debounce"), state(global?.debounceFilter))}
          {row(t(locale, "kb.wootingRgbDim"), global?.rgbSleep?.dimMinutes == null ? null : `${global.rgbSleep.dimMinutes} min`)}
          {row(t(locale, "kb.wootingRgbOff"), global?.rgbSleep?.offMinutes == null ? null : `${global.rgbSleep.offMinutes} min`)}
          {row(t(locale, "light.rgbParts"), status?.rgb ? [status.rgb.core, status.rgb.colors1, status.rgb.colors2, status.rgb.layer].filter(Boolean).length : null)}
        </dl>
      </article>
    </section>
  );
}
