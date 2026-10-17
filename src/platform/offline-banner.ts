import "./offline-banner.css";

import type { InterfaceLocale } from "../features/settings/interface-preferences";
import { detectLocale, loadInterfacePreferences } from "../features/settings/interface-preferences";
import { ensureDisplayLocale, t } from "../i18n/index";

/**
 * Announces a dropped connection. The banner stays empty while online so the
 * live region only speaks on an actual change.
 */
export function mountOfflineBanner(locale?: InterfaceLocale): void {
  const resolved = (): InterfaceLocale => locale ?? (() => {
    try {
      return loadInterfacePreferences(window.localStorage).locale;
    } catch {
      return detectLocale();
    }
  })();
  const banner = document.createElement("div");
  banner.className = "offline-banner";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");

  const sync = (): void => {
    const offline = !navigator.onLine;
    banner.classList.toggle("is-visible", offline);
    banner.textContent = offline ? t(resolved(), "off.banner") : "";
  };

  void ensureDisplayLocale(resolved()).then(sync);
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  window.addEventListener("openmouse-localechange", sync);
  window.addEventListener("storage", () => { void ensureDisplayLocale(resolved()).then(sync); });
  document.body.append(banner);
}
