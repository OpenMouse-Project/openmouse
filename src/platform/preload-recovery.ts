const RELOAD_KEY = "openmouse.preload-reloaded";

/**
 * A tab opened before a deploy keeps running the old shell, and the lazy
 * chunks it imports are pruned by the next deploy. Vite reports that failed
 * import as `vite:preloadError`; reloading picks up the current shell and its
 * chunks. Every failing chunk is remembered for the session, so one that the
 * current build is missing as well surfaces as an error instead of a loop.
 */
export function installPreloadRecovery(target: EventTarget = window): void {
  target.addEventListener("vite:preloadError", (event) => {
    const failure = String((event as Event & { payload?: unknown }).payload);
    try {
      const recovered: unknown = JSON.parse(sessionStorage.getItem(RELOAD_KEY) ?? "[]");
      const seen = Array.isArray(recovered) ? recovered : [];
      if (seen.includes(failure)) return;
      sessionStorage.setItem(RELOAD_KEY, JSON.stringify([...seen, failure]));
    } catch {
      return;
    }
    event.preventDefault();
    location.reload();
  });
}
