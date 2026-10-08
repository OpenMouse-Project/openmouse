import { useEffect, useRef, useState, type ReactNode } from "react";
import { BUNNY_HOP_LIMITS, clampBunnyHopMs } from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import * as control from "../device/controller";
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";
import { BOUNCE_GAP_MS, bounceReport } from "../hits-test";

/**
 * Click a button as fast as you can for a few seconds. A switch that bounces
 * registers two presses a few milliseconds apart, which no finger can do; the
 * longest such gap tells how long Bunny Hop needs to be to filter them.
 */
export function BounceCheckDialog({
  open,
  locale,
  bunnyHopMs,
  canApply,
  onClose,
}: {
  open: boolean;
  locale: InterfaceLocale;
  /** The Bunny Hop time now on the profile, 0 when it is off. */
  bunnyHopMs: number;
  canApply: boolean;
  onClose: () => void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  // Press times in ms, per mouse button (0 left, 2 right).
  const [presses, setPresses] = useState<Record<number, number[]>>({});

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (!open) setPresses({});
  }, [open]);

  const reports = [
    { button: 0, label: "Left button" },
    { button: 2, label: "Right button" },
  ].map((entry) => ({ ...entry, report: bounceReport(presses[entry.button] ?? []) }));
  const longest = Math.max(0, ...reports.map((entry) => entry.report.longestGap ?? 0));
  const anyBounce = reports.some((entry) => entry.report.bounces > 0);
  // Room above the longest bounce seen, snapped to what the mouse accepts.
  const suggested = clampBunnyHopMs(Math.ceil(longest * 2));

  return (
    <dialog
      ref={dialog}
      className="support-dialog share-profile-dialog"
      aria-labelledby="bounce-check-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    >
      <div className="support-dialog-inner share-profile-dialog-inner">
        <header>
          <div>
            <p className="overline">Bunny hop</p>
            <h2 id="bounce-check-title">Bounce check</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, "common.close")}>×</button>
        </header>
        <div className="profile-key-fields">
          <small className="setting-description">
            Click a button as fast as you can in the field below for a few seconds. A switch that bounces registers a
            second press within {BOUNCE_GAP_MS} ms, which a finger cannot do, so those are counted and Bunny Hop is
            suggested to cover them.
          </small>
          {bunnyHopMs > 0 ? (
            <small className="setting-description" role="status">
              Bunny Hop is on at {bunnyHopMs} ms, so the mouse is already hiding bounces. Turn it off to see them.
            </small>
          ) : null}
          <button
            type="button"
            className="bounce-check-area"
            onMouseDown={(event) => {
              event.preventDefault();
              const time = event.timeStamp;
              setPresses((previous) => ({ ...previous, [event.button]: [...(previous[event.button] ?? []), time] }));
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            Click here as fast as you can
          </button>
          <ul className="bounce-check-results">
            {reports.map((entry) => (
              <li key={entry.button}>
                {entry.label}: {entry.report.clicks} clicks, {entry.report.bounces} bounced
                {entry.report.longestGap !== null ? `, longest gap ${Math.round(entry.report.longestGap)} ms` : ""}
              </li>
            ))}
          </ul>
          {reports.some((entry) => entry.report.clicks >= 10) ? (
            <small className="setting-description" role="status">
              {anyBounce
                ? `Bounce found. A Bunny Hop of ${suggested} ms (range ${BUNNY_HOP_LIMITS.minMs} to ${BUNNY_HOP_LIMITS.maxMs}) should filter it.`
                : "No bounce found in these clicks."}
            </small>
          ) : null}
          <div className="import-hits-actions">
            {anyBounce ? (
              <button
                type="button"
                className="connect-button"
                disabled={!canApply}
                onClick={() => { control.applyBunnyHopMs(suggested); onClose(); }}
              >
                Set Bunny Hop to {suggested} ms
              </button>
            ) : null}
            <button type="button" className="connect-button" onClick={() => setPresses({})}>Clear</button>
            <button type="button" className="connect-button" onClick={onClose}>{t(locale, "common.close")}</button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
