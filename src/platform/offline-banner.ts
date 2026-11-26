import "./offline-banner.css";

import type { InterfaceLocale } from "../features/settings/interface-preferences";
import { detectLocale, loadInterfacePreferences } from "../features/settings/interface-preferences";
import { ensureDisplayLocale, t } from "../i18n/index";

/**
 * Announces a dropped connection. The banner stays empty while online so the
 * live region only speaks on an actual change.
 */
let cachedLocale: InterfaceLocale | null = null;

function readStoredLocale(): InterfaceLocale {
  try {
    return loadInterfacePreferences(window.localStorage).locale;
  } catch {
    return detectLocale();
  }
}

export function mountOfflineBanner(locale?: InterfaceLocale): void {
  cachedLocale = locale ?? readStoredLocale();
  const banner = document.createElement("div");
  banner.className = "offline-banner";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");

  const sync = (): void => {
    const offline = !navigator.onLine;
    banner.classList.toggle("is-visible", offline);
    banner.textContent = offline ? t(cachedLocale ?? detectLocale(), "off.banner") : "";
  };

  const refresh = (): void => {
    cachedLocale = locale ?? readStoredLocale();
    void ensureDisplayLocale(cachedLocale).then(sync);
  };

  void ensureDisplayLocale(cachedLocale).then(sync);
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  window.addEventListener("openmouse-localechange", refresh);
  window.addEventListener("storage", refresh);
  document.body.append(banner);
}
