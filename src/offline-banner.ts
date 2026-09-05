import "./offline-banner.css";

const MESSAGE = "You're offline. Anything that needs the network will not update.";

/**
 * Announces a dropped connection. The banner stays empty while online so the
 * live region only speaks on an actual change.
 */
export function mountOfflineBanner(): void {
  const banner = document.createElement("div");
  banner.className = "offline-banner";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");

  const sync = (): void => {
    const offline = !navigator.onLine;
    banner.classList.toggle("is-visible", offline);
    banner.textContent = offline ? MESSAGE : "";
  };

  sync();
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  document.body.append(banner);
}
