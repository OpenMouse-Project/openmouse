import { useState, type ChangeEvent, type ReactNode } from "react";
import * as control from "../../../device/controller";
import type { ControlSnapshot } from "../../../device/types";
import { createViaBackup, createViaLayoutFile, parseViaBackup, viaBackupFileName, viaBackupFromLayoutFile, viaBackupProblem, viaLayoutFileName, type ViaBackup, type ViaBackupProblem } from "../../../device/via-keyboard";
import { t, tp, type I18nKey } from "../../../i18n/index";

const MAX_BACKUP_BYTES = 1_000_000;

const PROBLEM_TEXT: Record<ViaBackupProblem, I18nKey> = {
  board: "kb.viaBackupWrongBoard",
  matrix: "kb.viaBackupWrongSize",
  layers: "kb.viaBackupTooManyLayers",
  macros: "kb.viaBackupWrongMacros",
};

type Pending = { backup: ViaBackup } | { error: I18nKey } | null;

export function ViaBackupCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  const via = keyboard?.workspace.via ?? null;
  const [pending, setPending] = useState<Pending>(null);
  if (!keyboard) return null;

  const locale = snapshot.preferences.locale;
  const busy = keyboard.trigger.busy;
  const ready = Boolean(via?.definition && via.keymap);

  const download = (content: unknown, fileName: string): void => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const save = (): void => {
    const backup = via ? createViaBackup(via, keyboard) : null;
    if (backup) download(backup, viaBackupFileName(backup));
  };
  const saveLayout = (): void => {
    const file = via ? createViaLayoutFile(via, keyboard) : null;
    if (file) download(file, viaLayoutFileName(file));
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !via) return;
    if (file.size > MAX_BACKUP_BYTES) return setPending({ error: "kb.viaBackupInvalid" });
    try {
      const text = await file.text();
      // Our own backups first; anything else is tried as a layout file saved by VIA.
      let backup: ViaBackup;
      try { backup = parseViaBackup(text); } catch { backup = viaBackupFromLayoutFile(text, via); }
      const problem = viaBackupProblem(backup, via, keyboard);
      setPending(problem ? { error: PROBLEM_TEXT[problem] } : { backup });
    } catch {
      setPending({ error: "kb.viaBackupInvalid" });
    }
  };

  const restore = (backup: ViaBackup): void => {
    setPending(null);
    void control.applyKeyboardCommand({ kind: "viaRestore", layers: backup.layers, macros: backup.macros, layoutOptions: backup.layoutOptions, ...(backup.encoders ? { encoders: backup.encoders } : {}) });
  };

  return (
    <article className="setting-card keyboard-workspace-card is-wide" hidden={snapshot.workspaceTab !== "buttons"}>
      <div className="setting-heading"><div><h2>{t(locale, "kb.viaBackupTitle")}</h2>
        <small className="setting-note">{t(locale, "kb.viaBackupNote")}</small></div></div>
      <div className="keyboard-selection-actions">
        <button type="button" className="om-btn is-sm" disabled={busy || !ready} onClick={save}>{t(locale, "kb.viaBackupSave")}</button>
        <button type="button" className="om-btn is-sm" disabled={busy || !ready} onClick={saveLayout}>{t(locale, "kb.viaLayoutSave")}</button>
        <label className="om-btn is-sm" aria-disabled={busy || !ready}>{t(locale, "kb.viaBackupLoad")}
          <input type="file" accept=".json,application/json" hidden disabled={busy || !ready} onChange={(event) => void choose(event)} /></label>
      </div>
      {pending && "error" in pending ? <p className="setting-note" style={{ color: "var(--bad)" }} role="alert">{t(locale, pending.error)}</p> : null}
      {pending && "backup" in pending ? <div className="keyboard-save-confirm">
        <p>{tp(locale, "kb.viaBackupSummary", { name: pending.backup.name, layers: pending.backup.layers.length, date: new Date(pending.backup.savedAt).toLocaleString() })}</p>
        <p>{t(locale, "kb.viaBackupConfirm")}</p>
        <button type="button" className="om-btn is-primary is-sm" disabled={busy} onClick={() => restore(pending.backup)}>{t(locale, "kb.viaBackupRestore")}</button>
        <button type="button" className="om-btn is-ghost is-sm" disabled={busy} onClick={() => setPending(null)}>{t(locale, "kb.viaBackupCancel")}</button>
      </div> : null}
    </article>
  );
}
