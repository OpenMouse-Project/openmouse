/**
 * Registers the generated service worker so the public pages stay available
 * without a connection. The worker only exists in a production build.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is an enhancement; the pages work without it.
    });
  });
}
