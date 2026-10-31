import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  VIA_MOD, describeViaKeycode, evaluateViaCondition, viaActiveKeys, viaComposeKeycode, viaKeycodeFromName, viaKeycodePicker, viaNumberToBytes, viaValueToNumber,
  type ViaDefinition, type ViaKey, type ViaKeycodeGroupId, type ViaMenuItem,
} from "@openmouse/keyboard-protocol/via";
import type { ControlSnapshot } from "../../../device/types";
import * as control from "../../../device/controller";
import { hexToViaColor, viaColorToHex, viaOsLegend, viaValueKey, type ViaLayoutMap, type ViaWorkspace } from "../../../device/via-keyboard";
import { displayText, t, tp, type I18nKey } from "../../../i18n/index";
import { OptionMenu, Segmented, StepperSlider, SwitchRow } from "../../../shared/ui";
import { ViaBackupCard } from "./ViaBackupCard";
import { ViaMacroEditor } from "./ViaMacroEditor";

const COMMIT_DELAY_MS = 300;

const GROUP_LABEL: Record<ViaKeycodeGroupId, I18nKey> = {
  letters: "kb.viaGroupLetters",
  numbers: "kb.viaGroupNumbers",
  symbols: "kb.viaGroupSymbols",
  function: "kb.viaGroupFunction",
  navigation: "kb.viaGroupNavigation",
  keypad: "kb.viaGroupKeypad",
  modifiers: "kb.viaGroupModifiers",
  media: "kb.viaGroupMedia",
  special: "kb.viaGroupSpecial",
  layers: "kb.viaGroupLayers",
  macros: "kb.viaGroupMacros",
  lighting: "kb.viaGroupLighting",
  custom: "kb.viaGroupCustom",
};

const COMPOSE_KINDS = [
  { value: "layerTap", label: "kb.viaComposeLayerTap" },
  { value: "modTap", label: "kb.viaComposeModTap" },
  { value: "mods", label: "kb.viaComposeMods" },
] as const satisfies readonly { value: string; label: I18nKey }[];
const COMPOSE_MODS = [
  { bit: VIA_MOD.ctrl, label: "Ctrl" }, { bit: VIA_MOD.shift, label: "Shift" },
  { bit: VIA_MOD.alt, label: "Alt" }, { bit: VIA_MOD.gui, label: "Win" }, { bit: VIA_MOD.right, label: "R" },
];

const HEX_KEYCODE = /^(?:0x)?([0-9a-f]{1,4})$/i;

/** The board's geometry is data, so the only inline styles are positions in key units (`--u` is the pixel size of one unit). */
function boardStyle(definition: ViaDefinition): CSSProperties {
  return {
    "--u": `clamp(34px, calc(100cqw / ${definition.width}), 56px)`,
    position: "relative",
    width: `calc(${definition.width} * var(--u))`,
    height: `calc(${definition.height} * var(--u))`,
    marginInline: "auto",
  } as CSSProperties;
}

function keyStyle(key: ViaKey, longLegend: boolean): CSSProperties {
  return {
    position: "absolute",
    left: `calc(${key.x} * var(--u))`,
    top: `calc(${key.y} * var(--u))`,
    width: `calc(${key.w} * var(--u) - 4px)`,
    height: `calc(${key.h} * var(--u) - 4px)`,
    margin: "2px",
    minHeight: 0,
    padding: "2px",
    overflowWrap: "normal",
    lineHeight: 1.1,
    fontSize: `clamp(8px, calc(var(--u) * ${longLegend ? 0.22 : 0.27}), var(--fs-meta))`,
    ...(key.r ? { transform: `rotate(${key.r}deg)`, transformOrigin: `calc(${key.rx - key.x} * var(--u)) calc(${key.ry - key.y} * var(--u))` } : {}),
  };
}

