import { useEffect, useRef, useState, type ReactNode } from "react";
import { lunafuryKeyboardAction, lunafuryParseKeyboardAction } from "@openmouse/protocol/lamzu";
import { LUNAFURY_KEY_CHOICES, LUNAFURY_MODIFIERS, LUNAFURY_MODIFIER_CODES,
  lunaFuryKeyboardLabel, lunaFuryKeyAction } from "../../../device/lunafury-buttons.ts";
import { applyDeviceButtonMapping } from "../../../device/controller.ts";
import type { InterfaceLocale } from "../../settings/interface-preferences.ts";
import { t } from "../../../i18n/index.ts";

export function LunaFuryKeyboardBinding({ button, assigned, profile, disabled, locale }: {
  button: string; assigned: string; profile: number | null | undefined; disabled: boolean; locale: InterfaceLocale;
}): ReactNode {
  const initial = lunafuryParseKeyboardAction(assigned);
  const [usage, setUsage] = useState(initial?.usage ?? 4);
  const [modifiers, setModifiers] = useState(initial?.modifiers ?? 0);
  const [unsupported, setUnsupported] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  const held = useRef(0);
  useEffect(() => {
    const key = lunafuryParseKeyboardAction(assigned);
    setUsage(key?.usage ?? 4); setModifiers(key?.modifiers ?? 0); setUnsupported(false);
    held.current = 0;
    if (details.current) details.current.open = false;
  }, [assigned, profile]);
  const action = lunafuryKeyboardAction(modifiers, usage);
  return (
    <details ref={details} className="luna-key-binding">
      <summary>{t(locale, "prof.keyboardShortcut")}</summary>
      <fieldset disabled={disabled}>
        <button type="button" className="om-btn luna-key-capture"
          onBlur={() => { held.current = 0; }}
          onKeyUp={(event) => { held.current &= ~(LUNAFURY_MODIFIER_CODES[event.code] ?? 0); }}
          onKeyDown={(event) => {
            if (event.isComposing || event.repeat) return;
            // Tab retains normal navigation; choose Tab explicitly in the key list.
            if (event.code === "Tab") return;
            event.preventDefault(); event.stopPropagation();
            const modifier = LUNAFURY_MODIFIER_CODES[event.code];
            if (modifier) { held.current |= modifier; return; }
            let mask = held.current;
            for (const [pressed, bits, left] of [[event.ctrlKey, 17, 1], [event.shiftKey, 34, 2],
              [event.altKey, 68, 4], [event.metaKey, 136, 8]] as const) {
              if (!pressed) mask &= ~bits;
              else if (!(mask & bits)) mask |= left;
            }
            const captured = lunaFuryKeyAction(event.code, mask);
            setUnsupported(!captured);
            const key = captured && lunafuryParseKeyboardAction(captured);
            if (key) { setUsage(key.usage); setModifiers(key.modifiers); }
          }}>{t(locale, "luna.keyHint")}</button>
        <label>{t(locale, "luna.keyLabel")}
          <select value={usage} onChange={(event) => { setUsage(Number(event.currentTarget.value)); setUnsupported(false); }}>
            {LUNAFURY_KEY_CHOICES.map((key) => <option key={key.code} value={key.usage}>{key.code.replace(/^Key|^Digit/, "")}</option>)}
          </select>
        </label>
        <div className="luna-key-modifiers" role="group" aria-label={t(locale, "luna.modifiers")}>
          {LUNAFURY_MODIFIERS.map((name, bit) => <label key={name}>
            <input type="checkbox" checked={!!(modifiers & (1 << bit))}
              onChange={(event) => setModifiers(event.currentTarget.checked ? modifiers | (1 << bit) : modifiers & ~(1 << bit))} />{name}
          </label>)}
        </div>
        <output>{lunaFuryKeyboardLabel(action)}</output>
        {unsupported && <p className="field-note" role="alert">{t(locale, "luna.keyUnsupported")}</p>}
        <div className="luna-key-actions">
          <button type="button" className="om-btn is-primary" disabled={unsupported}
            onClick={() => { applyDeviceButtonMapping(button, action); if (details.current) details.current.open = false; }}>
            {t(locale, "common.save")}
          </button>
          <button type="button" className="om-btn" onClick={() => {
            setUsage(initial?.usage ?? 4); setModifiers(initial?.modifiers ?? 0); setUnsupported(false); held.current = 0;
            if (details.current) details.current.open = false;
          }}>
            {t(locale, "common.cancel")}
          </button>
        </div>
      </fieldset>
    </details>
  );
}
