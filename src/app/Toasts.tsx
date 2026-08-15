import type { ReactNode } from "react";
import * as control from "../device/controller";
import type { Toast } from "../device/types";

const TOAST_GLYPH: Record<Toast["kind"], string> = {
  success: "✓",
  error: "✕",
  info: "i",
};

export function ToastHost({ toasts }: { toasts: Toast[] }): ReactNode {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <article key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className="toast-glyph" aria-hidden="true">{TOAST_GLYPH[toast.kind]}</span>
          <div className="toast-copy">
            <strong>{toast.title}</strong>
            {toast.detail ? <p>{toast.detail}</p> : null}
          </div>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => control.dismissToast(toast.id)}
          >
            ✕
          </button>
        </article>
      ))}
    </div>
  );
}
