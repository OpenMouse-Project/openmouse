import { displayText } from "../i18n/index";
import { memo, useEffect, useRef, type ReactNode } from "react";
import * as control from "../device/controller";
import type { Toast } from "../device/types";
import { t } from "../i18n/index";
import { playToastSound } from "../platform/sound-manager";
import { useControlSelector } from "./useControl";
import { useUiLocale } from "../shared/ui-locale";

const TOAST_ICON: Record<Toast["kind"], ReactNode> = {
  success: <path d="M20 6 9 17l-5-5" />,
  error: <path d="M18 6 6 18M6 6l12 12" />,
  warning: (
    <>
      <path d="M12 3 2 20h20L12 3z" />
      <path d="M12 10v4" />
      <path d="M12 17.2v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.8v.1" />
    </>
  ),
};

function ToastIcon({ kind }: { kind: Toast["kind"] }): ReactNode {
  return (
    <svg
      className="toast-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TOAST_ICON[kind]}
    </svg>
  );
}

const ToastList = memo(function ToastList({ toasts }: { toasts: Toast[] }): ReactNode {
  const locale = useUiLocale();
  const prev = useRef<Toast[]>([]);
  useEffect(() => {
    const seen = prev.current.map((toast) => toast.id);
    for (const toast of toasts) {
      if (!seen.includes(toast.id)) void playToastSound(toast.kind);
    }
    prev.current = toasts;
  }, [toasts]);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite" aria-label={t(locale, "toast.region")}>
      {toasts.map((toast) => (
        <article
          key={toast.id}
          className={`toast toast-${toast.kind}${toast.prominent ? " toast-prominent" : ""}${toast.leaving ? " is-leaving" : ""}`}
        >
          <ToastIcon kind={toast.kind} />
          <div className="toast-copy">
            <strong>{displayText(locale, toast.title)}</strong>
            {toast.detail ? <span>{displayText(locale, toast.detail)}</span> : null}
            {toast.action ? (
              <a className="toast-action" href={toast.action.href} target="_blank" rel="noreferrer">
                {displayText(locale, toast.action.label)}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
            ) : null}
          </div>
          <button
            type="button"
            className="toast-dismiss"
            aria-label={t(locale, "toast.dismiss")}
            onClick={() => control.dismissToast(toast.id)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </article>
      ))}
    </div>
  );
});

export function ToastHost(): ReactNode {
  const toasts = useControlSelector((snapshot) => snapshot.toasts);
  // Toast titles resolve through the lazy locale table at render.
  useControlSelector((snapshot) => snapshot.localeTableRevision);
  return <ToastList toasts={toasts} />;
}
