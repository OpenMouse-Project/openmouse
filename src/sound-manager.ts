import type { ToastKind } from "./device/types";

let context: AudioContext | null = null;
let clickBuffer: AudioBuffer | null = null;
let clickPreparePromise: Promise<void> | null = null;
let clickAudioRequest: Promise<ArrayBuffer> | null = null;
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

function fetchClickAudio(): Promise<ArrayBuffer> {
  if (!clickAudioRequest) {
    clickAudioRequest = fetch(new URL("/sounds/click.wav", window.location.href).toString())
      .then((response) => {
        if (!response.ok) throw new Error(`click sound fetch failed: ${response.status}`);
        return response.arrayBuffer();
      });
  }
  return clickAudioRequest;
}

function prepareClick(): Promise<void> {
  if (!clickPreparePromise) {
    clickPreparePromise = (async () => {
      const ctx = getContext();
      if (!ctx) return;
      clickBuffer = await ctx.decodeAudioData(await fetchClickAudio());
    })().catch((error) => {
      console.warn("OpenMouse click sound unavailable:", error);
      clickPreparePromise = null;
    });
  }
  return clickPreparePromise;
}

async function playClick(): Promise<void> {
  if (!enabled) return;
  const ctx = context;
  const audio = clickBuffer;
  if (!ctx || !audio) return;
  if (ctx.state === "suspended") await ctx.resume();

  const now = ctx.currentTime;
  const length = audio.duration;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(1.35, now + 0.003);
  gain.gain.setValueAtTime(1.35, now + Math.max(0.04, length - 0.06));
  gain.gain.setTargetAtTime(0.0001, now + length - 0.06, 0.028);
  gain.connect(ctx.destination);

  const source = ctx.createBufferSource();
  source.buffer = audio;
  source.connect(gain);
  source.start(now, 0, length);
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
  void prepareClick().then(playClick);
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

  void fetchClickAudio();
  void prepareClick();
  if (!gestureListenerInstalled) {
    window.addEventListener("pointerdown", unlock, { passive: true, capture: true });
    gestureListenerInstalled = true;
  }
}

export function playToastSound(kind: ToastKind): void {
  void playToast(kind);
}