/** Shows the dragged value at once and writes it once the hand pauses and the board is free; the draft clears when the write settles. */
function useDebouncedCommit<T>(value: T, commit: (next: T) => Promise<void>, busy: boolean): [T, (next: T) => void] {
  const [draft, setDraft] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busyNow = useRef(busy);
  busyNow.current = busy;
  useEffect(() => () => clearTimeout(timer.current), []);
  const set = (next: T): void => {
    setDraft(next);
    clearTimeout(timer.current);
    // A command already running would swallow the write, so wait for it instead of dropping the change.
    const fire = (): void => {
      if (busyNow.current) { timer.current = setTimeout(fire, COMMIT_DELAY_MS); return; }
      void commit(next).finally(() => setDraft(null));
    };
    timer.current = setTimeout(fire, COMMIT_DELAY_MS);
  };
  return [draft ?? value, set];
}

function ViaControl({ item, value, disabled, locale, onWrite }: {
  item: ViaMenuItem;
  value: readonly number[] | null;
  disabled: boolean;
  locale: ControlSnapshot["preferences"]["locale"];
  onWrite: (bytes: readonly number[], verify: boolean, exact?: boolean) => Promise<void>;
}): ReactNode {
  const label = displayText(locale, item.label);
  const write = (number: number, verify = true, exact = false): Promise<void> => onWrite(viaNumberToBytes(number, item.bytes), verify, exact);
  const spec = item.control;
  const number = value ? viaValueToNumber(value) : null;
  const colorValue = value && value.length >= 2 ? viaColorToHex(value[0]!, value[1]!) : "#ffffff";
  const [colorShown, setColor] = useDebouncedCommit<string>(colorValue, (hex) => {
    const { hue, saturation } = hexToViaColor(hex);
    return onWrite([hue, saturation], true);
  }, disabled);
  if (spec.type === "range") {
    return <StepperSlider id={`via-${item.ids.join("-")}`} label={label} value={number ?? spec.min} min={spec.min} max={spec.max} step={1}
      scale={[String(spec.min), "", String(spec.max)]} formatValue={(shown) => `${shown}${spec.unit ? ` ${spec.unit}` : ""}`}
      disabled={disabled || number === null} onCommit={(next) => write(next, true, true)} />;
  }
  if (spec.type === "toggle") {
    return <SwitchRow label={label} value={number === null ? null : spec.anyOn ? number !== spec.off : number === spec.on} disabled={disabled} onChange={(on) => void write(on ? spec.on : spec.off)} />;
  }
  if (spec.type === "dropdown") {
    return <div className="keyboard-field"><span>{label}</span>
      <OptionMenu ariaLabel={label} value={number} disabled={disabled || number === null}
        options={spec.options.map((option) => ({ value: option.value, label: displayText(locale, option.label) }))}
        onChange={(next) => void write(next)} /></div>;
  }
  if (spec.type === "color") {
    return <label className="keyboard-color-field"><span>{label}</span>
      <input type="color" value={colorShown} disabled={disabled || value === null} onInput={(event) => setColor(event.currentTarget.value)} /></label>;
  }
  return <div className="keyboard-field"><span>{label}</span>
    <button type="button" className="om-btn is-sm" disabled={disabled} onClick={() => void write(spec.value, false)}>{label}</button></div>;
}

function tokenValues(via: ViaWorkspace): ReadonlyMap<string, number> {
  const known = new Map<string, number>();
  for (const menu of via.menus) {
    for (const section of menu.sections) {
      for (const item of section.items) {
        const bytes = via.values[viaValueKey(item.ids)];
        if (bytes) known.set(item.token, viaValueToNumber(bytes));
      }
    }
  }
  return known;
}

const hexId = (vendorId: number, productId: number): string =>
  `${vendorId.toString(16).padStart(4, "0")}:${productId.toString(16).padStart(4, "0")}`.toUpperCase();

/** The OS keyboard layout, when the browser exposes it, so keys can show the user's own letters. */
function useLayoutMap(): ViaLayoutMap | null {
  const [layout, setLayout] = useState<ViaLayoutMap | null>(null);
  useEffect(() => {
    const keyboardApi = (navigator as { keyboard?: { getLayoutMap?: () => Promise<ViaLayoutMap> } }).keyboard;
    void keyboardApi?.getLayoutMap?.().then(setLayout).catch(() => undefined);
  }, []);
  return layout;
}

