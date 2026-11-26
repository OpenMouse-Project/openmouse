import type { ControlSnapshot } from "../../../device/types";
import { useState } from "react";
import { KEYCHRON_RECEIVER_KEYS } from "@openmouse/protocol/keychron";
import { deviceImage } from "../../../shared/device-images";
import { ColorPicker } from "../../../shared/ColorPicker";
import { displayText, t } from "../../../i18n/index";
import * as control from "../../../device/controller";
import type { MouseLighting, MouseLightingMode } from "@openmouse/protocol/drivers/mouse-types";

const SYMBOLS: Record<string, string> = {
  Minus: "−", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";",
  Quote: "'", Backquote: "`", Comma: ",", Period: ".", Slash: "/",
  NumpadDivide: "÷", NumpadMultiply: "×", NumpadSubtract: "−", NumpadAdd: "+", NumpadDecimal: ".",
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
};
const keyLegend = (name: string) => SYMBOLS[name] ?? name;

export function KeychronReceiverButtonsCard({ snapshot }: { snapshot: ControlSnapshot }) {
  const [selected, setSelected] = useState("Polling");
  const [editorOpen, setEditorOpen] = useState(false);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [modifiers, setModifiers] = useState<string[]>([]);
  const [key, setKey] = useState("");
  const receiver = snapshot.status?.keychronReceiver;
  if (!receiver) return null;
  const locale = snapshot.preferences.locale;
  const button = selected in receiver.buttonMappings ? selected : Object.keys(receiver.buttonMappings)[0]!;
  const current = receiver.buttonMappings[button];
  const categories = ["all", "mouse", "shortcuts", "combos", "media", "rates", "lighting", "disable"] as const;
  const group = (action: string) => /^(DPI|Polling)/.test(action) ? "rates"
    : /^(Lighting|Optical|Magnetic|Toggle optical)/.test(action) ? "lighting"
    : /^(Volume|Mute|Play|Next Track|Previous Track)/.test(action) ? "media"
    : /^(Copy|Cut|Paste|Screenshot|Show Desktop|Zoom|Launchpad|Mission Control|Brightness)/.test(action) ? "shortcuts"
    : action === "Disabled" ? "disable" : "mouse";
  const actions = receiver.buttonOptions.filter(action => (category === "all" || group(action) === category)
    && displayText(locale, action).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const assign = (action: string) => control.applyKeychronReceiverButton(button, action);
  const combination = key ? `Keyboard: ${[...["Ctrl", "Shift", "Alt", "Win"].filter(value => modifiers.includes(value)), key].join("+")}` : "";
  return <article className="setting-card keychron-receiver-buttons">
    <div className="setting-heading"><div><h2>{t(locale, "magnetic.receiverButtons")}</h2></div></div>
    <small className="setting-note">{receiver.name} {receiver.firmware}</small>
    <div className="receiver-button-grid">
      <img className="receiver-artwork" src={deviceImage(null, receiver.name)} alt={receiver.name} />
      {Object.entries(receiver.buttonMappings).map(([name, action]) => <button type="button"
        className="receiver-button" key={name} aria-pressed={button === name} disabled={snapshot.settingInProgress}
        onClick={() => { setSelected(name); setEditorOpen(true); }}>
        <strong>{displayText(locale, name)}</strong><span>{action.startsWith("Keyboard: ") ? action.slice(10) : displayText(locale, action)}</span>
      </button>)}
    </div>
    <div className="receiver-assignment">
      <button type="button" className="receiver-editor-toggle" aria-expanded={editorOpen}
        aria-controls="receiver-assignment-editor" onClick={() => setEditorOpen(open => !open)}>
        <strong>{t(locale, "receiver.assign")}</strong><span>{displayText(locale, button)} {editorOpen ? "▴" : "▾"}</span>
      </button>
      {editorOpen ? <div id="receiver-assignment-editor" className="receiver-assignment-body">
      <div className="receiver-categories" role="group" aria-label={t(locale, "receiver.assign")}>
        {categories.map(item => <button type="button" key={item} aria-pressed={category === item}
          onClick={() => setCategory(item)}>{t(locale, `receiver.${item}`)}</button>)}
      </div>
      {category === "combos" ? <div className="receiver-combination">
        <div className="receiver-categories">
          {["Ctrl", "Shift", "Alt", "Win"].map(modifier => <button type="button" key={modifier}
            aria-pressed={modifiers.includes(modifier)} onClick={() => setModifiers(previous =>
              previous.includes(modifier) ? previous.filter(item => item !== modifier) : [...previous, modifier])}>{modifier}</button>)}
        </div>
        <input readOnly aria-label={t(locale, "receiver.capture")} placeholder={t(locale, "receiver.capture")}
          value={combination.slice(10)} onKeyDown={event => {
            if (event.key === "Tab") return;
            event.preventDefault();
            const name = event.code.replace(/^(Key|Digit)/, "");
            if (!KEYCHRON_RECEIVER_KEYS.some(([value]) => value === name)) return;
            setKey(name); setModifiers([...(event.ctrlKey ? ["Ctrl"] : []), ...(event.shiftKey ? ["Shift"] : []),
              ...(event.altKey ? ["Alt"] : []), ...(event.metaKey ? ["Win"] : [])]);
          }} />
        <div className="receiver-key-grid">{KEYCHRON_RECEIVER_KEYS.map(([name]) => <button type="button" key={name}
          aria-pressed={key === name} title={name} onClick={() => setKey(name)}>{keyLegend(name)}</button>)}</div>
        <button type="button" className="om-btn" disabled={!combination || snapshot.settingInProgress}
          onClick={() => assign(combination)}>{t(locale, "receiver.apply")}</button>
      </div> : category === "disable" ? <button type="button" className="om-btn" disabled={snapshot.settingInProgress}
        onClick={() => assign("Disabled")}>{t(locale, "receiver.confirmDisable")}</button> : <>
        <input type="search" value={search} aria-label={t(locale, "receiver.search")} placeholder={t(locale, "receiver.search")}
          onInput={event => setSearch(event.currentTarget.value)} />
        <div className="receiver-action-grid">{actions.map(action => <button type="button" key={action}
          aria-pressed={action === current} disabled={snapshot.settingInProgress}
          onClick={() => action === "Disabled" ? setCategory("disable") : assign(action)}>
          {displayText(locale, action)}</button>)}</div>
        {!actions.length ? <p className="setting-note">{t(locale, "receiver.empty")}</p> : null}
        {category === "all" || category === "mouse" ? <div className="receiver-key-grid">
          {KEYCHRON_RECEIVER_KEYS.filter(([name]) => name.toLowerCase().includes(search.trim().toLowerCase())
            || keyLegend(name).includes(search.trim())).map(([name]) => <button type="button" key={name}
              title={name} aria-pressed={current === `Keyboard: ${name}`} disabled={snapshot.settingInProgress}
              onClick={() => assign(`Keyboard: ${name}`)}>{keyLegend(name)}</button>)}
        </div> : null}
      </>}
      </div> : null}
    </div>
  </article>;
}

export function KeychronReceiverLightingCard({ snapshot }: { snapshot: ControlSnapshot }) {
  const receiver = snapshot.status?.keychronReceiver;
  if (!receiver) return null;
  const locale = snapshot.preferences.locale;
  const lighting = receiver.lighting;
  const apply = (patch: Partial<MouseLighting>) => control.applyKeychronReceiverLighting({ ...lighting, ...patch });
  return <article className="setting-card keychron-receiver-lighting">
    <div className="setting-heading"><div><h2>{t(locale, "light.receiverTitle")}</h2></div></div>
    <small className="setting-note">{receiver.name}</small>
    <label><span>{t(locale, "light.effect")}</span>
      <select value={lighting.mode ?? ""} disabled={snapshot.settingInProgress}
        onChange={event => apply({ mode: event.currentTarget.value as MouseLightingMode })}>
        {lighting.modes.map(mode => <option key={mode} value={mode}>{displayText(locale, mode)}</option>)}
      </select>
    </label>
    {lighting.color && lighting.mode && lighting.colorModes.includes(lighting.mode) ?
      <div className="receiver-colour"><span>{t(locale, "light.colour")}</span><ColorPicker id="receiver-light-colour"
        value={lighting.color} ariaLabel={t(locale, "light.colour")} disabled={snapshot.settingInProgress}
        onChange={color => apply({ color })} /></div> : null}
    <label><span>{t(locale, "light.brightness")}</span>
      <select value={lighting.brightness ?? ""} disabled={snapshot.settingInProgress}
        onChange={event => apply({ brightness: Number(event.currentTarget.value) })}>
        {(lighting.brightnessLevels ?? []).map(level => <option key={level} value={level}>{level}%</option>)}
      </select>
    </label>
    <label><span>{t(locale, "light.speed")}</span>
      <select value={lighting.speed ?? ""} disabled={snapshot.settingInProgress}
        onChange={event => apply({ speed: Number(event.currentTarget.value) })}>
        {lighting.speeds.map(speed => <option key={speed} value={speed}>{speed}</option>)}
      </select>
    </label>
  </article>;
}
