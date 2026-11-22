import { useEffect, useState } from "react";
import type { KeychronDynamicDpi } from "@openmouse/protocol/drivers/mouse-types";
import type { ControlSnapshot } from "../../../device/types";
import * as control from "../../../device/controller";
import { t } from "../../../i18n/index";
import { SwitchRow } from "../../../shared/ui";

const PRESETS = [
  [{ speed: 0, gain: 16 }, { speed: 40, gain: 24 }, { speed: 80, gain: 32 }, { speed: 140, gain: 44 }, { speed: 200, gain: 56 }],
  [{ speed: 0, gain: 16 }, { speed: 20, gain: 48 }, { speed: 80, gain: 48 }, { speed: 120, gain: 48 }, { speed: 200, gain: 48 }],
  [{ speed: 0, gain: 16 }, { speed: 14, gain: 16 }, { speed: 30, gain: 48 }, { speed: 95, gain: 48 }, { speed: 200, gain: 48 }],
];

export function KeychronDynamicDpiCard({ snapshot }: { snapshot: ControlSnapshot }) {
  const config = snapshot.status?.keychronMouse?.dynamicDpi;
  const [draft, setDraft] = useState<KeychronDynamicDpi | null>(config ? structuredClone(config) : null);
  const [custom, setCustom] = useState(config?.mode === 0 ? config.points : []);
  const signature = JSON.stringify(config);
  useEffect(() => {
    setDraft(config ? structuredClone(config) : null);
    if (config?.mode === 0) setCustom(structuredClone(config.points));
  }, [signature]);
  if (!draft || !config) return null;
  const locale = snapshot.preferences.locale;
  const valid = draft.points.length > 0 && draft.points.every((p, i) =>
    Number.isInteger(p.speed) && p.speed >= 0 && p.speed <= 200 && Number.isInteger(p.gain) && p.gain >= 0 && p.gain <= 56
    && (i === 0 || p.speed > draft.points[i - 1]!.speed));
  return <article className="setting-card keychron-dynamic-card">
    <div className="setting-heading"><div><h2>{t(locale, "perf.dynSens")}</h2></div></div>
    <SwitchRow label={t(locale, "perf.dynSens")} value={draft.enabled} disabled={snapshot.settingsPending}
      onChange={enabled => setDraft({ ...draft, enabled })} />
    <div className="segmented" role="group" aria-label={t(locale, "perf.dynSensCurve")}>
      {(["perf.custom", "perf.classic", "perf.natural", "perf.jump"] as const).map((key, mode) =>
        <button type="button" key={key} aria-pressed={draft.mode === mode} disabled={snapshot.settingsPending}
          onClick={() => {
            if (draft.mode === mode) return;
            if (draft.mode === 0) setCustom(structuredClone(draft.points));
            setDraft({ ...draft, mode, points: structuredClone(mode === 0 ? custom.length ? custom : draft.points : PRESETS[mode - 1]!) });
          }}>{t(locale, key)}</button>)}
    </div>
    <div className="keychron-dynamic-layout">
    <div className="magnetic-travel">
      <svg viewBox="0 0 600 180" role="img" aria-label={t(locale, "perf.dynSensCurve")}>
        {[0, 16, 32, 48, 56].map(gain => <g key={gain}>
          <line className="magnetic-travel-gridline" x1="32" x2="598" y1={160 - gain / 56 * 150} y2={160 - gain / 56 * 150} />
          <text x="0" y={164 - gain / 56 * 150}>{gain / 16}</text>
        </g>)}
        <polyline className="magnetic-travel-line" points={draft.points.map(p => `${32 + p.speed / 200 * 566},${160 - p.gain / 56 * 150}`).join(" ")} />
      </svg>
    </div>
    <table className="keychron-curve-table">
      <thead><tr><th>{t(locale, "perf.dynSensSpeed")} {"(IPS)"}</th><th>{t(locale, "perf.dynSensGain")}</th></tr></thead>
      <tbody>{draft.points.map((point, index) => <tr key={index}>
        {(["speed", "gain"] as const).map(field => <td key={field}><input type="number"
          aria-label={`${t(locale, field === "speed" ? "perf.dynSensSpeed" : "perf.dynSensGain")} ${index + 1}`}
          min={0} max={field === "speed" ? 200 : 3.5} step={field === "speed" ? 1 : 0.0625}
          value={field === "gain" ? point.gain / 16 : point.speed}
          disabled={draft.mode !== 0 || snapshot.settingsPending}
          onChange={event => setDraft({ ...draft, points: draft.points.map((p, i) => i === index
            ? { ...p, [field]: Number(event.currentTarget.value) * (field === "gain" ? 16 : 1) } : p) })} /></td>)}
      </tr>)}</tbody>
    </table>
    </div>
    <button type="button" className="om-btn" disabled={!valid || snapshot.settingsPending}
      onClick={() => control.applyKeychronDynamicDpi(draft)}>{t(locale, "common.apply")}</button>
  </article>;
}

export function KeychronPairingCard({ snapshot }: { snapshot: ControlSnapshot }) {
  const extra = snapshot.status?.keychronMouse;
  if (!extra?.pairing) return null;
  const locale = snapshot.preferences.locale;
  const labels = ["adv.leftButton", "magnetic.middleButton", "adv.rightButton", "conn.forward", "magnetic.backButton"] as const;
  const count = extra.pairing?.mask.toString(2).replaceAll("0", "").length ?? 0;
  return <article className="setting-card">
      <div className="setting-heading"><div><h2>{t(locale, "magnetic.pairing")}</h2></div></div>
      <p className="setting-note">{t(locale, "magnetic.pairingHint")}</p>
      {labels.map((key, i) => {
        const selected = !!(extra.pairing!.mask & (1 << i));
        return <SwitchRow key={key} label={t(locale, key)} value={selected}
          disabled={snapshot.settingsPending || (selected ? count === 1 : count === 3)}
          onChange={() => control.applyKeychronPairing({ ...extra.pairing!, mask: extra.pairing!.mask ^ (1 << i) })} />;
      })}
  </article>;
}

export function KeychronResetCard({ snapshot }: { snapshot: ControlSnapshot }) {
  if (!snapshot.status?.keychronMouse?.factoryReset) return null;
  const locale = snapshot.preferences.locale;
  return <article className="setting-card">
      <div className="setting-heading"><div><h2>{t(locale, "magnetic.factoryReset")}</h2></div></div>
      <p className="setting-note">{t(locale, "magnetic.factoryHint")}</p>
      <button type="button" className="om-btn is-danger" disabled={snapshot.settingsPending}
        onClick={control.stageKeychronReset}>{t(locale, "magnetic.factoryReset")}</button>
  </article>;
}
