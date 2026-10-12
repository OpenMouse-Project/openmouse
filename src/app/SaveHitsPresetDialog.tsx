import { useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";
import type { HitsButtonValues, HitsPreset } from "../hits-presets";

function describe(values: HitsButtonValues): string {
  const rapid = values.rapidTriggerEnabled ? `rapid trigger ${values.rapidTrigger}` : "rapid trigger off";
  return `actuation ${values.actuation}, ${rapid}, haptics ${values.haptics}`;
}

/** Name the current HITS tuning and save it as a preset. */
export function SaveHitsPresetDialog({
  open,
  locale,
  values,
  existingNames,
  onClose,
  onSave,
}: {
  open: boolean;
  locale: InterfaceLocale;
  values: Pick<HitsPreset, "left" | "right">;
  existingNames: readonly string[];
  onClose: () => void;
  onSave: (name: string) => void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (!open) setName("");
  }, [open]);

  const trimmed = name.trim().slice(0, 40);
  const replaces = trimmed !== "" && existingNames.includes(trimmed);

  return (
    <dialog
      ref={dialog}
      className="support-dialog share-profile-dialog"
      aria-labelledby="save-hits-dialog-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    >
      <form
        className="support-dialog-inner share-profile-dialog-inner"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSave(trimmed);
        }}
      >
        <header>
          <div>
            <p className="overline">HITS Tuning</p>
            <h2 id="save-hits-dialog-title">Save preset</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, "common.close")}>×</button>
        </header>
        <div className="profile-key-fields">
          <label className="profile-key-field">
            <span>Preset name</span>
            <input
              type="text"
              value={name}
              maxLength={40}
              placeholder="Name"
              onChange={(event) => setName(event.currentTarget.value)}
              autoFocus
            />
          </label>
          <small className="setting-description">
            Left: {describe(values.left)}. Right: {describe(values.right)}.
          </small>
          {replaces ? <small className="setting-description" role="status">A preset with this name exists and will be replaced.</small> : null}
          <div className="import-hits-actions">
            <button type="submit" className="connect-button" disabled={!trimmed}>Save</button>
            <button type="button" className="connect-button" onClick={onClose}>{t(locale, "common.cancel")}</button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
