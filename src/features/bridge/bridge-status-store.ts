import { bridgeStatus, type BridgeStatus } from "./bridge";
import { subscribeBridgeHidActive } from "./bridge-hid";

const POLL_MS = 5_000;

type Listener = (status: BridgeStatus | null) => void;

let current: BridgeStatus | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribeActive: (() => void) | null = null;
const listeners = new Set<Listener>();
// Bumped whenever polling stops, so a status request already in flight cannot
// repopulate `current` after the last subscriber went away.
let generation = 0;
let consecutiveFailures = 0;
let visibilityHandler: (() => void) | null = null;

function notify(): void {
  for (const listener of listeners) listener(current);
}

function poll(): void {
  const mine = generation;
  void bridgeStatus().then((next) => {
    if (mine !== generation) return;
    consecutiveFailures = 0;
    current = next;
    notify();
  }).catch(() => {
    if (mine !== generation) return;
    consecutiveFailures += 1;
    // Bridge briefly not answering — bridge-hid.ts's own disconnect
    // handling is what actually stops polling; this just skips a beat.
    // After 3 consecutive failures treat Bridge as gone so the UI stops
    // showing a stale version.
    if (consecutiveFailures >= 3) {
      consecutiveFailures = 0;
      current = null;
      notify();
    }
  });
}

function tick(): void {
  if (typeof document !== "undefined" && document.hidden) return;
  poll();
}

function startPolling(): void {
  if (timer !== null) return;
  consecutiveFailures = 0;
  if (typeof document !== "undefined" && visibilityHandler === null) {
    visibilityHandler = () => {
      // stopPolling clears the timer; without this gate a late visible
      // event repopulates current after cleanup.
      if (!document.hidden && timer !== null) tick();
    };
    document.addEventListener("visibilitychange", visibilityHandler);
  }
  tick();
  timer = setInterval(tick, POLL_MS);
}

function stopPolling(): void {
  generation += 1;
  consecutiveFailures = 0;
  if (timer !== null) clearInterval(timer);
  timer = null;
  current = null;
  notify();
}

export function subscribeBridgeStatus(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  if (listeners.size === 1) {
    unsubscribeActive = subscribeBridgeHidActive((active) => {
      if (active) startPolling();
      else stopPolling();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      unsubscribeActive?.();
      unsubscribeActive = null;
      stopPolling();
    }
  };
}

export function currentBridgeStatus(): BridgeStatus | null {
  return current;
}