/** Polls which switches are down while the tester is open; quiet, so the rest of the page does not redraw. */
function useHeldKeys(active: boolean): readonly number[] {
  const [held, setHeld] = useState<readonly number[]>([]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      const rows = await control.probeKeyboardKeys();
      if (!live) return;
      if (rows) setHeld((previous) => (previous.join() === rows.join() ? previous : rows));
      timer = setTimeout(() => void tick(), 60);
    };
    void tick();
    return () => { live = false; clearTimeout(timer); setHeld([]); };
  }, [active]);
  return held;
}

export function ViaKeyboardPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  const via = keyboard?.workspace.via ?? null;
  const definition = via?.definition ?? null;
  const [layer, setLayer] = useState(0);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [groupId, setGroupId] = useState<ViaKeycodeGroupId>("letters");
  const [hex, setHex] = useState("");
  const [encoder, setEncoder] = useState<{ id: number; clockwise: boolean } | null>(null);
  const layoutMap = useLayoutMap();
  const held = useHeldKeys(snapshot.workspaceTab === "advanced" && Boolean(definition));
  const [composeKind, setComposeKind] = useState<(typeof COMPOSE_KINDS)[number]["value"]>("layerTap");
  const [composeLayer, setComposeLayer] = useState(0);
  const [composeMods, setComposeMods] = useState(0);
  const [composeKey, setComposeKey] = useState("");
  const activeKeys = useMemo(() => (definition && via ? viaActiveKeys(definition, via.layoutChoices) : []), [definition, via]);
  const groups = useMemo(() => (via ? viaKeycodePicker(via.protocolVersion, via.layerCount, via.macros?.count ?? 0, { modules: definition?.keycodeModules, custom: definition?.customKeycodes }) : []), [via, definition]);
  if (!keyboard) return null;

  const locale = snapshot.preferences.locale;
  const busy = keyboard.trigger.busy;
  const status = keyboard.workspace.vendorStatus;
  const notReported = t(locale, "kb.notReported");
  const keys = activeKeys.filter((key) => key.row >= 0);
  const layerCount = via?.keymap?.length ?? 0;
  const activeLayer = Math.min(layer, Math.max(layerCount - 1, 0));
  const keymapLayer = via?.keymap?.[activeLayer] ?? null;
  const cols = definition?.matrix.cols ?? 0;
  const codeAt = (row: number, col: number): number | null => keymapLayer?.[row * cols + col] ?? null;
  const current = encoder ? via?.encoders?.[activeLayer]?.[encoder.id]?.[encoder.clockwise ? 1 : 0] ?? null : selected ? codeAt(selected.row, selected.col) : null;
  const encoderCount = via?.encoders?.[0]?.length ?? 0;
  const legend = (code: number): { label: string; title: string } => {
    const named = describeViaKeycode(code, via?.protocolVersion ?? 0, definition?.customKeycodes);
    const own = viaOsLegend(code, layoutMap);
    return own ? { ...named, label: own } : named;
  };
  const group = groups.find((entry) => entry.id === groupId) ?? groups[0];
  const protocol = via?.protocolVersion ?? 0;
  const hexMatch = HEX_KEYCODE.exec(hex.trim());
  const known = via ? tokenValues(via) : null;
  const shown = (showIf: string | undefined): boolean => !showIf || evaluateViaCondition(showIf, (token) => known?.get(token));
  const writeValue = (item: ViaMenuItem) => (bytes: readonly number[], verify: boolean, exact = false): Promise<void> =>
    control.applyKeyboardCommand({ kind: "viaSetValue", ids: item.ids, value: bytes, verify, exact });

  const apply = (keycode: number): void => {
    if (encoder) {
      void control.applyKeyboardCommand({ kind: "viaSetEncoder", layer: activeLayer, id: encoder.id, clockwise: encoder.clockwise, keycode });
      return;
    }
    if (!selected) return;
    void control.applyKeyboardCommand({ kind: "viaSetKey", layer: activeLayer, row: selected.row, col: selected.col, keycode });
  };
  const composeBase = viaKeycodeFromName(composeKey.trim().replace(/^KC_/i, "KC_").replace(/^(?!KC_)/i, "KC_"));
  const composed = composeBase === null || composeBase > 0xff || (composeKind !== "layerTap" && composeMods === 0) ? null
    : composeKind === "layerTap" ? viaComposeKeycode({ kind: composeKind, layer: composeLayer, key: composeBase }, protocol)
    : viaComposeKeycode({ kind: composeKind, mods: composeMods, key: composeBase }, protocol);
  const submitHex = (event: FormEvent): void => {
    event.preventDefault();
    if (hexMatch) apply(Number.parseInt(hexMatch[1]!, 16));
  };

  const renderBoard = (marked: (key: ViaKey) => boolean, pick: ((key: ViaKey) => void) | null): ReactNode => (
    <div className="keyboard-key-deck" style={{ containerType: "inline-size" } as CSSProperties}>
      <div className="keyboard-matrix">
        <div style={definition ? boardStyle(definition) : undefined}>
          {keys.map((key, index) => {
            const code = codeAt(key.row, key.col);
            const named = code === null ? null : legend(code);
            const on = marked(key);
            return <button key={`${key.row}:${key.col}:${index}`} type="button" style={keyStyle(key, (named?.label.length ?? 0) > 5)}
              className={`keyboard-key${on ? " is-selected" : ""}`}
              aria-pressed={on} disabled={busy || !pick} tabIndex={pick ? undefined : -1}
              aria-label={displayText(locale, `${tp(locale, "kb.viaKeyPosition", { row: key.row, col: key.col })}: ${named?.title ?? ""}`)}
              title={named ? displayText(locale, named.title) : undefined}
              onClick={() => pick?.(key)}>{named ? displayText(locale, named.label) : "-"}</button>;
          })}
        </div>
      </div>
    </div>
  );

  return (
    <section className="keyboard-panel" data-workspace-host role="tabpanel" aria-labelledby={`workspace-tab-${snapshot.workspaceTab}`}>
      {keyboard.trigger.statusText ? <output className="keyboard-status" role="status">{displayText(locale, keyboard.trigger.statusText)}</output> : null}

      <article className="setting-card keyboard-identity-card keyboard-workspace-card" hidden={snapshot.workspaceTab !== "overview"}>
        <div className="setting-heading"><div><h2>{keyboard.name}</h2>
          <small className="setting-note">{t(locale, "kb.viaUnverified")}</small></div>
          <button className="om-btn" type="button" disabled={busy} onClick={() => void control.applyKeyboardCommand({ kind: "refresh" })}>{t(locale, "kb.refresh")}</button>
        </div>
        <dl className="keyboard-identity">
          <div><dt>{t(locale, "kb.identityFirmware")}</dt><dd>{displayText(locale, status?.firmwareVersion ?? notReported)}</dd></div>
          <div><dt>{t(locale, "kb.viaProtocol")}</dt><dd>{status?.via?.protocolVersion ?? notReported}</dd></div>
          <div><dt>{t(locale, "kb.viaLayers")}</dt><dd>{status?.via?.layerCount ?? notReported}</dd></div>
          <div><dt>{t(locale, "kb.viaMacroSlots")}</dt><dd>{status?.via?.macroCount ?? notReported}</dd></div>
          {definition ? <>
            <div><dt>{t(locale, "kb.viaDefinition")}</dt><dd>{displayText(locale, definition.name)}</dd></div>
            <div><dt>{t(locale, "kb.viaMatrix")}</dt><dd>{`${definition.matrix.rows}×${definition.matrix.cols}`}</dd></div>
            <div><dt>{t(locale, "kb.viaKeyCount")}</dt><dd>{keys.length}</dd></div>
          </> : null}
        </dl>
        {via?.definitionError === "notFound" ? <p className="setting-note">{tp(locale, "kb.viaDefinitionMissing", { id: hexId(keyboard.vendorId, keyboard.productId) })}</p> : null}
        {via?.definitionError === "offline" ? <p className="setting-note">{t(locale, "kb.viaDefinitionOffline")}</p> : null}
      </article>

      <article className="setting-card keyboard-workspace-card is-wide" hidden={snapshot.workspaceTab !== "buttons"}>
        <div className="setting-heading"><div><h2>{t(locale, "kb.viaKeymapTitle")}</h2>
          <small className="setting-note">{t(locale, "kb.viaKeymapNote")}</small></div></div>
        {definition && via?.keymap ? <>
          {layerCount > 1 ? <Segmented ariaLabel={t(locale, "kb.viaLayerPicker")} value={activeLayer} disabled={busy}
            options={via.keymap.map((_, index) => ({ value: index, label: tp(locale, "kb.viaLayer", { n: index }) }))}
            onChange={setLayer} /> : null}
          {definition.labels.length > 0 ? <div className="keyboard-fields">
            {definition.labels.map((label, index) => {
              const choice = via.layoutChoices[index] ?? 0;
              const choose = (next: number): void => void control.applyKeyboardCommand({
                kind: "viaSetLayout", choices: definition.labels.map((_, at) => (at === index ? next : via.layoutChoices[at] ?? 0)),
              });
              if (typeof label === "string") {
                return <SwitchRow key={index} label={label} value={choice === 1} disabled={busy} onChange={(on) => choose(on ? 1 : 0)} />;
              }
              if (Array.isArray(label) && typeof label[0] === "string") {
                return <div className="keyboard-field" key={index}><span>{displayText(locale, label[0])}</span>
                  <OptionMenu ariaLabel={displayText(locale, label[0])} value={choice} disabled={busy}
                    options={label.slice(1).filter((name): name is string => typeof name === "string").map((name, at) => ({ value: at, label: displayText(locale, name) }))}
                    onChange={choose} /></div>;
              }
              return null;
            })}
          </div> : null}
          {renderBoard((key) => selected?.row === key.row && selected.col === key.col, (key) => { setSelected({ row: key.row, col: key.col }); setEncoder(null); })}
          {encoderCount > 0 ? <div className="keyboard-selection-actions">
            {Array.from({ length: encoderCount }, (_, id) => [false, true].map((clockwise) => {
              const code = via?.encoders?.[activeLayer]?.[id]?.[clockwise ? 1 : 0] ?? 0;
              const on = encoder?.id === id && encoder.clockwise === clockwise;
              return <button key={`${id}:${clockwise}`} type="button" className={`om-btn is-sm${on ? " is-primary" : ""}`} disabled={busy} aria-pressed={on}
                title={displayText(locale, legend(code).title)}
                onClick={() => { setEncoder({ id, clockwise }); setSelected(null); }}>
                {tp(locale, "kb.viaEncoderSlot", { n: id, dir: t(locale, clockwise ? "kb.viaEncoderRight" : "kb.viaEncoderLeft") })}: {displayText(locale, legend(code).label)}</button>;
            }))}
          </div> : null}
          {(selected || encoder) && current !== null ? <div className="keyboard-trigger-editor">
            <div className="keyboard-editor-heading"><div>
              <h3>{encoder ? tp(locale, "kb.viaEncoderSlot", { n: encoder.id, dir: t(locale, encoder.clockwise ? "kb.viaEncoderRight" : "kb.viaEncoderLeft") }) : tp(locale, "kb.viaKeyPosition", { row: selected!.row, col: selected!.col })}</h3>
              <p>{t(locale, "kb.viaKeyNow")}: {displayText(locale, legend(current).title)}</p>
            </div></div>
            <Segmented ariaLabel={t(locale, "kb.viaKeycodeGroups")} value={group?.id} disabled={busy}
              options={groups.filter((entry) => entry.keycodes.length > 0).map((entry) => ({ value: entry.id, label: t(locale, GROUP_LABEL[entry.id]) }))}
              onChange={setGroupId} />
            <div className="keyboard-selection-actions">
              {group?.keycodes.map((code) => {
                const named = legend(code);
                return <button key={code} type="button" className={`om-btn is-sm${code === current ? " is-primary" : ""}`}
                  disabled={busy} aria-pressed={code === current} title={displayText(locale, named.title)}
                  onClick={() => apply(code)}>{displayText(locale, named.label)}</button>;
              })}
            </div>
            <form className="keyboard-inline-form" onSubmit={submitHex}>
              <label className="keyboard-field"><span>{t(locale, "kb.viaCustomKeycode")}</span>
                <input type="text" autoComplete="off" spellcheck={false} placeholder={t(locale, "kb.viaCustomHint")}
                  value={hex} disabled={busy} onChange={(event) => setHex(event.currentTarget.value)} /></label>
              <button type="submit" className="om-btn is-sm" disabled={busy || hexMatch === null}>{t(locale, "kb.apply")}</button>
            </form>
            <div className="keyboard-inline-form">
              <div className="keyboard-field"><span>{t(locale, "kb.viaCompose")}</span>
                <OptionMenu ariaLabel={t(locale, "kb.viaCompose")} value={composeKind} disabled={busy}
                  options={COMPOSE_KINDS.map((kind) => ({ value: kind.value, label: t(locale, kind.label) }))} onChange={setComposeKind} /></div>
              {composeKind === "layerTap" ? <div className="keyboard-field"><span>{t(locale, "kb.viaComposeLayer")}</span>
                <OptionMenu ariaLabel={t(locale, "kb.viaComposeLayer")} value={composeLayer} disabled={busy}
                  options={Array.from({ length: Math.min(via?.layerCount ?? 1, 16) }, (_, index) => ({ value: index, label: String(index) }))}
                  onChange={setComposeLayer} /></div>
                : <div className="keyboard-selection-actions">{COMPOSE_MODS.map((mod) => (
                  <button key={mod.bit} type="button" className={`om-btn is-sm${composeMods & mod.bit ? " is-primary" : ""}`} disabled={busy}
                    aria-pressed={(composeMods & mod.bit) !== 0} onClick={() => setComposeMods(composeMods ^ mod.bit)}>{mod.label}</button>))}</div>}
              <label className="keyboard-field"><span>{t(locale, "kb.viaComposeKey")}</span>
                <input type="text" autoComplete="off" spellcheck={false} placeholder="A" value={composeKey} disabled={busy}
                  onChange={(event) => setComposeKey(event.currentTarget.value)} /></label>
              <button type="button" className="om-btn is-sm" disabled={busy || composed === null} onClick={() => composed !== null && apply(composed)}>{t(locale, "kb.apply")}</button>
            </div>
          </div> : <p className="keyboard-empty">{t(locale, "kb.viaSelectKey")}</p>}
        </> : <p className="keyboard-empty">{via?.definitionError === "notFound"
          ? tp(locale, "kb.viaDefinitionMissing", { id: hexId(keyboard.vendorId, keyboard.productId) })
          : via?.definitionError === "offline" ? t(locale, "kb.viaDefinitionOffline") : t(locale, "kb.viaNoKeymap")}</p>}
      </article>

      <article className="setting-card keyboard-workspace-card is-wide" hidden={snapshot.workspaceTab !== "advanced"}>
        <div className="setting-heading"><div><h2>{t(locale, "kb.viaTesterTitle")}</h2>
          <small className="setting-note">{t(locale, "kb.viaTesterNote")}</small></div></div>
        {definition && via?.keymap ? renderBoard((key) => Math.floor((held[key.row] ?? 0) / 2 ** key.col) % 2 === 1, null)
          : <p className="keyboard-empty">{t(locale, "kb.viaNoKeymap")}</p>}
      </article>

      <ViaBackupCard snapshot={snapshot} />

      <ViaMacroEditor snapshot={snapshot} />

      <article className="setting-card keyboard-workspace-card is-wide" hidden={snapshot.workspaceTab !== "lighting"}>
        <div className="setting-heading"><div><h2>{t(locale, "kb.viaLightingTitle")}</h2>
          <small className="setting-note">{t(locale, "kb.viaLightingNote")}</small></div></div>
        {via && via.menus.length > 0 ? via.menus.filter((menu) => shown(menu.showIf)).map((menu, menuIndex) => (
          <div className="keyboard-fields" key={menuIndex}>
            {menu.label ? <strong>{displayText(locale, menu.label)}</strong> : null}
            {menu.sections.map((section, sectionIndex) => {
              const items = section.items.filter((item) => shown(item.showIf));
              return items.length === 0 ? null : (
                <div className="keyboard-fields" key={sectionIndex}>
                  {section.label ? <small className="setting-note">{displayText(locale, section.label)}</small> : null}
                  {items.map((item) => (
                    <ViaControl key={viaValueKey(item.ids)} item={item} locale={locale} disabled={busy}
                      value={via.values[viaValueKey(item.ids)] ?? null} onWrite={writeValue(item)} />
                  ))}
                </div>
              );
            })}
          </div>
        )) : <p className="keyboard-empty">{t(locale, "kb.viaNoMenus")}</p>}
      </article>
    </section>
  );
}
