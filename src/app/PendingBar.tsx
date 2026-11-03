import { displayText } from "../i18n/index";
import { PenLine } from "lucide-react";
import { memo, type ReactNode } from "react";
import * as control from "../device/controller";
import { t } from "../i18n/index";
import { useControlSelector } from "./useControl";

export const PendingBar = memo(function PendingBar(): ReactNode {
  const count = useControlSelector((snapshot) => snapshot.pending.count);
  const suppressed = useControlSelector((snapshot) => snapshot.pending.suppressed);
  const busy = useControlSelector((snapshot) => snapshot.pending.busy);
  const labelsKey = useControlSelector((snapshot) => snapshot.pending.labels.join(" · "));
  const locale = useControlSelector((snapshot) => snapshot.preferences.locale);
  if (suppressed || count === 0) return null;
  const label = count === 1
    ? t(locale, "pend.one")
    : `${count} ${t(locale, "pend.many")}`;
  return (
    <div
      id="pending-changes-bar"
      className={`apply-bar${busy ? " is-applying" : ""}`}
      role="region"
      aria-label={t(locale, "pend.region")}
    >
      <span className="apply-bar-label">
        <PenLine strokeWidth={1.8} aria-hidden="true" />
        {displayText(locale, label)}
        {labelsKey.length > 0 ? <em className="apply-bar-summary">{displayText(locale, labelsKey)}</em> : null}
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
          {displayText(locale, busy ? t(locale, "pend.applying") : t(locale, "pend.apply"))}
        </button>
      </div>
    </div>
  );
});