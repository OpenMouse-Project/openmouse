import type { ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import { t } from "../i18n";

export function PendingBar({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const { pending } = snapshot;
  if (pending.suppressed || pending.count === 0) return null;
  const locale = snapshot.preferences.locale;
  const busy = pending.busy;
  const label = pending.count === 1
    ? t(locale, "pend.one")
    : `${pending.count} ${t(locale, "pend.many")}`;
  return (
    <div
      id="pending-changes-bar"
      className={`apply-bar${busy ? " is-applying" : ""}`}
      role="region"
      aria-label={t(locale, "pend.region")}
    >
      <span className="apply-bar-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3 2.5 20h19L12 3Z" />
          <path d="M12 9.5v4M12 16.8v.2" />
        </svg>
        {label}
        {pending.labels.length > 0 ? <em className="apply-bar-summary">{pending.labels.join(" · ")}</em> : null}
      </span>
      <div className="apply-bar-actions">
        <button
          id="pending-revert"
          className="apply-bar-revert"
          type="button"
          disabled={busy}
          onClick={control.revertPendingChanges}
        >
          {t(locale, "pend.revert")}
        </button>
        <button
          id="pending-flash"
          className="apply-bar-apply"
          type="button"
          disabled={busy}
          onClick={() => void control.flashPendingChanges()}
        >
          {busy ? t(locale, "pend.applying") : t(locale, "pend.apply")}
        </button>
      </div>
    </div>
  );
}