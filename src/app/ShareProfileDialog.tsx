import { useEffect, useRef, type ReactNode } from "react";
import type { ControlSnapshot } from "../device/types";
import { ProfileKeyFields } from "./InterfaceSettings";
import { t } from "../i18n";

export function ShareProfileDialog({
  open,
  onClose,
  snapshot,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: ControlSnapshot;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const locale = snapshot.preferences.locale;

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
      aria-labelledby="share-profile-dialog-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    >
      <div className="support-dialog-inner share-profile-dialog-inner">
        <header>
          <div>
            <p className="overline">{t(locale, "set.profiles")}</p>
            <h2 id="share-profile-dialog-title">{t(locale, "set.profileKey")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, "common.close")}>×</button>
        </header>
        <p className="share-profile-intro">
          {t(locale, "set.profileKeyBody")}
        </p>
        <ProfileKeyFields snapshot={snapshot} />
      </div>
    </dialog>
  );
}
