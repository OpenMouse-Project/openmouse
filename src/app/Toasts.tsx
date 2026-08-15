import type { ReactNode } from "react";
import * as control from "../device/controller";
import type { Toast } from "../device/types";

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

export function ToastHost({ toasts }: { toasts: Toast[] }): ReactNode {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <article
          key={toast.id}
          className={`toast toast-${toast.kind}${toast.leaving ? " is-leaving" : ""}`}
        >
          <ToastIcon kind={toast.kind} />
          <div className="toast-copy">
            <strong>{toast.title}</strong>
            {toast.detail ? <span>{toast.detail}</span> : null}
          </div>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss notification"
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
}
