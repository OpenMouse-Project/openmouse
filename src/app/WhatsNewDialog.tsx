import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";

const DESKTOP_RELEASES_URL = "https://github.com/OpenMouse-Project/Desktop/releases";

export function WhatsNewDialog({ open, onClose, locale = "en" }: {
  open: boolean;
  onClose: () => void;
  locale?: InterfaceLocale;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    } else if (typeof element.close === "function") {
      if (element.open) element.close();
    } else {
      element.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="support-dialog whatsnew-dialog"
      aria-labelledby="whatsnew-dialog-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    >
      <div className="support-dialog-inner whatsnew-dialog-inner">
        <header>
          <div>
            <h2 id="whatsnew-dialog-title">{t(locale, "wn.title")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, "common.close")}>×</button>
        </header>
        <p className="whatsnew-body">{t(locale, "wn.body")}</p>
        <a
          className="whatsnew-download"
          href={DESKTOP_RELEASES_URL}
          target="_blank"
          rel="noreferrer"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M7 10l5 5 5-5M12 15V3" />
          </svg>
          {t(locale, "wn.download")}
        </a>
        <div className="support-actions">
          <button type="button" onClick={onClose}>{t(locale, "wn.close")}</button>
        </div>
      </div>
    </dialog>
  );
}