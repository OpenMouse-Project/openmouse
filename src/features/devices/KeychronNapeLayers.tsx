import { displayText } from "../../i18n/index";
import { useEffect, useRef, type ReactNode } from "react";
import {
  KEYCHRON_NAPE_BUTTON_ACTIONS,
  KEYCHRON_NAPE_ORIENTATION_OPTIONS,
  keychronLayerLabel,
  type KeychronNapeButtonAction,
} from "@openmouse/protocol/keychron";
import * as control from "../../device/controller";
import type { ControlSnapshot, NapeAssignmentControl, StagedNapeAssignment } from "../../device/types";
import { layerLabel, t, tp } from "../../i18n/index";
import type { InterfaceLocale } from "../settings/interface-preferences";
import { IconActivate, IconRefresh, IconRunning } from "../../shared/icons";

const KEY_ROWS = [
  { col: 2, number: "1", name: "01" },
  { col: 3, number: "2", name: "02" },
  { col: 0, number: "3", name: "03" },
  { col: 1, number: "4", name: "04" },
  { col: 4, number: "5", name: "M1" },
  { col: 5, number: "6", name: "M2" },
] as const;

function pendingKey(layer: number, target: NapeAssignmentControl): string {
  if (target.kind === "orientation") return `nape-${layer}-orientation`;
  return target.kind === "key"
    ? `nape-${layer}-col-${target.col}`
    : `nape-${layer}-wheel-${target.clockwise ? "cw" : "ccw"}`;
}

function stagedFor(
  staged: readonly StagedNapeAssignment[],
  layer: number,
  target: NapeAssignmentControl,
): StagedNapeAssignment | undefined {
  return staged.find((entry) => {
    if (entry.layer !== layer) return false;
    if (entry.control.kind === "orientation" && target.kind === "orientation") return true;
    if (entry.control.kind === "key" && target.kind === "key") return entry.control.col === target.col;
    if (entry.control.kind === "wheel" && target.kind === "wheel") {
      return entry.control.clockwise === target.clockwise;
    }
    return false;
  });
}

function AssignmentSelect({
  layer,
  target,
  action,
  keycode,
  staged,
  disabled,
  locale,
}: {
  layer: number;
  target: NapeAssignmentControl;
  action: string;
  keycode: number;
  staged: StagedNapeAssignment | undefined;
  disabled: boolean;
  locale: InterfaceLocale;
}): ReactNode {
  const value = staged?.action ?? action;
  return (
    <span className="assignment-select-wrap">
      <select
        value={value}
        disabled={disabled}
        title={displayText(locale, action === "Custom" ? `Unknown mapping: 0x${keycode.toString(16).padStart(4, "0")}` : undefined)}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (next === "Custom") return;
          control.applyNapeAssignment(layer, target, next as KeychronNapeButtonAction);
        }}
      >
        {value === "Custom" ? <option value="Custom">{t(locale, "prof.customPreserved")}</option> : null}
        {KEYCHRON_NAPE_BUTTON_ACTIONS.map((option) => (
          <option key={option} value={option}>{displayText(locale, option)}</option>
        ))}
      </select>
      <i aria-hidden="true" />
    </span>
  );
}

function NapeAssignments({ snapshot, layer }: { snapshot: ControlSnapshot; layer: number }): ReactNode {
  const locale = snapshot.preferences.locale;
  const map = snapshot.napeKeymap;
  const busy = snapshot.settingInProgress;
  const ready = map != null && map.layer === layer;
  const orientationTarget: NapeAssignmentControl = { kind: "orientation" };
  const stagedOrientation = ready && map
    ? stagedFor(snapshot.stagedNapeAssignments, layer, orientationTarget)
    : undefined;
  return (
    <div className="profile-button-editor">
      <div className="profile-button-heading">
        <div>
          <h2>{t(locale, "prof.assign")}</h2>
          <small>{t(locale, "key.assignBody")}</small>
        </div>
      </div>
      {ready && map ? (
        <div className="assignment-grid">
          <label
            className={`assignment-card is-wide${stagedOrientation ? " is-staged" : ""}`}
            data-pending-key={pendingKey(layer, orientationTarget)}
          >
            <span className="assignment-button-number">0</span>
            <span className="assignment-button-name">{displayText(locale, "Orientation")}</span>
            <span className="assignment-select-wrap">
              <select
                value={stagedOrientation?.keycode ?? map.orientationIndex}
                disabled={busy}
                onChange={(event) => {
                  control.applyNapeOrientation(layer, Number(event.currentTarget.value));
                }}
              >
                {KEYCHRON_NAPE_ORIENTATION_OPTIONS.map((option) => (
                  <option key={option.index} value={option.index}>{displayText(locale, option.label)}</option>
                ))}
              </select>
              <i aria-hidden="true" />
            </span>
          </label>
          {KEY_ROWS.map((row) => {
            const key = map.keys.find((entry) => entry.col === row.col);
            if (!key) return null;
            const target: NapeAssignmentControl = { kind: "key", col: row.col };
            const staged = stagedFor(snapshot.stagedNapeAssignments, layer, target);
            return (
              <label
                key={row.col}
                className={`assignment-card${staged ? " is-staged" : ""}`}
                data-pending-key={pendingKey(layer, target)}
              >
                <span className="assignment-button-number">{displayText(locale, row.number)}</span>
                <span className="assignment-button-name">{displayText(locale, row.name)}</span>
                <AssignmentSelect
                  layer={layer}
                  target={target}
                  action={key.action}
                  keycode={key.keycode}
                  staged={staged}
                  disabled={busy}
                  locale={locale}
                />
              </label>
            );
          })}
          {([
            { clockwise: false, number: "7", name: "Scroll wheel Counter Clockwise", current: map.wheel.ccw },
            { clockwise: true, number: "8", name: "Scroll wheel Clockwise", current: map.wheel.cw },
          ] as const).map((row) => {
            const target: NapeAssignmentControl = { kind: "wheel", clockwise: row.clockwise };
            const staged = stagedFor(snapshot.stagedNapeAssignments, layer, target);
            return (
              <label
                key={row.name}
                className={`assignment-card${staged ? " is-staged" : ""}`}
                data-pending-key={pendingKey(layer, target)}
              >
                <span className="assignment-button-number">{displayText(locale, row.number)}</span>
                <span className="assignment-button-name">{displayText(locale, row.name)}</span>
                <AssignmentSelect
                  layer={layer}
                  target={target}
                  action={row.current.action}
                  keycode={row.current.keycode}
                  staged={staged}
                  disabled={busy}
                  locale={locale}
                />
              </label>
            );
          })}
        </div>
      ) : (
        <small className="setting-note">{tp(locale, "key.reading", { label: layerLabel(locale, keychronLayerLabel(layer)) })}</small>
      )}
      <small className="setting-note">
        {t(locale, "key.layerNote")}
      </small>
    </div>
  );
}

