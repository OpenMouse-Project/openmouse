import { useId, useState, type ReactNode, type FormEvent } from 'react';
import type { ControlSnapshot, KeyboardView } from '../../device/types';
import type { KeyboardCommand } from '../../device/keyboard-workspace';
import type { WuqueHigherKeyWrite, WuqueLightingLed, WuqueMacroEvent, WuqueRgb } from '@openmouse/keyboard-protocol/wuque';
import { WUQUE_KEYCODE_CATEGORIES, wuqueKeycodeLabel, wuqueMatrixKeyLabel } from '@openmouse/keyboard-protocol/wuque';
import * as control from '../../device/controller';
import { t, type I18nKey } from '../../i18n';
import type { InterfaceLocale } from '../../interface-preferences';
import { Segmented, StepperSlider, SwitchRow } from '../ui';
import { ColorPicker } from '../ColorPicker';

const send = (command: KeyboardCommand) => control.applyKeyboardCommand(command);
const hex = (c: WuqueRgb) => `#${[c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
const rgb = (value: string): WuqueRgb => ({ r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(5, 7), 16) });
const form = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); return new FormData(event.currentTarget); };
const number = (data: FormData, key: string) => Number(data.get(key));

function Card({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return <article className="setting-card keyboard-workspace-card"><div className="setting-heading"><div><h2>{title}</h2></div></div>{children}</article>;
}
function NumberField({ name, label, value, max = 65535, step = 1 }: { name: string; label: string; value: number; max?: number; step?: number }): ReactNode {
  return <label className="keyboard-field"><span>{label}</span><input name={name} type="number" min={0} max={max} step={step} defaultValue={value} required /></label>;
}
function KeycodeField({ name = 'keycode', label, value }: { name?: string; label: string; value: number }): ReactNode {
  return <label className="keyboard-field"><span>{label}</span><select name={name} defaultValue={value}>
    {!Object.values(WUQUE_KEYCODE_CATEGORIES).some(codes => codes.includes(value)) ? <option value={value}>{wuqueKeycodeLabel(value) ?? `0x${value.toString(16)}`}</option> : null}
    {Object.entries(WUQUE_KEYCODE_CATEGORIES).filter(([category]) => category !== 'triMode').map(([category, codes]) => <optgroup key={category} label={category}>{codes.map(code => <option key={code} value={code}>{wuqueKeycodeLabel(code) ?? `0x${code.toString(16)}`}</option>)}</optgroup>)}
  </select></label>;
}
function ColorField({ label, value, disabled, onChange }: { label: string; value: WuqueRgb; disabled?: boolean; onChange: (color: WuqueRgb) => void }): ReactNode {
  const id = useId();
  return <div className="keyboard-color-field"><span>{label}</span><ColorPicker id={id} disabled={disabled} ariaLabel={label} value={hex(value)} onChange={color => onChange(rgb(color))} /></div>;
}

export function KeyboardWorkspaceCards({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  if (!keyboard) return null;
  const locale = snapshot.preferences.locale;
  const l = (key: string) => t(locale, `kb.${key}` as I18nKey);
  const busy = keyboard.trigger.busy;
  const { workspace } = keyboard;
  const global = workspace.global;
  const tab = snapshot.workspaceTab;
  const selected = keyboard.trigger.selected;
  const key = selected ? keyboard.trigger.keys.find(k => k.row === selected.row && k.col === selected.col) : null;
  return <>
    {tab === 'overview' ? <Card title={l('system')}>
      <fieldset disabled={busy || !global} className="keyboard-fields">
        <Segmented id="keyboard-system" ariaLabel={l('system')} options={[{ value: 0, label: 'WIN' }, { value: 1, label: 'MAC' }]} value={global?.systemType ?? null} onChange={value => send({ kind: 'system', value })} />
        <form key={global?.sleepTime} onSubmit={event => send({ kind: 'sleep', value: number(form(event), 'sleep') })} className="keyboard-inline-form">
          <NumberField name="sleep" label={l('sleep')} value={global?.sleepTime ?? 0} /><button type="submit">{l('apply')}</button>
        </form>
        <SwitchRow label={l('shake')} value={global?.shakeOptimization} onChange={value => send({ kind: 'shake', value })} />
      </fieldset>
      <button type="button" disabled={busy} onClick={() => send({ kind: 'refresh' })}>{l('refresh')}</button>
    </Card> : null}
    {tab === 'buttons' ? <>
      <RemapCard key={`${keyboard.vendorId}:${keyboard.productId}`} keyboard={keyboard} locale={locale} />
      <Card title={l('advancedKeys')}>
        <p className="setting-note">{l('higherNote')}</p>
        <label className="keyboard-field"><span>{l('keycode')}</span><select disabled={busy} value={selected ? `${selected.row}:${selected.col}` : ''} onChange={event => { const [row, col] = event.currentTarget.value.split(':').map(Number); control.selectKeyboardKey(row, col); }}>
          <option value="" disabled>{l('selectKey')}</option>{keyboard.trigger.keys.map(k => <option key={`${k.row}:${k.col}`} value={`${k.row}:${k.col}`}>{k.keycodeName} · {k.row}:{k.col}</option>)}
        </select></label>
        <button type="button" disabled={busy || !selected} onClick={() => selected && send({ kind: 'higherRead', ...selected })}>{l('readKey')}</button>
        {selected && workspace.higher?.row === selected.row && workspace.higher.col === selected.col ? <HigherEditor key={JSON.stringify(workspace.higher)} keyboard={keyboard} locale={locale} /> : null}
      </Card>
    </> : null}
    {tab === 'lighting' ? <LightingCards key={JSON.stringify([workspace.lighting, workspace.custom, workspace.shell])} keyboard={keyboard} locale={locale} /> : null}
    {tab === 'macro' ? <MacroCard keyboard={keyboard} locale={locale} /> : null}
    {tab === 'profiles' ? <ProfileCard keyboard={keyboard} locale={locale} /> : null}
    {tab === 'advanced' ? <Card title={l('diagnostics')}>
      {key ? <><h3>{key.keycodeName}</h3><dl className="keyboard-identity">
        {([['release', `${key.performance.normalReleaseMm.toFixed(3)} mm`], ['firstTouch', `${key.rtFirstTouchMm.toFixed(3)} mm`], ['axisId', key.performance.axisV2Id], ['axisRange', key.performance.axisRangeMax], ['axisCoefficient', key.performance.axisCoefficient], ['calibration', key.performance.calibrate], ['precision', global?.rtPrecision ?? l('unavailable')]] as const).map(([label, value]) => <div key={label}><dt>{l(label)}</dt><dd>{value}</dd></div>)}
      </dl><button type="button" disabled={busy} onClick={() => send({ kind: 'adc', row: key.row })}>{l('adc')}</button>
      {workspace.adc?.row === key.row ? <p className="keyboard-sensor-readout"><strong>{l('readout')}</strong><output>{workspace.adc.data[key.col] ?? l('unavailable')}</output></p> : null}</> : <p>{l('selectKey')}</p>}
    </Card> : null}
  </>;
}

function RemapCard({ keyboard, locale }: { keyboard: KeyboardView; locale: InterfaceLocale }): ReactNode {
  const l = (key: string) => t(locale, `kb.${key}` as I18nKey);
  const [layer, setLayer] = useState(0);
  const [position, setPosition] = useState<{ row: number; col: number } | null>(null);
  const data = keyboard.workspace.layer;
  const busy = keyboard.trigger.busy;
  const ready = data?.layer === layer;
  const current = ready && position ? data.rows[position.row]?.[position.col] ?? 0 : null;
  return <Card title={l('remap')}>
    <Segmented id="keyboard-layer" ariaLabel={l('layer')} value={layer} options={[0, 1, 2, 3].map(value => ({ value, label: `${l('layer')} ${value + 1}` }))} disabled={busy} onChange={value => { setLayer(value); setPosition(null); send({ kind: 'layer', layer: value }); }} />
    <button type="button" disabled={busy} onClick={() => send({ kind: 'layer', layer })}>{l('refresh')}</button>
    {ready ? <><div className="keyboard-matrix" role="group" aria-label={l('remap')}>
      {keyboard.trigger.matrix.map((row, rowIndex) => keyboard.trigger.keys.some(k => k.row === rowIndex) ? <div className="keyboard-matrix-row" key={rowIndex}>{row.map((_code, col) => keyboard.trigger.keys.some(k => k.row === rowIndex && k.col === col) ? <button type="button" key={col} disabled={busy} className={`keyboard-key${position?.row === rowIndex && position.col === col ? ' is-selected' : ''}`} aria-pressed={position?.row === rowIndex && position.col === col} onClick={() => setPosition({ row: rowIndex, col })}>{wuqueMatrixKeyLabel(data.rows[rowIndex]?.[col] ?? 0) ?? `0x${(data.rows[rowIndex]?.[col] ?? 0).toString(16)}`}</button> : <span key={col} className="keyboard-key is-empty" />)}</div> : null)}
    </div>{position && current !== null ? <form key={`${layer}:${position.row}:${position.col}:${current}`} onSubmit={event => send({ kind: 'keycode', layer, ...position, keycode: number(form(event), 'keycode') })}>
      <fieldset disabled={busy} className="keyboard-fields"><KeycodeField label={l('keycode')} value={current} /><p className="setting-note">{l('default')}: {keyboard.workspace.defaults[position.row] ? wuqueKeycodeLabel(keyboard.workspace.defaults[position.row]!.keycodes[position.col]) ?? l('unavailable') : l('unavailable')}</p><button type="submit">{l('apply')}</button></fieldset>
    </form> : null}
    {keyboard.workspace.styles.some(Boolean) ? <details className="keyboard-layout-details"><summary>{l('geometry')}</summary><table><thead><tr><th>{l('row')}</th><th>{l('col')}</th><th>{l('ratio')}</th><th>{l('kind')}</th></tr></thead><tbody>{keyboard.workspace.styles.flatMap((style, index) => style?.entries.map((entry, n) => <tr key={`${index}:${n}`}><td>{entry.row}</td><td>{entry.col}</td><td>{entry.ratio}</td><td>{entry.type}</td></tr>) ?? [])}</tbody></table></details> : null}
    </> : <p className="setting-note">{l('readFirst')}</p>}
  </Card>;
}

function ProfileCard({ keyboard, locale }: { keyboard: KeyboardView; locale: InterfaceLocale }): ReactNode {
  const l = (key: string) => t(locale, `kb.${key}` as I18nKey);
  const [scope, setScope] = useState<'all' | 'performance' | 'lighting' | 'layout' | 'higherKey' | 'macro'>('all');
  const [confirm, setConfirm] = useState(false);
  return <Card title={l('slot')}>
    <Segmented id="keyboard-config-slot" ariaLabel={l('slot')} options={[0, 1, 2, 3].map(value => ({ value, label: `${value + 1}` }))} value={keyboard.workspace.global?.configSwitch ?? null} disabled={keyboard.trigger.busy || !keyboard.workspace.global} onChange={value => send({ kind: 'slot', value })} />
    <p className="setting-note">{l('saveNote')}</p><label className="keyboard-field"><span>{l('scope')}</span><select value={scope} onChange={e => { setScope(e.currentTarget.value as typeof scope); setConfirm(false); }} disabled={keyboard.trigger.busy}>{(['all', 'performance', 'lighting', 'layout', 'higherKey', 'macro'] as const).map(value => <option key={value} value={value}>{l(value)}</option>)}</select></label>
    {confirm ? <div className="keyboard-save-confirm" role="alert"><p>{l('saveConfirm')}</p><button type="button" disabled={keyboard.trigger.busy} onClick={() => { send({ kind: 'save', scope }); setConfirm(false); }}>{l('save')}</button><button type="button" onClick={() => setConfirm(false)}>{t(locale, 'common.cancel')}</button></div> : <button type="button" disabled={keyboard.trigger.busy} onClick={() => setConfirm(true)}>{l('save')}</button>}
  </Card>;
}

function LightingCards({ keyboard, locale }: { keyboard: KeyboardView; locale: InterfaceLocale }): ReactNode {
  const l = (key: string) => t(locale, `kb.${key}` as I18nKey);
  const { workspace } = keyboard;
  const base = workspace.lighting?.base;
  const [palette, setPalette] = useState(workspace.lighting?.palette?.map(c => ({ ...c })) ?? []);
  const [custom, setCustom] = useState<WuqueLightingLed[]>(workspace.custom.map(c => ({ ...c })));
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [led, setLed] = useState(0);
  const [correction] = useState(workspace.lighting?.colorCorrection ?? { r: 0, g: 0, b: 0 });
  const [shell, setShell] = useState(workspace.shell ?? { r: 0, g: 0, b: 0 });
  const [caps, setCaps] = useState<WuqueRgb>({ r: 0, g: 0, b: 0 });
  const busy = keyboard.trigger.busy;
  const current = custom[page * 15 + led];
  const editLed = (value: Partial<WuqueLightingLed>) => setCustom(custom.map((c, index) => index === page * 15 + led ? { ...c, ...value } : c));
  return <>
    <Card title={l('lighting')}>
      <button type="button" disabled={busy} onClick={() => send({ kind: 'refresh' })}>{l('refresh')}</button>
      {base ? <><SwitchRow label={l('lightingOn')} value={base.open} disabled={busy} onChange={open => send({ kind: 'lighting', base: { ...base, open } })} />
        <p className="setting-note">{l('rawModeNote')}</p><form onSubmit={event => { const d = form(event); send({ kind: 'lighting', base: { ...base, mode: number(d, 'mode'), direction: number(d, 'direction'), selectStaticColor: number(d, 'static') } }); }}>
          <fieldset disabled={busy} className="keyboard-fields keyboard-field-grid"><NumberField name="mode" label={l('vendorMode')} value={base.mode} max={255} /><NumberField name="direction" label={l('direction')} value={base.direction} max={255} /><NumberField name="static" label={l('staticColor')} value={base.selectStaticColor} max={7} /><button type="submit">{l('apply')}</button></fieldset>
        </form>
        <StepperSlider id="keyboard-brightness" label={l('brightness')} value={base.luminance} min={0} max={100} step={1} scale={['0', '', '100']} formatValue={v => `${v}%`} disabled={busy} onCommit={luminance => send({ kind: 'lighting', base: { ...base, luminance } })} />
        <StepperSlider id="keyboard-light-speed" label={l('speed')} value={base.speed} min={0} max={100} step={1} scale={['0', '', '100']} formatValue={v => `${v}`} disabled={busy} onCommit={speed => send({ kind: 'lighting', base: { ...base, speed } })} />
      </> : <p>{l('readFirst')}</p>}
      <SwitchRow label={l('blackout')} value={workspace.global?.blackout} disabled={busy} onChange={value => send({ kind: 'blackout', value })} />
    </Card>
    <Card title={l('palette')}><fieldset disabled={busy || palette.length !== 8} className="keyboard-fields">
      <Segmented id="keyboard-palette-index" ariaLabel={l('palette')} options={palette.map((_, index) => ({ value: index, label: `${index + 1}` }))} value={paletteIndex} disabled={busy} onChange={setPaletteIndex} />{palette[paletteIndex] ? <ColorField disabled={busy} label={`${l('palette')} ${paletteIndex + 1}`} value={palette[paletteIndex]} onChange={color => setPalette(palette.map((p, i) => i === paletteIndex ? { ...p, ...color } : p))} /> : null}<button type="button" onClick={() => send({ kind: 'palette', colors: palette })}>{l('apply')}</button>
    </fieldset></Card>
    <Card title={l('correction')}><form onSubmit={event => { const d = form(event); send({ kind: 'correction', color: { r: number(d, 'r'), g: number(d, 'g'), b: number(d, 'b') } }); }}><fieldset disabled={busy || !workspace.lighting?.colorCorrection} className="keyboard-fields keyboard-field-grid">{(['r', 'g', 'b'] as const).map(channel => <NumberField key={channel} name={channel} label={channel.toUpperCase()} value={correction[channel]} max={100} />)}<button type="submit">{l('apply')}</button></fieldset></form></Card>
    <Card title={l('custom')}><fieldset disabled={busy || custom.length !== 135} className="keyboard-fields">
      <div className="keyboard-field-grid"><label className="keyboard-field"><span>{l('page')}</span><select value={page} onChange={e => setPage(Number(e.currentTarget.value))}>{Array.from({ length: 9 }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label><label className="keyboard-field"><span>{l('led')}</span><select value={led} onChange={e => setLed(Number(e.currentTarget.value))}>{Array.from({ length: 15 }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label></div>
      {current ? <><ColorField disabled={busy} label={l('custom')} value={current} onChange={c => editLed({ ...c, isCustom: true })} /><SwitchRow label={l('customFlag')} value={current.isCustom ?? false} onChange={isCustom => editLed({ isCustom })} /></> : null}
      <div className="keyboard-selection-actions"><button type="button" onClick={() => send({ kind: 'custom', leds: custom })}>{l('apply')}</button><button type="button" onClick={() => send({ kind: 'direct', leds: custom })}>{l('preview')}</button></div>
    </fieldset></Card>
    <Card title={l('shell')}><fieldset disabled={busy || !workspace.shell} className="keyboard-fields"><ColorField disabled={busy} label={l('shell')} value={shell} onChange={setShell} /><button type="button" onClick={() => send({ kind: 'shell', color: shell })}>{l('apply')}</button></fieldset></Card>
    <Card title={l('caps')}><fieldset disabled={busy} className="keyboard-fields"><ColorField disabled={busy} label={l('caps')} value={caps} onChange={setCaps} /><button type="button" onClick={() => send({ kind: 'caps', color: caps })}>{l('apply')}</button></fieldset></Card>
  </>;
}

function MacroCard({ keyboard, locale }: { keyboard: KeyboardView; locale: InterfaceLocale }): ReactNode {
  const l = (key: string) => t(locale, `kb.${key}` as I18nKey);
  const [slot, setSlot] = useState(0);
  const macro = keyboard.workspace.macro;
  const count = keyboard.workspace.global?.macroSpace?.macroCount ?? 0;
  return <Card title={l('macro')}>
    <p className="setting-note">{l('capacity')}: {count} / {keyboard.workspace.global?.macroSpace?.macroNumber ?? '—'}</p>
    <label className="keyboard-field"><span>{l('macroSlot')}</span><select value={slot} disabled={keyboard.trigger.busy || count === 0} onChange={e => { const slot = Number(e.currentTarget.value); setSlot(slot); send({ kind: 'macroRead', slot }); }}>{Array.from({ length: count }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label>
    <button type="button" disabled={keyboard.trigger.busy || count === 0} onClick={() => send({ kind: 'macroRead', slot })}>{l('macroRead')}</button>
    {macro?.header.macroId === slot ? <MacroEditor key={JSON.stringify(macro)} keyboard={keyboard} locale={locale} /> : <p>{l('readFirst')}</p>}
  </Card>;
}
function MacroEditor({ keyboard, locale }: { keyboard: KeyboardView; locale: InterfaceLocale }): ReactNode {
  const l = (key: string) => t(locale, `kb.${key}` as I18nKey);
  const macro = keyboard.workspace.macro!;
  const [events, setEvents] = useState<WuqueMacroEvent[]>(macro.events.map(e => ({ ...e })));
  const [valid, setValid] = useState(macro.header.valid);
  const [macroMode, setMacroMode] = useState(macro.header.mode);
  const [repetitions, setRepetitions] = useState(macro.header.repNum);
  const capacity = keyboard.workspace.global?.macroSpace?.macroNumber ?? 0;
  return <form id="keyboard-macro-form" key={events.length} onSubmit={event => { const d = form(event); const values = events.map((_, i) => ({ status: number(d, `status${i}`), delay: number(d, `delay${i}`), keyCode: number(d, `key${i}`) })); send({ kind: 'macroWrite', slot: macro.header.macroId, events: values, mode: number(d, 'mode'), repetitions: number(d, 'repeat'), valid }); }}>
    <fieldset disabled={keyboard.trigger.busy} className="keyboard-fields">
      <SwitchRow label={l('valid')} value={valid} onChange={setValid} /><div className="keyboard-field-grid"><NumberField name="mode" label={l('vendorMode')} value={macroMode} max={255} /><NumberField name="repeat" label={l('repetitions')} value={repetitions} /></div>
      <p className="setting-note">{l('actions')}: {events.length}</p>
      <div className="keyboard-macro-events">{events.map((e, i) => <div key={i} className="keyboard-macro-event"><span>{i + 1}</span><label className="keyboard-field"><span>{l('status')}</span><select name={`status${i}`} defaultValue={e.status}><option value={0}>0</option><option value={1}>1</option></select></label><KeycodeField name={`key${i}`} label={l('keycode')} value={e.keyCode} /><NumberField name={`delay${i}`} label={l('delay')} value={e.delay} max={32767} /><button type="button" onClick={event => { const d = new FormData(event.currentTarget.form!); setMacroMode(number(d, 'mode')); setRepetitions(number(d, 'repeat')); setEvents(events.filter((_, n) => n !== i).map((_, n) => { const old = n >= i ? n + 1 : n; return { status: number(d, `status${old}`), keyCode: number(d, `key${old}`), delay: number(d, `delay${old}`) }; })); }}>{l('remove')}</button></div>)}</div>
      <button type="button" disabled={events.length >= capacity} onClick={event => { const d = new FormData(event.currentTarget.form!); setMacroMode(number(d, 'mode')); setRepetitions(number(d, 'repeat')); setEvents([...events.map((_, i) => ({ status: number(d, `status${i}`), delay: number(d, `delay${i}`), keyCode: number(d, `key${i}`) })), { status: 1, delay: 0, keyCode: 4 }]); }}>{l('addEvent')}</button><button type="submit">{l('apply')}</button>
    </fieldset>
  </form>;
}

function HigherEditor({ keyboard, locale }: { keyboard: KeyboardView; locale: InterfaceLocale }): ReactNode {
  const l = (key: string) => t(locale, `kb.${key}` as I18nKey);
  const higher = keyboard.workspace.higher!;
  const [mode, setMode] = useState<number>(higher.mode);
  const keycodes = 'keycodes' in higher ? higher.keycodes : 'keycode' in higher ? [higher.keycode] : [];
  const count = mode === 1 ? 4 : mode === 2 ? 3 : mode === 4 ? 1 : mode === 0 ? 0 : 2;
  const [pair, setPair] = useState('row2' in higher ? `${higher.row2}:${higher.col2}` : '');
  return <form key={mode} onSubmit={event => {
    const d = form(event); const target = { row: higher.row, col: higher.col }; const codes = Array.from({ length: count }, (_, i) => number(d, `key${i}`));
    const dead = (n: number) => Array.from({ length: n }, (_, i) => number(d, `dead${i}`));
    let write: WuqueHigherKeyWrite;
    switch (mode) {
      case 0: write = { ...target, mode: 0 }; break;
      case 1: write = { ...target, mode: 1, keycodes: codes, travelPoints: Array.from({ length: 4 }, (_, i) => number(d, `point${i}`)), deadBandsMm: dead(2) }; break;
      case 2: write = { ...target, mode: 2, keycodes: codes, deadBandsMm: dead(3) }; break;
      case 3: write = { ...target, mode: 3, keycodes: codes, time: number(d, 'time') }; break;
      case 4: write = { ...target, mode: 4, keycode: codes[0], time: number(d, 'time') }; break;
      case 5: write = { ...target, mode: 5, keycodes: codes, delay: number(d, 'time') }; break;
      case 6: { const [row2, col2] = pair.split(':').map(Number); write = { ...target, mode: 6, row2, col2, keycodes: codes, delay: number(d, 'time'), socdMode: number(d, 'socd') as 0 | 1 | 2 | 3 }; break; }
      default: { const [row2, col2] = pair.split(':').map(Number); write = { ...target, mode: 7, row2, col2, keycodes: codes, delay: number(d, 'time') }; }
    }
    send({ kind: 'higherWrite', write });
  }}><fieldset disabled={keyboard.trigger.busy} className="keyboard-fields">
    <label className="keyboard-field"><span>{l('mode')}</span><select value={mode} onChange={e => setMode(Number(e.currentTarget.value))}>{[l('none'), 'DKS', 'MPT', 'MT', 'TGL', 'END', 'SOCD', 'RS'].map((label, i) => <option key={i} value={i}>{label}</option>)}</select></label>
    <div className="keyboard-field-grid">{Array.from({ length: count }, (_, i) => <KeycodeField key={i} name={`key${i}`} label={`${l('keycode')} ${i + 1}`} value={keycodes[i] ?? 4} />)}
    {mode === 1 ? Array.from({ length: 4 }, (_, i) => <NumberField key={`point${i}`} name={`point${i}`} label={`${l('travelPoint')} ${i + 1}`} value={'travelPoints' in higher ? higher.travelPoints[i] : 0} max={255} />) : null}
    {mode === 1 || mode === 2 ? Array.from({ length: mode === 1 ? 2 : 3 }, (_, i) => <NumberField key={`dead${i}`} name={`dead${i}`} label={`${l('deadZone')} ${i + 1}`} value={'deadBandsMm' in higher ? higher.deadBandsMm[i] ?? 0 : 'deadBandsRaw' in higher ? higher.deadBandsRaw[i] / 1000 : 0} max={4} step={0.001} />) : null}
    {mode >= 3 ? <NumberField name="time" label={mode < 5 ? l('time') : l('delay')} value={'time' in higher ? higher.time : 'delay' in higher ? higher.delay : 0} /> : null}
    {mode >= 6 ? <label className="keyboard-field"><span>{l('partner')}</span><select value={pair} required onChange={e => setPair(e.currentTarget.value)}><option value="" disabled>{l('partner')}</option>{keyboard.trigger.keys.filter(k => k.row !== higher.row || k.col !== higher.col).map(k => <option key={`${k.row}:${k.col}`} value={`${k.row}:${k.col}`}>{k.keycodeName} · {k.row}:{k.col}</option>)}</select></label> : null}
    {mode === 6 ? <NumberField name="socd" label={`${l('socd')} (0–3)`} value={'socdMode' in higher ? higher.socdMode : 0} max={3} /> : null}</div>
    <button type="submit">{l('apply')}</button>
  </fieldset></form>;
}
