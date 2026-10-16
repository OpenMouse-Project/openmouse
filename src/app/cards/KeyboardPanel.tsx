import { displayText } from "../../i18n";
import { KochiKeyboardPanel } from "./KochiKeyboardPanel";
import { KeyboardWorkspaceCards } from "./KeyboardWorkspaceCards";
import type { ReactNode } from "react";
import * as control from "../../device/controller";
import type { ControlSnapshot, KeyboardTriggerKey } from "../../device/types";
import { t, tp } from "../../i18n";
import { RateSlider, StepperSlider } from "../ui";

const TRAVEL = { min: 0.1, max: 4, step: 0.1, scale: ["0.1", "", "4.0"] as const };
const RAPID_TRIGGER = { min: 0.1, max: 2, step: 0.1, scale: ["0.1", "", "2.0"] as const };
const DEAD_ZONE = { min: 0, max: 3.9, step: 0.1, scale: ["0", "", "3.9"] as const };

/** Millimetre readout shared by every trigger slider. */
function millimetres(value: number): string {
  return `${value.toFixed(3)} mm`;
}

/**
 * Keyboard cards inside the shared device workspace tabs. Confirmed values
 * come from the controller; commands without replies report only that they
 * were sent. Layout, lighting, macros and settings live in sibling cards.
 */
