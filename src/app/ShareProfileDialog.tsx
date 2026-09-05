import { useEffect, useRef, type ReactNode } from "react";
import type { ControlSnapshot } from "../device/types";
import { ProfileKeyFields } from "./InterfaceSettings";

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
            <p className="overline">PROFILES</p>
            <h2 id="share-profile-dialog-title">Profile key</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <p className="share-profile-intro">
          A copy-paste key that carries this mouse's settings to another unit of the same model.
          Paste it into Settings there to load the same setup.
        </p>
        <ProfileKeyFields snapshot={snapshot} />
      </div>
    </dialog>
  );
}
