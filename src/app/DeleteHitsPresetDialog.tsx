import { displayText } from "../i18n";
import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";

/** Asks before a saved HITS preset is deleted. */
export function DeleteHitsPresetDialog({
  name,
  locale,
  onClose,
  onConfirm,
}: {
  /** The preset to delete; null keeps the dialog closed. */
  name: string | null;
  locale: InterfaceLocale;
  onClose: () => void;
  onConfirm: () => void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const open = name !== null;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="support-dialog share-profile-dialog"
      aria-labelledby="delete-hits-dialog-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    >
      <div className="support-dialog-inner share-profile-dialog-inner">
        <header>
          <div>
            <p className="overline">{displayText(locale, "HITS Tuning")}</p>
            <h2 id="delete-hits-dialog-title">{displayText(locale, "Delete preset")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, "common.close")}>×</button>
        </header>
        <div className="profile-key-fields">
          <p className="share-profile-intro"> {displayText(locale, "Delete “")}{name}{displayText(locale, "”? It is removed from this browser and cannot be brought back, unless you copied its code.")} </p>
          <div className="import-hits-actions">
            <button type="button" className="connect-button delete-hits-confirm" onClick={onConfirm}> {displayText(locale, "Delete")} </button>
            <button type="button" className="connect-button" onClick={onClose} autoFocus>
              {t(locale, "common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