export function KeyboardPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  if (!keyboard) return null;
  if (keyboard.family === "kochi") return <KochiKeyboardPanel snapshot={snapshot} />;
  const locale = snapshot.preferences.locale;
  const { identity, polling, trigger } = keyboard;
  const busy = trigger.busy;
  const reportedPrecision = keyboard.workspace.global?.rtPrecision;
  const precision = reportedPrecision && reportedPrecision >= 0.001 ? reportedPrecision : 0.1;
  const selected = trigger.selected;
  const selectedKey: KeyboardTriggerKey | null = selected
    ? trigger.keys.find((key) => key.row === selected.row && key.col === selected.col) ?? null
    : null;
  const selectedSet = new Set(trigger.selectedKeys.map((ref) => `${ref.row}:${ref.col}`));
  const visibleColumns = Math.max(1, ...trigger.keys.filter(key => key.keycodeName !== null).map(key => key.col + 1));
  const disabled = busy || selectedKey === null;
  const notReported = t(locale, "kb.notReported");

  return (
    <section className="keyboard-panel" data-workspace-host role="tabpanel" aria-labelledby={`workspace-tab-${snapshot.workspaceTab}`}>
      {trigger.statusText ? <output className="keyboard-status" role="status">{displayText(locale, trigger.statusText)}</output> : null}
      <article id="keyboard-card" className="setting-card keyboard-identity-card" hidden={snapshot.workspaceTab !== "overview"}>
        <div className="setting-heading">
          <div>
            <div className="title-row">
              <h2>{keyboard.name}</h2>
              <p>{t(locale, "kb.keyboardLabel")}</p>
            </div>
            <small className="setting-note">{t(locale, "kb.triggerNote")}</small>
          </div>
          
        </div>
        <dl className="keyboard-identity">
          <div>
            <dt>{t(locale, "kb.identityFirmware")}</dt>
            <dd>{displayText(locale, identity.firmwareVersion ?? notReported)}</dd>
          </div>
          <div>
            <dt>{t(locale, "kb.identityApp")}</dt>
            <dd>{displayText(locale, identity.appVersion ?? notReported)}</dd>
          </div>
          <div>
            <dt>{t(locale, "kb.identityPcb")}</dt>
            <dd>{displayText(locale, identity.pcbVersion ?? notReported)}</dd>
          </div>
          <div>
            <dt>{t(locale, "kb.identitySerial")}</dt>
            <dd>{identity.serial ?? notReported}</dd>
          </div>
          <div><dt>{t(locale, "kb.boardId")}</dt><dd>{displayText(locale, identity.boardId ?? notReported)}</dd></div>
        </dl>
        <p className="setting-note">{displayText(locale, [identity.capabilities?.axisType.magnetic ? t(locale, "kb.magnetic") : null, identity.capabilities?.connectionMode.usb ? t(locale, "kb.usb") : null, identity.capabilities?.basicFunctions.rgbLighting ? t(locale, "kb.rgb") : null].filter(Boolean).join(" · "))}</p>
      </article>

      <article id="keyboard-polling-card" className="setting-card" hidden={snapshot.workspaceTab !== "performance"}>
        <div className="setting-heading">
          <div>
            <div className="title-row">
              <h2>{t(locale, "kb.pollingRate")}</h2>
            </div>
            <small className="setting-note">{t(locale, "kb.pollingNote")}</small>
          </div>
        </div>
        <RateSlider
          id="keyboard-polling"
          locale={locale}
          options={polling.supportedHz}
          valueHz={polling.currentHz}
          label={t(locale, "kb.pollingRate")}
          disabled={busy}
          onChange={(hz) => void control.applyKeyboardPolling(hz)}
        />
      </article>

      <article id="keyboard-trigger-card" className="setting-card" hidden={snapshot.workspaceTab !== "performance"}>
        <div className="setting-heading">
          <div>
            <div className="title-row">
              <h2>{t(locale, "kb.triggerTitle")}</h2>
            </div>
            <small className="setting-note">
              {t(locale, "kb.selectionHint")}
            </small>
          </div>
        </div>

        <div className="keyboard-key-deck">
        <div className="keyboard-matrix" role="group" aria-label={t(locale, "kb.triggerTitle")}>
          {trigger.matrix.map((row, rowIndex) => {
            const visible = row.some((_keycode, colIndex) =>
              trigger.keys.some((key) => key.row === rowIndex && key.col === colIndex && key.keycodeName !== null));
            // Rows with no vendor-named key (e.g. the row-0 phantom slot) are
            // structural padding, not UI — skip them instead of a blank band.
            if (!visible) return null;
            const spans = new Map<number, { start: number; end: number }>();
            for (const entry of trigger.keys.filter(key => key.row === rowIndex && key.keycodeName !== null)) {
              let start = entry.col;
              let end = entry.col;
              const empty = (col: number) => !trigger.keys.some(key => key.row === rowIndex && key.col === col && key.keycodeName !== null);
              // The matrix reserves empty slots around wide keys. Keep their
              // original HID coordinates while letting the keycap occupy them.
              if (entry.keycodeName === "Space") {
                while (start > 0 && empty(start - 1)) start--;
                while (end + 1 < visibleColumns && empty(end + 1)) end++;
              } else if (entry.keycodeName === "L-Shift") {
                while (end + 1 < visibleColumns && empty(end + 1)) end++;
              }
              spans.set(entry.col, { start, end });
            }
            return (
              <div className="keyboard-matrix-row" style={{ gridTemplateColumns: `repeat(${visibleColumns}, minmax(0, 1fr))` }} key={rowIndex}>
                {row.slice(0, visibleColumns).map((_keycode, colIndex) => {
                  const entry = trigger.keys.find((key) => key.row === rowIndex && key.col === colIndex);
                  const label = entry?.keycodeName ?? null;
                  const present = label !== null;
                  const isSelected = selectedSet.has(`${rowIndex}:${colIndex}`);
                  // Empty slots and codes the vendor names nowhere (e.g. the
                  // row-0 phantom 0xF20A) stay out of the grid entirely — never
                  // a clickable blank square.
                if (!present) return Array.from(spans.values()).some(span => colIndex >= span.start && colIndex <= span.end) ? null : <span key={colIndex} style={{ gridColumn: colIndex + 1 }} className="keyboard-key is-empty" aria-hidden="true" />;
                const span = spans.get(colIndex)!;
                return (
                  <button
                    type="button"
                    disabled={busy}
                    key={colIndex}
                    className={`keyboard-key${isSelected ? " is-selected" : ""}${label.length > 4 ? " is-long" : ""}`}
                    style={{ gridColumn: `${span.start + 1} / ${span.end + 2}` }}
                    aria-pressed={isSelected}
                    aria-label={displayText(locale, label)}
                    title={displayText(locale, `${label} · ${tp(locale, "kb.keyPosition", { row: rowIndex + 1, col: colIndex + 1 })}`)}
                    onClick={() => control.toggleKeyboardKey(rowIndex, colIndex)}
                  >
                    {displayText(locale, label)}
                  </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="keyboard-selection-actions">
          <span className="keyboard-selection-count">{tp(locale, "kb.selectedCount", { n: trigger.selectedKeys.length })}</span>
          <button
            type="button"
            onClick={() => control.selectAllKeyboardKeys()}
            disabled={busy || trigger.keys.length === 0}
          >
            {t(locale, "kb.selectAll")}
          </button>
          <button
            type="button"
            onClick={() => control.clearKeyboardSelection()}
            disabled={busy || trigger.selectedKeys.length === 0}
          >
            {t(locale, "kb.clearSelection")}
          </button>
        </div>

        </div>

        {selectedKey ? (
          <div className="keyboard-trigger-editor">
          <div className="keyboard-editor-heading"><div><h3>{t(locale, "kb.tuningTitle")}</h3><p>{tp(locale, "kb.valuesFor", { key: selectedKey.keycodeName ?? "" })}</p></div><div className="keyboard-selected-chips">{trigger.selectedKeys.slice(0, 5).map(ref => <span key={`${ref.row}:${ref.col}`}>{displayText(locale, trigger.keys.find(k => k.row === ref.row && k.col === ref.col)?.keycodeName)}</span>)}{trigger.selectedKeys.length > 5 ? <span>+{trigger.selectedKeys.length - 5}</span> : null}</div></div>
          <div className="keyboard-trigger-controls">
            <section className="keyboard-tuning-group"><h4>{t(locale, "kb.actuationGroup")}</h4><p>{t(locale, "kb.actuationHint")}</p>
            <StepperSlider
              id="keyboard-travel"
              label={t(locale, "kb.travel")}
              value={selectedKey.travelMm}
              min={TRAVEL.min}
              max={TRAVEL.max}
              step={precision}
              scale={TRAVEL.scale}
              formatValue={millimetres}
              disabled={disabled}
              onCommit={(value) => control.applyKeyboardTrigger({ travelMm: value })}
            />
            </section>
            <section className="keyboard-tuning-group"><h4>{t(locale, "kb.rapidGroup")}</h4><p>{t(locale, "kb.rapidHint")}</p>
            <StepperSlider
              id="keyboard-rt-press"
              label={t(locale, "kb.rapidTriggerPress")}
              value={selectedKey.rapidTriggerPressMm}
              min={RAPID_TRIGGER.min}
              max={RAPID_TRIGGER.max}
              step={precision}
              scale={RAPID_TRIGGER.scale}
              formatValue={millimetres}
              disabled={disabled}
              onCommit={(value) => control.applyKeyboardTrigger({ rapidTriggerPressMm: value })}
            />
            <StepperSlider
              id="keyboard-rt-release"
              label={t(locale, "kb.rapidTriggerRelease")}
              value={selectedKey.rapidTriggerReleaseMm}
              min={RAPID_TRIGGER.min}
              max={RAPID_TRIGGER.max}
              step={precision}
              scale={RAPID_TRIGGER.scale}
              formatValue={millimetres}
              disabled={disabled}
              onCommit={(value) => control.applyKeyboardTrigger({ rapidTriggerReleaseMm: value })}
            />
            </section>
            <section className="keyboard-tuning-group"><h4>{t(locale, "kb.deadGroup")}</h4><p>{t(locale, "kb.deadHint")}</p>
            <StepperSlider
              id="keyboard-dead-press"
              label={t(locale, "kb.deadBandPress")}
              value={selectedKey.deadBandPressMm}
              min={DEAD_ZONE.min}
              max={DEAD_ZONE.max}
              step={precision}
              scale={DEAD_ZONE.scale}
              formatValue={millimetres}
              disabled={disabled}
              onCommit={(value) => control.applyKeyboardTrigger({ deadBandPressMm: value })}
            />
            <StepperSlider
              id="keyboard-dead-release"
              label={t(locale, "kb.deadBandRelease")}
              value={selectedKey.deadBandReleaseMm}
              min={DEAD_ZONE.min}
              max={DEAD_ZONE.max}
              step={precision}
              scale={DEAD_ZONE.scale}
              formatValue={millimetres}
              disabled={disabled}
              onCommit={(value) => control.applyKeyboardTrigger({ deadBandReleaseMm: value })}
            />
            </section>
          </div>
          </div>
        ) : (
          <p className="keyboard-empty">
            {displayText(locale, trigger.keys.length === 0 ? t(locale, "kb.noKeys") : t(locale, "kb.selectPrompt"))}
          </p>
        )}
      </article>
      <KeyboardWorkspaceCards snapshot={snapshot} />
    </section>
  );
}
