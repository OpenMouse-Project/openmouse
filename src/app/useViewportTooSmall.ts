import { useSyncExternalStore } from "react";

export const MIN_WIDTH = 900;
export const MIN_HEIGHT = 600;

const QUERY = `(max-width: ${MIN_WIDTH - 1}px), (max-height: ${MIN_HEIGHT - 1}px)`;

let sharedQuery: MediaQueryList | null = null;

/** One shared MediaQueryList: every mount otherwise allocates (and retains
 * listeners on) its own identical query object. */
function mediaQuery(): MediaQueryList {
  if (sharedQuery === null) sharedQuery = window.matchMedia(QUERY);
  return sharedQuery;
}

function subscribe(onChange: () => void): () => void {
  const query = mediaQuery();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return mediaQuery().matches;
}

export function useViewportTooSmall(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
