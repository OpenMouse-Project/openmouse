import { useEffect, useRef, type ReactNode } from "react";
import * as control from "../device/controller";
import type { Toast } from "../device/types";
import type { InterfaceLocale } from "../interface-preferences";
import { t } from "../i18n";

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
  } catch {
    return null;
  }
  return audioContext;
}

/* A chime that fired before the first user gesture (Chrome suspends the
   context until then) waits here and plays on the earliest interaction. */
let pendingChime: Toast["kind"] | null = null;

function unlockAudio(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
  if (pendingChime !== null) {
    const kind = pendingChime;
    pendingChime = null;
    void playToastSound(kind);
  }
}

/* Browsers suspend audio until the first user gesture. Resume on every
   pointer/key interaction (not once) so any pending chime always fires. */
if (typeof window !== "undefined") {
  const gestureOptions: AddEventListenerOptions = { passive: true, capture: true };
  window.addEventListener("pointerdown", unlockAudio, gestureOptions);
  window.addEventListener("keydown", unlockAudio, gestureOptions);
  window.addEventListener("pointerup", unlockAudio, gestureOptions);
  window.addEventListener("click", unlockAudio, gestureOptions);
}

async function playToastSound(kind: Toast["kind"]): Promise<void> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }
    if (ctx.state !== "running") {
      pendingChime = kind;
      return;
    }

    const base =
      kind === "success" ? 659.25 : kind === "info" ? 523.25 : kind === "warning" ? 392 : 311.13;
    const frequencies = kind === "error" ? [base] : [base, base * 1.25];
    for (const freq of frequencies) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain).connect(ctx.destination);
      const start = Math.max(ctx.currentTime + 0.02, ctx.currentTime);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
      osc.start(start);
      osc.stop(start + 0.45);
      await new Promise((resolve) => window.setTimeout(resolve, 160));
    }
  } catch (error) {
    console.warn("Toast chime could not play", error);
  }
}

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

export function ToastHost({ toasts, locale }: { toasts: Toast[]; locale: InterfaceLocale }): ReactNode {
  const sounded = useRef<Set<number>>(new Set());
  /* The controller pushes toasts by mutating the SAME array in place, so the
     prop reference never changes and a [toasts] dependency would only fire at
     mount. Guard with a Set of already-played ids instead. */
  useEffect(() => {
    for (const toast of toasts) {
      if (sounded.current.has(toast.id)) continue;
      sounded.current.add(toast.id);
      void playToastSound(toast.kind);
    }
  });
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite" aria-label={t(locale, "toast.region")}>
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
}
