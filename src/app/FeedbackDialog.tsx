import { useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../device/controller";
import { t, tp } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";

const FEEDBACK_WEBHOOK_URL = "";
const MAX_FEEDBACK_LENGTH = 1800;
const SUBMIT_COOLDOWN_MS = 60_000;
const MAX_SESSION_SUBMITS = 5;
const STORAGE_KEY = "om.feedback.sentAt";

export function FeedbackDialog({ open, onClose, locale = "en", canAttachDiagnostics = false }: {
  open: boolean;
  onClose: () => void;
  locale?: InterfaceLocale;
  canAttachDiagnostics?: boolean;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [feedback, setFeedback] = useState("");
  const [handle, setHandle] = useState("");
  const [attach, setAttach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const sendRef = useRef<number>(0);

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

  function readSentState(): { count: number; last: number } {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { count: 0, last: 0 };
      const times: unknown = JSON.parse(raw);
      const list = Array.isArray(times) ? times.filter((t) => typeof t === "number") : [];
      return {
        count: list.length,
        last: list.length > 0 ? Number(list[list.length - 1]) : 0,
      };
    } catch {
      return { count: 0, last: 0 };
    }
  }

  useEffect(() => {
    const { count, last } = readSentState();
    sendRef.current = count;
    const remaining = last ? SUBMIT_COOLDOWN_MS - (Date.now() - last) : 0;
    if (remaining > 0 && count < MAX_SESSION_SUBMITS) setCooldown(remaining);
  }, []);

  useEffect(() => {
    if (!open) return;
    const { count, last } = readSentState();
    sendRef.current = count;
    const remaining = last ? SUBMIT_COOLDOWN_MS - (Date.now() - last) : 0;
    if (remaining > 0 && count < MAX_SESSION_SUBMITS) setCooldown(remaining);
  }, [open]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(0), cooldown);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const trimmed = feedback.trim();
  const webhookConfigured = FEEDBACK_WEBHOOK_URL.length > 0;
  const canSend = trimmed.length > 0 && !busy && cooldown <= 0 && sendRef.current < MAX_SESSION_SUBMITS && webhookConfigured;

  function reset(): void {
    setFeedback("");
    setHandle("");
    setError(false);
  }

  function recordSent(): void {
    const now = Date.now();
    let times: number[] = [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed.filter((t) => typeof t === "number") : [];
        times = [...list.filter((t) => now - t < SUBMIT_COOLDOWN_MS), now].slice(-MAX_SESSION_SUBMITS);
      } else {
        times = [now];
      }
    } catch {
      times = [now];
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(times));
    } catch {
      /* ignore storage errors */
    }
    sendRef.current = times.length;
    setCooldown(SUBMIT_COOLDOWN_MS);
  }

  async function send(): Promise<void> {
    if (!canSend) return;
    setBusy(true);
    setError(false);
    let ok = false;
    try {
      const bundle = attach ? control.supportDiagnosticBundle() : null;
      const statusBundle = bundle?.status as { name?: string | null } | undefined;
      const webhid = bundle?.webhid as { productName?: string | null } | undefined;
      const deviceName = bundle
        ? statusBundle?.name ?? webhid?.productName ?? null
        : null;
      const embed = {
        title: "New Feedback",
        description: trimmed.slice(0, 4000),
        color: 0x00b0f4,
        ...(handle.trim() ? { footer: { text: `@${handle.trim()}` } } : {}),
        ...(deviceName ? { fields: [{ name: "Device", value: `**${deviceName}**`, inline: true }] } : {}),
      };
      let response: Response;
      if (bundle) {
        const form = new FormData();
        form.append(
          "payload_json",
          JSON.stringify({
            embeds: [embed],
            attachments: [{ id: "0", description: "Device details and diagnostic log", filename: "openmouse-diagnostics.json" }],
          }),
        );
        form.append(
          "files[0]",
          new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }),
          "openmouse-diagnostics.json",
        );
        response = await fetch(FEEDBACK_WEBHOOK_URL, { method: "POST", body: form });
      } else {
        response = await fetch(FEEDBACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [embed] }),
        });
      }
      ok = response.ok;
      if (!ok) throw new Error(String(response.status));
      recordSent();
      control.pushToast("success", t(locale, "fb.sent"), t(locale, "fb.sentDetail"));
      reset();
      onClose();
    } catch {
      setError(true);
      control.pushToast("error", t(locale, "fb.error"), t(locale, "fb.errorDetail"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="support-dialog feedback-dialog"
      aria-labelledby="feedback-dialog-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    >
      <form
        className="support-dialog-inner feedback-dialog-inner"
        onSubmit={(event) => { event.preventDefault(); void send(); }}
      >
        <header>
          <div>
            <p className="overline">OpenMouse</p>
            <h2 id="feedback-dialog-title">{t(locale, "fb.title")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, "common.close")}>×</button>
        </header>

        <p className="feedback-description">{t(locale, "fb.description")}</p>

        <textarea
          id="feedback-text"
          className="feedback-textarea"
          rows={6}
          maxLength={MAX_FEEDBACK_LENGTH}
          placeholder={t(locale, "fb.placeholder")}
          value={feedback}
          onChange={(event) => setFeedback(event.currentTarget.value)}
        />

        <label className="feedback-handle" htmlFor="feedback-handle">
          <span>{t(locale, "fb.handleLabel")}</span>
          <input
            id="feedback-handle"
            type="text"
            maxLength={32}
            placeholder={t(locale, "fb.handlePlaceholder")}
            value={handle}
            onChange={(event) => setHandle(event.currentTarget.value.replace(/^@/, ""))}
          />
        </label>

        <label className="feedback-attach">
          <input
            id="feedback-attach"
            type="checkbox"
            checked={attach}
            disabled={!canAttachDiagnostics || busy}
            onChange={(event) => setAttach(event.currentTarget.checked)}
          />
          <span>
            <strong>{t(locale, "fb.attachLabel")}</strong>
            <small>{t(locale, "fb.attachDetail")}</small>
          </span>
        </label>

        {error ? (
          <p className="feedback-error" role="alert">
            {t(locale, "fb.error")} {t(locale, "fb.errorDetail")}
          </p>
        ) : null}

        {cooldown > 0 ? (
          <p className="feedback-error" role="status">
            {tp(locale, "fb.cooldown", { seconds: Math.ceil(cooldown / 1000) })}
          </p>
        ) : sendRef.current >= MAX_SESSION_SUBMITS ? (
          <p className="feedback-error" role="status">
            {t(locale, "fb.limit")}
          </p>
        ) : null}

        <div className="feedback-actions">
          <button type="button" onClick={onClose}>{t(locale, "common.cancel")}</button>
          <button type="submit" className="is-primary" disabled={!canSend}>
            {busy ? "…" : t(locale, "fb.send")}
          </button>
        </div>
      </form>
    </dialog>
  );
}