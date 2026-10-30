import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ARBITER_ACTUATION_RANGE,
  ARBITER_LIGHT_EFFECTS,
  ARBITER_RAPID_TRIGGER_RANGE,
  arbiterLayout,
  arbiterMatrixToWire,
  arbiterMmToTravel,
  arbiterTravelToMm,
  arbiterWireToMatrix,
} from "@openmouse/keyboard-protocol/arbiter";
import type { ArbiterLightEffect, ArbiterProduct, ArbiterTable, ArbiterUserMode } from "@openmouse/keyboard-protocol/arbiter";
import { deckRows, keyWeight } from "../../../device/arbiter-deck";
import type { DeckKey } from "../../../device/arbiter-deck";
import * as control from "../../../device/controller";
import {
  ARBITER_KEY_CATEGORIES,
  ARBITER_KEY_CHOICES,
  arbiterEffectLabel,
  arbiterHexToRgb,
  arbiterKeyCategory,
  arbiterKeyLabel,
  arbiterRgbToHex,
} from "../../../device/arbiter-labels";
import type { ArbiterKeyCategory } from "../../../device/arbiter-labels";
import type { ArbiterWorkspace } from "../../../device/arbiter-workspace";
import type { ControlSnapshot } from "../../../device/types";
import type { InterfaceLocale } from "../../settings/interface-preferences";
import { displayText, t, tp } from "../../../i18n/index";
import { ColorPicker } from "../../../shared/ColorPicker";
import { OptionMenu, Segmented, StepperSlider, SwitchRow } from "../../../shared/ui";

const RAW = { min: 0, max: 255, step: 1, scale: ["0", "", "255"] as const };

/** Actuation and rapid trigger are tenths of a millimetre; the slider bounds are the vendor app's own. */
function travelSlider(range: { min: number; max: number }): { min: number; max: number; step: number; scale: readonly [string, string, string] } {
  const min = arbiterTravelToMm(range.min);
  const max = arbiterTravelToMm(range.max);
  return { min, max, step: 0.1, scale: [min.toFixed(1), "", max.toFixed(1)] };
}
const ACTUATION = travelSlider(ARBITER_ACTUATION_RANGE);
const RAPID = travelSlider(ARBITER_RAPID_TRIGGER_RANGE);
const mm = (value: number): string => `${value.toFixed(1)} mm`;
const inRange = (value: number, range: { min: number; max: number }): boolean => value >= range.min && value <= range.max;
const toTravel = (value: number, range: { min: number; max: number }): number => Math.min(range.max, Math.max(range.min, arbiterMmToTravel(value)));

const CATEGORY_KEY: Record<ArbiterKeyCategory, Parameters<typeof t>[1]> = {
  letters: "kb.arbCatLetters",
  numbers: "kb.arbCatNumbers",
  function: "kb.arbCatFunction",
  punctuation: "kb.arbCatPunctuation",
  navigation: "kb.arbCatNavigation",
  modifiers: "kb.arbCatModifiers",
  media: "kb.arbCatMedia",
  special: "kb.arbCatSpecial",
};

function keyName(locale: InterfaceLocale, code: number): string {
  return displayText(locale, arbiterKeyLabel(code) ?? tp(locale, "kb.arbCode", { n: code }));
}

/** The key a wire entry holds, by name; the bare number when the entry is not a key. */
function wireKeyName(locale: InterfaceLocale, product: ArbiterProduct, index: number): string {
  const matrix = arbiterWireToMatrix(product, "bindings", index);
  const key = matrix === null ? undefined : arbiterLayout(product).matrix[matrix];
  if (!key || key.name === "None") return String(index);
  return keyName(locale, key.keyCode);
}

