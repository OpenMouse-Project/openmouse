import { useMemo, useState, type ReactNode } from "react";
import type { KeychronWorkspace } from "../../../device/keychron-keyboard";
import { legendFor } from "../../../device/keychron-legend";
import { pickerCatalog, pickerGroups } from "../../../device/keychron-picker";
import { remapKeyId } from "../../../device/keychron-remap";
import * as control from "../../../device/controller";
import { displayText, t, tp, type I18nKey } from "../../../i18n/index";
import type { InterfaceLocale } from "../../settings/interface-preferences";
import { Segmented } from "../../../shared/ui";
import { KeychronKeyMap } from "./KeychronKeyMap";

const send = control.applyKeyboardCommand;
type Vars = Record<string, string | number>;
const l = (locale: InterfaceLocale, key: string, vars?: Vars): string =>
  vars ? tp(locale, `kb.keychron${key}` as I18nKey, vars) : t(locale, `kb.keychron${key}` as I18nKey);

const hex = (code: number): string => `0x${code.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * Key remapping on the Buttons tab: a keyboard-shaped map of one layer, a
 * layer switcher and a picker over the keycodes this firmware can be set to.
 * Every write goes through the driver's setKeycode, which reads the key back,
 * and "set" is only said once that resolved.
 */
export function KeychronRemapCard({ kc, locale, busy, hidden, name }: { kc: KeychronWorkspace; locale: InterfaceLocale; busy: boolean; hidden: boolean; name: string }): ReactNode {
  const { remap } = kc;
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [category, setCategory] = useState("letters");
  const [query, setQuery] = useState("");
  const catalog = useMemo(() => (remap.unavailable ? [] : pickerCatalog(remap.context, remap.layerCount)), [remap.context, remap.layerCount, remap.unavailable]);
  const groups = pickerGroups(catalog, category, query);
  const code = selected ? remap.keymap?.[selected.row]?.[selected.col] : undefined;
  const legend = code === undefined ? null : legendFor(code, remap.context);
  const original = selected ? remap.originals[remapKeyId(remap.layer, selected.row, selected.col)] : undefined;
  const result = remap.result;
  const place = (row: number, col: number): string => tp(locale, "kb.keychronKeyLabel", { row, col });
  const resultLegend = result ? legendFor(result.code, remap.context).label || hex(result.code) : "";

  return <article className="setting-card keyboard-workspace-card" hidden={hidden}>
    <div className="setting-heading"><div><h2>{l(locale, "Remap")}</h2></div></div>
    <p className="setting-note">{l(locale, "RemapPersist")}</p>
    <p className="setting-note">{l(locale, "RemapScope")}</p>
    {remap.unavailable ? <>
      <p className="setting-note setting-note-warning" role="status">{l(locale, "RemapUnavailable", { name })}</p>
      <small className="setting-note">{remap.unavailable}</small>
    </> : <>
      {remap.layerCount > 1 ? <Segmented id="keychron-layer" ariaLabel={l(locale, "Layer")} disabled={busy}
        options={Array.from({ length: remap.layerCount }, (_, layer) => ({ value: layer, label: l(locale, "LayerN", { n: layer }) }))}
        value={remap.layer} onChange={layer => { setSelected(null); void send({ kind: "keychronSelectLayer", layer }); }} /> : null}
      <KeychronKeyMap kc={kc} locale={locale} keymap={remap.keymap} context={remap.context} showTravel={false}
        selected={new Set(selected ? [`${selected.row}:${selected.col}`] : [])} disabled={busy}
        onSelect={(row, col) => setSelected({ row, col })} />
      <p className="setting-note">{l(locale, "RemapLegends", { layer: remap.layer })}</p>

      {selected && code !== undefined && legend ? <dl className="keyboard-identity">
        <div><dt>{place(selected.row, selected.col)}</dt><dd>{legend.unknown ? hex(code) : `${legend.title} (${hex(code)})`}</dd></div>
        {legend.unknown ? <div><dt>{l(locale, "RemapUnknown")}</dt><dd>{l(locale, "RemapUnknownBody")}</dd></div> : null}
      </dl> : <p className="setting-note">{l(locale, "RemapPick")}</p>}

      {remap.warning ? <div role="group" aria-label={l(locale, "RemapWarningTitle")} className="keychron-confirm">
        <p className="setting-note setting-note-warning">{l(locale, "RemapWarningTitle")}</p>
        <ul>{remap.warning.warnings.map(text => <li key={text} className="setting-note">{text}</li>)}</ul>
        <div className="keychron-actions">
          <button type="button" className="om-btn is-danger" disabled={busy}
            onClick={() => send({ kind: "keychronRemap", layer: remap.warning!.layer, row: remap.warning!.row, col: remap.warning!.col, code: remap.warning!.code, confirmed: true })}>
            {l(locale, "RemapReplaceAnyway")}
          </button>
          <button type="button" className="om-btn" disabled={busy} onClick={() => send({ kind: "keychronDismissRemap" })}>{l(locale, "Cancel")}</button>
        </div>
      </div> : null}

      {result ? <p className={`setting-note${result.kind === "failed" ? " setting-note-warning" : ""}`} role="status">
        {result.kind === "ok"
          ? l(locale, "RemapDone", { key: place(result.row, result.col), legend: resultLegend, layer: result.layer })
          : l(locale, "RemapFailed", { key: place(result.row, result.col), legend: resultLegend, message: result.message ?? "" })}
      </p> : null}

      {selected && original !== undefined && original !== code ? <div className="keychron-actions">
        <button type="button" className="om-btn" disabled={busy}
          onClick={() => send({ kind: "keychronRemap", layer: remap.layer, row: selected.row, col: selected.col, code: original, restore: true })}>
          {l(locale, "RemapRestore", { legend: legendFor(original, remap.context).label || hex(original) })}
        </button>
      </div> : null}

      <div className="keychron-picker-head">
        <input type="search" value={query} placeholder={l(locale, "PickerSearch")} aria-label={l(locale, "PickerSearch")} onChange={event => setQuery(event.currentTarget.value)} />
      </div>
      {query.trim() === "" ? <div className="keychron-chips" role="group" aria-label={l(locale, "PickerCategories")}>
        {catalog.map(entry => <button key={entry.id} type="button" className="om-btn is-sm" aria-pressed={category === entry.id}
          onClick={() => setCategory(entry.id)}>{displayText(locale, entry.label)}</button>)}
      </div> : null}
      {groups.length === 0 ? <p className="setting-note">{l(locale, "PickerNone")}</p> : groups.map(group => <section key={group.id} aria-label={displayText(locale, group.label)}>
        {query.trim() !== "" ? <small className="setting-note">{displayText(locale, group.label)}</small> : null}
        <div className="keychron-picker">
          {group.entries.map(entry => <button key={entry.code} type="button" className="keychron-pick" disabled={busy || !selected} title={entry.title}
            aria-pressed={entry.code === code}
            onClick={() => selected && send({ kind: "keychronRemap", layer: remap.layer, row: selected.row, col: selected.col, code: entry.code })}>
            <span>{entry.label}</span><small>{entry.title}</small>
          </button>)}
        </div>
      </section>)}
    </>}
  </article>;
}
