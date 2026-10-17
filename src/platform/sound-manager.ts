import type { ToastKind } from "../device/types";

let context: AudioContext | null = null;
let pendingToast: ToastKind | null = null;
let enabled = false;
let gestureListenerInstalled = false;

function audioCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    ?? null;
}

function getContext(): AudioContext | null {
  if (context) return context;
  const Ctor = audioCtor();
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

async function playToast(kind: ToastKind): Promise<void> {
  try {
    if (!enabled) return;
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    if (ctx.state !== "running") {
      pendingToast = kind;
      return;
    }

    const base = kind === "success" ? 659.25 : kind === "info" ? 523.25 : kind === "warning" ? 392 : 311.13;
    const frequencies = kind === "error" ? [base] : [base, base * 1.25];
    for (const frequency of frequencies) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain).connect(ctx.destination);
      const start = Math.max(ctx.currentTime + 0.02, ctx.currentTime);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
      oscillator.start(start);
      oscillator.stop(start + 0.45);
      await new Promise((resolve) => window.setTimeout(resolve, 160));
    }
  } catch (error) {
    console.warn("Toast chime could not play", error);
  }
}

function unlock(): void {
  const ctx = getContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
  if (pendingToast !== null) {
    const kind = pendingToast;
    pendingToast = null;
    void playToast(kind);
  }
}

export function setSoundsEnabled(nextEnabled: boolean): void {
  enabled = nextEnabled;
  if (!enabled) {
    pendingToast = null;
    if (gestureListenerInstalled) {
      window.removeEventListener("pointerdown", unlock, true);
      gestureListenerInstalled = false;
    }
    return;
  }

  if (!gestureListenerInstalled) {
    window.addEventListener("pointerdown", unlock, { passive: true, capture: true });
    gestureListenerInstalled = true;
  }
}

export function playToastSound(kind: ToastKind): void {
  void playToast(kind);
}