export function KeychronNapeLayers({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const count = status?.napeLayerCount;
  const inner = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bodyEl = body.current;
    const innerEl = inner.current;
    if (!bodyEl || !innerEl) return;
    const sync = (): void => {
      bodyEl.style.maxHeight = snapshot.profilesExpanded ? `${innerEl.scrollHeight}px` : "0px";
    };
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(innerEl);
    return () => observer.disconnect();
  }, [snapshot.profilesExpanded]);

  if (status == null || count == null || count < 1) return null;
  const locale = snapshot.preferences.locale;

  const activeLayer = status.napeLayer ?? 1;
  const editedLayer = snapshot.editedNapeLayer ?? activeLayer;
  const busy = snapshot.settingInProgress;
  const tags = [
    editedLayer === activeLayer ? t(locale, "key.active") : null,
    t(locale, "key.editing"),
  ].filter(Boolean).join(" · ");

  return (
    <section
      id="nape-layers"
      className={`profile-disclosure device-data${snapshot.profilesExpanded ? " is-open" : ""}`}
      role="tabpanel"
      aria-labelledby="workspace-tab-profiles"
    >
      <div className="profile-summary">
        <button
          id="nape-layer-disclosure-toggle"
          className="profile-summary-main"
          type="button"
          aria-expanded={snapshot.profilesExpanded}
          aria-controls="nape-layer-disclosure-body"
          onClick={control.toggleProfilesExpanded}
        >
          <span className="profile-summary-text">
            <span className="profile-summary-label">{t(locale, "prof.editingTag")}</span>
            <strong>{displayText(locale, layerLabel(locale, keychronLayerLabel(editedLayer)))}{displayText(locale, tags ? ` · ${tags}` : "")}</strong>
            <small>{t(locale, "key.layersStored")}</small>
          </span>
          <i className="profile-summary-chevron" aria-hidden="true" />
        </button>
        <button
          id="nape-layer-refresh"
          className="icon-button"
          type="button"
          aria-label={t(locale, "key.reload")}
          title={t(locale, "key.reload")}
          disabled={busy}
          onClick={() => void control.reloadNapeLayers()}
        >
          <IconRefresh />
        </button>
      </div>

      <div id="nape-layer-disclosure-body" className="profile-disclosure-body" ref={body}>
        <div className="profile-disclosure-inner" ref={inner}>
          <div id="nape-layer-list">
            <small className="profile-list-hint">
              {t(locale, "key.inspectHint")}
            </small>
            {Array.from({ length: count }, (_, index) => {
              const layer = index + 1;
              const opened = editedLayer === layer;
              const running = activeLayer === layer;
              const rowTags = [running ? t(locale, "key.active") : null, opened ? t(locale, "key.editing") : null]
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={layer} className={`profile-row${opened ? " is-open" : ""}`}>
                  <button
                    type="button"
                    title={t(locale, "key.openLayer")}
                    className="profile-row-open"
                    onClick={() => control.openNapeLayer(layer)}
                  >
                    <span className="profile-slot">{layer}</span>
                    <span className="profile-row-text">
                      <strong>
                        {displayText(locale, layerLabel(locale, keychronLayerLabel(layer)))}{rowTags ? <span className={`om-badge${running ? " is-accent" : ""}`}>{displayText(locale, rowTags)}</span> : null}
                      </strong>
                      <small>
                        {displayText(locale, running ? t(locale, "key.currentLayer") : t(locale, "key.storedLayer"))}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busy || running}
                    title={displayText(locale, running ? t(locale, "key.alreadyLayer") : tp(locale, "key.switchLayer", { label: layerLabel(locale, keychronLayerLabel(layer)) }))}
                    aria-label={tp(locale, "key.switchTo", { label: layerLabel(locale, keychronLayerLabel(layer)) })}
                    aria-pressed={running}
                    className={`icon-button${running ? " is-active" : ""}`}
                    onClick={() => void control.switchNapeLayer(layer)}
                  >
                    {running ? <IconRunning /> : <IconActivate />}
                  </button>
                </div>
              );
            })}
          </div>
          <small id="onboard-status">{displayText(locale, snapshot.onboardStatus)}</small>
          <NapeAssignments snapshot={snapshot} layer={editedLayer} />
        </div>
      </div>
    </section>
  );
}