function KeyDeck({ locale, product, table, label, sub, selected, onToggle, disabled, ariaLabel }: {
  locale: InterfaceLocale;
  product: ArbiterProduct;
  table: ArbiterTable;
  label: (key: DeckKey) => string;
  sub?: (key: DeckKey) => string | null;
  selected: ReadonlySet<number>;
  onToggle: (key: DeckKey) => void;
  disabled: boolean;
  ariaLabel: string;
}): ReactNode {
  const rows = useMemo(() => deckRows(product, table), [product, table]);
  return (
    <div className="keyboard-key-deck">
      <div className="arbiter-deck" role="group" aria-label={ariaLabel}>
        {rows.map((keys, index) => {
          const iso = keys.some((key) => key.code === 226);
          return (
            <div className="arbiter-deck-row" key={index}>
              {keys.map((key) => {
                const isSelected = selected.has(key.wire);
                const shown = label(key);
                const detail = sub?.(key) ?? null;
                return (
                  <button
                    type="button"
                    key={key.matrix}
                    disabled={disabled}
                    className={`keyboard-key arbiter-key${isSelected ? " is-selected" : ""}`}
                    style={{ flexGrow: keyWeight(key.code, iso) }}
                    aria-pressed={isSelected}
                    aria-label={displayText(locale, detail ? `${shown} · ${detail}` : shown)}
                    onClick={() => onToggle(key)}
                  >
                    <span>{displayText(locale, shown)}</span>
                    {detail ? <small>{detail}</small> : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IdentityCard({ snapshot, faulted, busy }: { snapshot: ControlSnapshot; faulted: boolean; busy: boolean }): ReactNode {
  const keyboard = snapshot.keyboard!;
  const locale = snapshot.preferences.locale;
  const notReported = t(locale, "kb.notReported");
  return (
    <article id="keyboard-card" className="setting-card keyboard-identity-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{keyboard.name}</h2>
      </div></div>
      <dl className="keyboard-identity">
        <div><dt>{t(locale, "kb.identityFirmware")}</dt><dd>{displayText(locale, keyboard.identity.firmwareVersion ?? notReported)}</dd></div>
        <div><dt>{t(locale, "kb.identitySerial")}</dt><dd>{keyboard.identity.serial ?? notReported}</dd></div>
      </dl>
      <button type="button" className="om-btn" disabled={busy || faulted} onClick={() => void control.applyKeyboardCommand({ kind: "refresh" })}>{t(locale, "kb.refresh")}</button>
    </article>
  );
}

function ProfileCard({ locale, product, disabled }: { locale: InterfaceLocale; product: ArbiterProduct; disabled: boolean }): ReactNode {
  if (product.profiles < 2) return null;
  return (
    <article className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.arbProfileTitle")}</h2>
        <small className="setting-note">{t(locale, "kb.arbProfileNote")}</small>
      </div></div>
      <Segmented
        id="arbiter-profile"
        ariaLabel={t(locale, "kb.arbProfileTitle")}
        disabled={disabled}
        value={null}
        options={Array.from({ length: product.profiles }, (_, profile) => ({ value: profile, label: tp(locale, "kb.arbProfileN", { n: profile + 1 }) }))}
        onChange={(profile) => void control.applyKeyboardCommand({ kind: "arbiterProfile", profile })}
      />
    </article>
  );
}

function TravelCard({ locale, arbiter, disabled }: { locale: InterfaceLocale; arbiter: ArbiterWorkspace; disabled: boolean }): ReactNode {
  const { product, travel } = arbiter;
  const [selected, setSelected] = useState<readonly number[]>([]);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const anchor = selected.length > 0 ? travel[selected[0]] : undefined;
  const toggle = (wire: number): void => setSelected((current) => current.includes(wire) ? current.filter((w) => w !== wire) : [...current, wire]);
  const apply = (field: "make" | "break", value: number): Promise<void> =>
    control.applyKeyboardCommand({ kind: "arbiterTravel", updates: selected.map((index) => ({ index, [field]: toTravel(value, field === "make" ? ARBITER_ACTUATION_RANGE : ARBITER_RAPID_TRIGGER_RANGE) })) });
  const outOfRange = anchor !== undefined && (!inRange(anchor.make, ARBITER_ACTUATION_RANGE) || !inRange(anchor.break, ARBITER_RAPID_TRIGGER_RANGE));
  return (
    <article id="keyboard-trigger-card" className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.arbTravelTitle")}</h2>
        <small className="setting-note">{t(locale, "kb.arbTravelNote")}</small>
      </div></div>
      {travel.length === 0 ? <p className="keyboard-empty">{t(locale, "kb.arbTravelMissing")}</p> : (
        <>
          <KeyDeck
            locale={locale} product={product} table="travel" disabled={disabled} ariaLabel={t(locale, "kb.arbTravelTitle")}
            label={(key) => arbiterKeyLabel(key.code) ?? tp(locale, "kb.arbCode", { n: key.code })}
            sub={(key) => { const entry = travel[key.wire]; return entry ? `${arbiterTravelToMm(entry.make).toFixed(1)}/${arbiterTravelToMm(entry.break).toFixed(1)}` : null; }}
            selected={chosen} onToggle={(key) => toggle(key.wire)}
          />
          <div className="keyboard-selection-actions">
            <span className="keyboard-selection-count">{tp(locale, "kb.selectedCount", { n: selected.length })}</span>
            <button type="button" className="om-btn is-sm" disabled={disabled} onClick={() => setSelected(deckRows(product, "travel").flat().map((key) => key.wire))}>{t(locale, "kb.selectAll")}</button>
            <button type="button" className="om-btn is-sm" disabled={disabled || selected.length === 0} onClick={() => setSelected([])}>{t(locale, "kb.clearSelection")}</button>
          </div>
          {anchor ? (
            <div className="keyboard-trigger-controls">
              <section className="keyboard-tuning-group">
                <h4>{t(locale, "kb.arbActuation")}</h4><p>{t(locale, "kb.arbActuationHint")}</p>
                <StepperSlider id="arbiter-make" label={t(locale, "kb.arbActuation")} value={arbiterTravelToMm(anchor.make)} {...ACTUATION} formatValue={mm} disabled={disabled} onCommit={(value) => apply("make", value)} />
              </section>
              <section className="keyboard-tuning-group">
                <h4>{t(locale, "kb.arbRapid")}</h4><p>{t(locale, "kb.arbRapidHint")}</p>
                <StepperSlider id="arbiter-break" label={t(locale, "kb.arbRapid")} value={arbiterTravelToMm(anchor.break)} {...RAPID} formatValue={mm} disabled={disabled} onCommit={(value) => apply("break", value)} />
              </section>
            </div>
          ) : <p className="keyboard-empty">{t(locale, "kb.arbSelectKeys")}</p>}
          {outOfRange ? <p className="setting-note">{t(locale, "kb.arbOutOfRange")}</p> : null}
        </>
      )}
    </article>
  );
}

function BindingsCard({ locale, arbiter, disabled }: { locale: InterfaceLocale; arbiter: ArbiterWorkspace; disabled: boolean }): ReactNode {
  const { product, bindings } = arbiter;
  const layout = useMemo(() => arbiterLayout(product), [product]);
  const [layer, setLayer] = useState(0);
  const [wire, setWire] = useState<number | null>(null);
  const [category, setCategory] = useState<ArbiterKeyCategory>("letters");
  const table = bindings[layer];
  const current = wire !== null ? table?.[wire]?.keyCode ?? null : null;
  const matrixIndex = useMemo(
    () => (wire === null ? null : layout.matrix.findIndex((_, matrix) => arbiterMatrixToWire(product, "bindings", matrix) === wire)),
    [layout, product, wire],
  );
  const factory = matrixIndex !== null && matrixIndex >= 0 ? layout.layers[layer]?.[matrixIndex] ?? null : null;
  useEffect(() => {
    if (current !== null) setCategory(arbiterKeyCategory(current) ?? "letters");
  }, [wire, layer]);
  const assign = (keyCode: number): Promise<void> =>
    wire === null ? Promise.resolve() : control.applyKeyboardCommand({ kind: "arbiterBindings", updates: [{ layer, index: wire, keyCode }] });
  const choices = useMemo(() => {
    const codes = [...ARBITER_KEY_CHOICES[category]];
    if (current !== null && !codes.includes(current) && arbiterKeyCategory(current) === null) codes.unshift(current);
    return codes.map((code) => ({ value: code, label: keyName(locale, code) }));
  }, [category, current, locale]);
  return (
    <article id="keyboard-bindings-card" className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.arbRemapTitle")}</h2>
        <small className="setting-note">{t(locale, "kb.arbRemapNote")}</small>
      </div></div>
      {product.layers > 1 ? (
        <Segmented
          id="arbiter-layer" ariaLabel={t(locale, "kb.arbLayer")} value={layer} disabled={disabled}
          options={[{ value: 0, label: t(locale, "kb.arbLayerMain") }, { value: 1, label: t(locale, "kb.arbLayerFn") }]}
          onChange={(next) => { setLayer(next); setWire(null); }}
        />
      ) : null}
      {!table ? <p className="keyboard-empty">{t(locale, "kb.arbBindingsMissing")}</p> : (
        <>
          <KeyDeck
            locale={locale} product={product} table="bindings" disabled={disabled} ariaLabel={t(locale, "kb.arbRemapTitle")}
            label={(key) => keyName(locale, table[key.wire]?.keyCode ?? key.code)}
            selected={new Set(wire === null ? [] : [wire])} onToggle={(key) => setWire(key.wire)}
          />
          {current !== null ? (
            <div className="keyboard-fields">
              <p className="setting-note">{tp(locale, "kb.arbAssigned", { key: keyName(locale, current) })}</p>
              <OptionMenu id="arbiter-category" ariaLabel={t(locale, "kb.arbCategory")} value={category} disabled={disabled}
                options={ARBITER_KEY_CATEGORIES.map((value) => ({ value, label: t(locale, CATEGORY_KEY[value]) }))} onChange={setCategory} />
              <OptionMenu id="arbiter-keycode" ariaLabel={t(locale, "kb.arbBinding")} value={current} disabled={disabled} options={choices} onChange={(code) => void assign(code)} />
              <button type="button" className="om-btn" disabled={disabled || factory === null || factory === current} onClick={() => factory !== null && void assign(factory)}>{t(locale, "kb.arbRestoreKey")}</button>
            </div>
          ) : <p className="keyboard-empty">{t(locale, "kb.arbSelectKey")}</p>}
        </>
      )}
    </article>
  );
}

function SuperTapCard({ locale, arbiter, disabled }: { locale: InterfaceLocale; arbiter: ArbiterWorkspace; disabled: boolean }): ReactNode {
  const { product, userMode } = arbiter;
  const [armed, setArmed] = useState<0 | 1 | null>(null);
  if (!product.superTap) return null;
  const write = (patch: Partial<ArbiterUserMode>): Promise<void> =>
    userMode ? control.applyKeyboardCommand({ kind: "arbiterUserMode", mode: { ...userMode, ...patch } }) : Promise.resolve();
  const pair = userMode?.keyIndex ?? null;
  const assign = (wire: number): void => {
    if (!pair || armed === null) return;
    const other = pair[armed === 0 ? 1 : 0];
    // Picking the key the other tile holds swaps the two, so the pair never repeats a key.
    const next: [number, number] = armed === 0 ? [wire, wire === other ? pair[0] : other] : [wire === other ? pair[1] : other, wire];
    setArmed(null);
    void write({ keyIndex: next });
  };
  const enabled = userMode ? userMode.checkFlag > 0 : null;
  return (
    <article className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.arbSuperTapTitle")}</h2>
        <small className="setting-note">{t(locale, "kb.arbSuperTapNote")}</small>
      </div></div>
      <SwitchRow
        id="arbiter-supertap" label={t(locale, "kb.arbSuperTapEnable")} disabled={disabled}
        value={enabled}
        onChange={(on) => { setArmed(null); void write({ checkFlag: on ? 1 : 0 }); }}
      />
      {pair && enabled ? (
        <>
          <div className="arbiter-supertap-tiles" role="group" aria-label={t(locale, "kb.arbSuperTapTitle")}>
            {([0, 1] as const).map((tile) => (
              <button
                type="button" key={tile} disabled={disabled}
                className={`om-btn arbiter-supertap-tile${armed === tile ? " is-armed" : ""}`}
                aria-pressed={armed === tile}
                onClick={() => setArmed(armed === tile ? null : tile)}
              >
                <small>{tp(locale, "kb.arbSuperTapKeyN", { n: tile + 1 })}</small>
                <span>{wireKeyName(locale, product, pair[tile])}</span>
              </button>
            ))}
          </div>
          <p className="setting-note">{armed === null ? t(locale, "kb.arbSuperTapArm") : tp(locale, "kb.arbSuperTapPick", { n: armed + 1 })}</p>
          <KeyDeck
            locale={locale} product={product} table="bindings" disabled={disabled || armed === null} ariaLabel={t(locale, "kb.arbSuperTapTitle")}
            label={(key) => keyName(locale, key.code)}
            selected={new Set(pair)} onToggle={(key) => assign(key.wire)}
          />
        </>
      ) : null}
    </article>
  );
}

function LightCard({ locale, arbiter, disabled }: { locale: InterfaceLocale; arbiter: ArbiterWorkspace; disabled: boolean }): ReactNode {
  const light = arbiter.light;
  const [draft, setDraft] = useState<ArbiterLightEffect | null>(light);
  const [slot, setSlot] = useState(0);
  const confirmed = JSON.stringify(light);
  useEffect(() => setDraft(light), [confirmed]);
  const raw = (value: number): string => tp(locale, "kb.arbRaw", { n: value });
  const edit = (patch: Partial<ArbiterLightEffect>): void => setDraft((current) => current && { ...current, ...patch });
  const changed = draft !== null && JSON.stringify(draft) !== confirmed;
  return (
    <article id="keyboard-lighting-card" className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.arbLightTitle")}</h2>
        <small className="setting-note">{t(locale, "kb.arbLightNote")}</small>
      </div></div>
      {!draft ? <p className="keyboard-empty">{t(locale, "kb.arbLightMissing")}</p> : (
        <>
          <div className="arbiter-light-grid">
            <div className="keyboard-fields">
              <SwitchRow id="arbiter-light-on" label={t(locale, "kb.arbLightOn")} value={draft.on} disabled={disabled} onChange={(on) => edit({ on })} />
              <OptionMenu id="arbiter-effect" ariaLabel={t(locale, "kb.arbEffect")} value={draft.effect} disabled={disabled}
                options={ARBITER_LIGHT_EFFECTS.map((_, value) => ({ value, label: arbiterEffectLabel(value) }))} onChange={(effect) => edit({ effect })} />
              <StepperSlider id="arbiter-brightness" label={t(locale, "kb.arbBrightness")} value={draft.brightness} {...RAW} formatValue={raw} disabled={disabled} onCommit={(brightness) => edit({ brightness })} />
              <StepperSlider id="arbiter-speed" label={t(locale, "kb.arbSpeed")} value={draft.speed} {...RAW} formatValue={raw} disabled={disabled} onCommit={(speed) => edit({ speed })} />
            </div>
            <div className="keyboard-fields arbiter-palette">
              <Segmented
                id="arbiter-color-slot" ariaLabel={t(locale, "kb.arbColors")} value={slot} disabled={disabled}
                options={draft.colors.map((_, value) => ({ value, label: String(value + 1) }))} onChange={setSlot}
              />
              <ColorPicker
                key={slot}
                id={`arbiter-color-${slot}`} ariaLabel={tp(locale, "kb.arbColorSlot", { n: slot + 1 })} disabled={disabled}
                value={arbiterRgbToHex(draft.colors[slot])}
                onChange={(hex) => edit({ colors: draft.colors.map((color, index) => index === slot ? arbiterHexToRgb(hex) : color) })}
              />
            </div>
          </div>
          <div className="arbiter-apply">
            <button type="button" className="om-btn" disabled={disabled || !changed} onClick={() => void control.applyKeyboardCommand({ kind: "arbiterLight", light: draft })}>{t(locale, "kb.arbApply")}</button>
          </div>
        </>
      )}
    </article>
  );
}

/**
 * Arbiter Studio keyboards. Every value is the raw number the keyboard
 * reported: the actuation and rapid-trigger unit is not known, so it is never
 * shown as millimetres.
 */
export function ArbiterKeyboardPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  if (!keyboard) return null;
  const locale = snapshot.preferences.locale;
  const arbiter = keyboard.workspace.arbiter ?? null;
  const faulted = keyboard.faulted === true;
  const busy = keyboard.trigger.busy;
  const disabled = busy || faulted;
  const tab = snapshot.workspaceTab;
  return (
    <section className="keyboard-panel" data-workspace-host role="tabpanel" aria-labelledby={`workspace-tab-${tab}`}>
      {keyboard.trigger.statusText ? <output className="keyboard-status" role="status">{displayText(locale, keyboard.trigger.statusText)}</output> : null}
      {arbiter !== null && !arbiter.product.verified ? <p className="setting-note arbiter-note">{t(locale, "kb.arbUnverified")}</p> : null}
      {faulted ? (
        <div className="arbiter-fault" role="alert">
          <p className="setting-note">{t(locale, "kb.arbFaulted")}</p>
          <button type="button" className="om-btn" disabled={busy} onClick={() => void control.reconnectKeyboard()}>{t(locale, "kb.arbReconnect")}</button>
        </div>
      ) : null}
      {arbiter === null ? (
        <article className="setting-card keyboard-workspace-card"><p className="keyboard-empty">{t(locale, "kb.arbReading")}</p></article>
      ) : (
        <>
          {tab === "overview" ? <><IdentityCard snapshot={snapshot} faulted={faulted} busy={busy} /><ProfileCard locale={locale} product={arbiter.product} disabled={disabled} /></> : null}
          {tab === "performance" ? <TravelCard locale={locale} arbiter={arbiter} disabled={disabled} /> : null}
          {tab === "buttons" ? <><BindingsCard locale={locale} arbiter={arbiter} disabled={disabled} /><SuperTapCard locale={locale} arbiter={arbiter} disabled={disabled} /></> : null}
          {tab === "lighting" ? <LightCard locale={locale} arbiter={arbiter} disabled={disabled} /> : null}
        </>
      )}
    </section>
  );
}
