import type { ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";

export function PendingBar({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const { pending } = snapshot;
  if (pending.suppressed) return null;
  const idle = pending.count === 0;
  return (
    <div
      id="pending-changes-bar"
      className={`pending-bar${pending.busy ? " is-flashing" : ""}`}
      role="region"
      aria-label="Unsaved changes"
    >
      <i className="lg-glass__refract" aria-hidden="true" />
      <i className="lg-glass__tint" aria-hidden="true" />
      <i className="lg-glass__specular" aria-hidden="true" />
      <div className="pending-bar-inner">
        <span className="pending-bar-progress" aria-hidden="true" />
        <span className="pending-bar-dot" aria-hidden="true" />
        <div className="pending-bar-copy">
          <p className="overline">PENDING</p>
          <strong id="pending-changes-count">
            {idle ? "No pending changes" : pending.count === 1 ? "1 unsaved change" : `${pending.count} unsaved changes`}
          </strong>
          <small id="pending-changes-summary" role="status" aria-live="polite">
            {pending.statusText
              ?? (idle ? "Adjust a setting to preview it before writing." : pending.labels.join(" · "))}
          </small>
        </div>
        <div className="pending-bar-actions">
          <button
            id="pending-revert"
            className="pending-revert"
            type="button"
            disabled={idle || pending.busy}
            onClick={control.revertPendingChanges}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3.5 8.5h11a5.5 5.5 0 0 1 0 11H8" />
              <path d="M7.5 4 3 8.5 7.5 13" />
            </svg>
            <span>Revert</span>
          </button>
          <button
            id="pending-flash"
            className="pending-flash"
            type="button"
            disabled={idle || pending.busy}
            onClick={() => void control.flashPendingChanges()}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M13.8 2 4 13.9h5.7L8.9 22 20 9.8h-6.1L13.8 2Z" />
            </svg>
            <i className="pending-spinner" aria-hidden="true" />
            <span id="pending-flash-label">{pending.busy ? "Applying…" : "Apply changes"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
