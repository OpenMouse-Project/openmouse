import { trustedScriptUrl } from "./trusted-types.ts";

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(trustedScriptUrl("/sw.js")).then((registration) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void registration.update().catch(() => {});
      });
    }).catch(() => {
    });
  });
}
