import { useSyncExternalStore } from "react";

export const MIN_WIDTH = 900;
export const MIN_HEIGHT = 600;

const QUERY = `(max-width: ${MIN_WIDTH - 1}px), (max-height: ${MIN_HEIGHT - 1}px)`;

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

export function useViewportTooSmall(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
