import { displayText } from "../../i18n";
import type { ReactNode } from "react";
import type { ControlSnapshot } from "../../device/types";
import * as control from "../../device/controller";
import { t } from "../../i18n";
import { Segmented } from "../ui";

/** Reuse the keyboard workspace's system-mode control, without Wuque settings. */
export function KochiKeyboardPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  if (!keyboard) return null;
  const locale = snapshot.preferences.locale;
  const mode = keyboard.workspace.systemMode;
  const busy = keyboard.trigger.busy;
  return (
    <section className="keyboard-panel" data-workspace-host role="tabpanel" aria-labelledby="workspace-tab-overview">
      {keyboard.trigger.statusText ? <output className="keyboard-status" role="status">{displayText(locale, keyboard.trigger.statusText)}</output> : null}
      <article className="setting-card keyboard-identity-card keyboard-workspace-card">
        <div className="setting-heading"><div><div className="title-row"><h2>{keyboard.name}</h2><p>{t(locale, "kb.keyboardLabel")}</p></div>
          <small className="setting-note">{t(locale, "kb.kochiModeNote")}</small>
        </div></div>
        <fieldset disabled={busy || mode == null} className="keyboard-fields">
          <Segmented id="keyboard-system" ariaLabel={t(locale, "kb.system")} options={[{ value: 0, label: "WIN" }, { value: 1, label: "MAC" }]}
            value={mode === "win" ? 0 : mode === "mac" ? 1 : null}
            onChange={value => control.applyKeyboardCommand({ kind: "system", value })} />
        </fieldset>
        <button type="button" disabled={busy} onClick={() => control.applyKeyboardCommand({ kind: "refresh" })}>{t(locale, "kb.refresh")}</button>
      </article>
    </section>
  );
}
