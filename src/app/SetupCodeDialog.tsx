import { useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import { t } from "../i18n";
import { bindingFromAssignment, decodeSetupCode, describeSetup, encodeSetupCode, type SetupCode } from "../setup-code";

// The two primary clicks are never written, so a shared setup cannot take them over.
const FIRST_WRITABLE_SLOT = 2;

/** What this mouse has right now, as far as a setup code can carry it. */
export function currentSetup(snapshot: ControlSnapshot): SetupCode {
  const setup: SetupCode = {};
  const state = snapshot.analogTuning;
  if (snapshot.status?.analogButtonTuning?.buttons.length === 2) {
    const values = (tuning: typeof state.left) => ({
      actuation: tuning.actuation,
      rapidTrigger: tuning.rapidTrigger,
      haptics: tuning.haptics,
      rapidTriggerEnabled: tuning.rapidTriggerEnabled !== false,
    });
    setup.hits = state.mode === "both"
      ? { left: values(state.both), right: values(state.both) }
      : { left: values(state.left), right: values(state.right) };
  }
  const entry = snapshot.profile.entry;
  if (entry) {
    if (snapshot.profile.bunnyHopSupported) setup.bunnyHopMs = entry.bunnyHoppingMs ?? 0;
    setup.buttons = Array.from({ length: 5 }, (_, slot) => {
      if (slot < FIRST_WRITABLE_SLOT) return null;
      const assignment = entry.buttonAssignments.find((item) => item.button === slot);
      return assignment ? bindingFromAssignment(assignment.action, assignment.raw) : null;
    });
  }
  if (snapshot.status?.dpiStages?.length) setup.dpiStages = [...snapshot.status.dpiStages];
  return setup;
}

/** Stages each part of a decoded setup the same way the cards do, and says what it left out. */
export function applySetup(setup: SetupCode, snapshot: ControlSnapshot): string[] {
  const skipped: string[] = [];
  if (setup.hits) {
    if (snapshot.status?.analogButtonTuning?.buttons.length === 2) control.loadAnalogPreset({ ...setup.hits.left }, { ...setup.hits.right });
    else skipped.push("HITS tuning (this mouse has none)");
  }
  if (setup.bunnyHopMs !== undefined) {
    if (snapshot.profile.bunnyHopSupported && snapshot.profile.entry) control.applyBunnyHopMs(setup.bunnyHopMs);
    else skipped.push("Bunny Hop (not available here)");
  }
  if (setup.buttons) {
    if (snapshot.profile.entry && snapshot.profileFormat?.writable === true) {
      setup.buttons.forEach((binding, slot) => {
        if (!binding || slot < FIRST_WRITABLE_SLOT) return;
        void control.applyLogitechButtonAssignment("primary", slot, binding.kind === "action" ? binding.action : binding);
      });
    } else skipped.push("button assignments (profile is read-only)");
  }
  if (setup.dpiStages) {
    const stages = snapshot.status?.dpiStages;
    if (snapshot.status?.ui?.dpiStageEditor && stages?.length === setup.dpiStages.length) {
      setup.dpiStages.forEach((dpi, stage) => control.applyDpiStageValue(stage, dpi));
    } else skipped.push("DPI stages (this mouse has a different number of stages)");
  }
  return skipped;
}

/** Copy the whole setup as one code, or paste one to apply it. */
export function SetupCodeDialog({
  open,
  snapshot,
  onClose,
}: {
  open: boolean;
  snapshot: ControlSnapshot;
  onClose: () => void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const locale = snapshot.preferences.locale;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (!open) {
      setText("");
      setNote("");
    }
  }, [open]);

  const mine = currentSetup(snapshot);
  const code = open ? encodeSetupCode(mine) : "";
  const decoded = text.trim() ? decodeSetupCode(text) : null;
  const problem = text.trim() && !decoded ? "That is not a valid setup code." : null;

  return (
    <dialog
      ref={dialog}
      className="support-dialog share-profile-dialog"
      aria-labelledby="setup-code-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    >
      <div className="support-dialog-inner share-profile-dialog-inner">
        <header>
          <div>
            <p className="overline">Setup</p>
            <h2 id="setup-code-title">Share setup</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, "common.close")}>×</button>
        </header>
        <div className="profile-key-fields">
          <label className="profile-key-field">
            <span>Your setup code</span>
            <textarea rows={3} readOnly value={code} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <small className="setting-description">Holds: {describeSetup(mine).join(", ") || "nothing yet"}.</small>
          <div className="import-hits-actions">
            <button
              type="button"
              className="connect-button"
              onClick={() => {
                navigator.clipboard?.writeText(code).then(() => setNote("Code copied."), () => setNote("Copy failed. Select the code and copy it."));
              }}
            >
              Copy code
            </button>
          </div>
          <label className="profile-key-field">
            <span>Apply a code</span>
            <textarea
              rows={3}
              placeholder="SETUP1-…"
              value={text}
              onChange={(event) => { setText(event.currentTarget.value); setNote(""); }}
            />
          </label>
          {problem ? <small className="setting-description" role="alert">{problem}</small> : null}
          {decoded ? <small className="setting-description" role="status">This code sets: {describeSetup(decoded).join(", ")}.</small> : null}
          {note ? <small className="setting-description" role="status">{note}</small> : null}
          <div className="import-hits-actions">
            <button
              type="button"
              className="connect-button"
              disabled={!decoded || snapshot.settingInProgress}
              onClick={() => {
                if (!decoded) return;
                const skipped = applySetup(decoded, snapshot);
                setNote(skipped.length ? `Applied. Left out: ${skipped.join("; ")}.` : "Applied.");
                setText("");
              }}
            >
              Apply setup
            </button>
            <button type="button" className="connect-button" onClick={onClose}>{t(locale, "common.close")}</button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
