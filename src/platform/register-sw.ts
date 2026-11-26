export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void registration.update().catch(() => {});
      });
    }).catch(() => {
    });
  });
}
