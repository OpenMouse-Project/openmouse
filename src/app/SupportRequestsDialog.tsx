import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  listSupportRequests,
  contributeDiagnostics,
  submitSupportRequest,
  voteForRequest,
  votingSiteKey,
  type SupportRequest,
} from "../support-requests";
import { loadTurnstile } from "../turnstile";
import { t, tp } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";

export function SupportRequestsDialog({ open, onClose, diagnosticBundle, locale = "en" }: { open: boolean; onClose: () => void; diagnosticBundle: unknown | null; locale?: InterfaceLocale }): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [savedRequest, setSavedRequest] = useState<SupportRequest | null>(null);
  const [reviewDiagnostics, setReviewDiagnostics] = useState(false);
  const [diagnosticConsent, setDiagnosticConsent] = useState(false);
  const turnstileHost = useRef<HTMLDivElement>(null);
  const turnstileWidget = useRef<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (open) {
      setMessage(t(locale, "sup.loadingRequests"));
      void listSupportRequests().then((rows) => { setRequests(rows); setMessage(""); })
        .catch((error: unknown) => setMessage(error instanceof Error ? error.message : t(locale, "sup.loadFail")));
      void votingSiteKey().then(setTurnstileSiteKey)
        .catch((error: unknown) => setMessage(error instanceof Error ? error.message : t(locale, "sup.protectionMissing")));
    }
  }, [open]);

  useEffect(() => {
    if (!open || !turnstileSiteKey || !turnstileHost.current) return;
    let disposed = false;
    void loadTurnstile().then((api) => {
      if (disposed || !turnstileHost.current || turnstileWidget.current) return;
      turnstileWidget.current = api.render(turnstileHost.current, {
        sitekey: turnstileSiteKey,
        action: "mouse-vote",
        theme: "dark",
        callback: (token: string) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setMessage(t(locale, "sup.turnstileFail")),
      });
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : t(locale, "sup.turnstileMissing")));
    return () => {
      disposed = true;
      if (turnstileWidget.current && window.turnstile) window.turnstile.remove(turnstileWidget.current);
      turnstileWidget.current = null;
      setTurnstileToken("");
    };
  }, [open, turnstileSiteKey]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? requests.filter((item) => `${item.manufacturer} ${item.model}`.toLowerCase().includes(needle)) : requests;
  }, [query, requests]);

  async function vote(item: SupportRequest): Promise<void> {
    setBusy(true);
    try {
      await voteForRequest(item.id, turnstileToken);
      setRequests((rows) => rows.map((row) => row.id === item.id ? { ...row, vote_count: row.vote_count + 1 } : row));
      setMessage(tp(locale, "sup.voteRecorded", { item: `${item.manufacturer} ${item.model}` }));
    } catch (error) {
      setMessage(error instanceof Error && /duplicate/i.test(error.message) ? t(locale, "sup.alreadyVoted") : error instanceof Error ? error.message : t(locale, "sup.voteFail"));
    } finally {
      setBusy(false);
      setTurnstileToken("");
      if (turnstileWidget.current && window.turnstile) window.turnstile.reset(turnstileWidget.current);
    }
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    setBusy(true);
    try {
      const saved = await submitSupportRequest({
        manufacturer: String(data.get("manufacturer") ?? "").trim(),
        model: String(data.get("model") ?? "").trim(),
        connection: String(data.get("connection") ?? "Not sure"),
      }, turnstileToken);
      setRequests((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      setSavedRequest(saved);
      setQuery(`${saved.manufacturer} ${saved.model}`);
      setShowForm(false);
      setMessage(t(locale, "sup.saved"));
      form.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t(locale, "sup.saveFail"));
    } finally {
      setBusy(false);
      setTurnstileToken("");
      if (turnstileWidget.current && window.turnstile) window.turnstile.reset(turnstileWidget.current);
    }
  }

  async function uploadDiagnostics(): Promise<void> {
    if (!savedRequest || !diagnosticBundle || !diagnosticConsent) return;
    setBusy(true);
    try {
      await contributeDiagnostics(savedRequest.id, diagnosticBundle, "");
      setReviewDiagnostics(false);
      setMessage(t(locale, "sup.uploadedThanks"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t(locale, "sup.uploadFail"));
    } finally { setBusy(false); }
  }

  return (
    <dialog ref={dialog} className="support-dialog" aria-labelledby="support-dialog-title" onClose={onClose} onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
      <div className="support-dialog-inner">
        <header><div><p className="overline">{t(locale, "sup.support")}</p><h2 id="support-dialog-title">{t(locale, "sup.requestMouse")}</h2></div><button type="button" onClick={onClose} aria-label={t(locale, "common.close")}>×</button></header>
        <p className="support-intro">{turnstileSiteKey
          ? t(locale, "sup.introVote")
          : t(locale, "sup.introPaused")}</p>
        <div className="support-turnstile" ref={turnstileHost} aria-label={t(locale, "sup.turnstile")} />
        {!showForm ? <>
          <input className="support-search" type="search" value={query} onInput={(event) => setQuery(event.currentTarget.value)} placeholder={t(locale, "sup.searchPlaceholder")} aria-label={t(locale, "sup.searchAria")} autoFocus />
          <div className="support-results">
            {matches.map((item) => <article key={item.id}><div><strong>{item.manufacturer} {item.model}</strong><small>{item.connection} · {item.status}</small></div><button type="button" disabled={busy || !turnstileSiteKey || !turnstileToken} onClick={() => void vote(item)} title={!turnstileSiteKey ? t(locale, "sup.protectionLoading") : !turnstileToken ? t(locale, "sup.completeCheck") : undefined}><b>{item.vote_count}</b> {turnstileSiteKey ? t(locale, "sup.vote") : t(locale, "sup.loading")}</button></article>)}
            {!message && matches.length === 0 ? <p>{t(locale, "sup.noMatches")}</p> : null}
          </div>
          <button className="support-primary" type="button" disabled={!turnstileSiteKey} onClick={() => setShowForm(true)}>{t(locale, "sup.requestDifferent")}</button>
        </> : <form className="support-form" onSubmit={(event) => void submit(event)}>
          <div className="support-two"><label>{t(locale, "sup.manufacturer")}<input name="manufacturer" required placeholder="Pulsar" /></label><label>{t(locale, "sup.model")}<input name="model" required placeholder="X2V2" /></label></div>
          <label>{t(locale, "sup.connection")}<select name="connection"><option value="Not sure">{t(locale, "sup.notSure")}</option><option value="Wired USB">{t(locale, "sup.wiredUsb")}</option><option value="Wireless USB receiver">{t(locale, "sup.wirelessUsb")}</option><option value="Bluetooth">{t(locale, "sup.bluetooth")}</option><option value="Wired and wireless">{t(locale, "sup.wiredWireless")}</option></select></label>
          <p className="support-scope">{t(locale, "sup.scope")}</p>
          <p className="support-consent">{t(locale, "sup.consent")}</p>
          <div className="support-actions"><button type="button" onClick={() => setShowForm(false)}>{t(locale, "common.back")}</button><button className="support-primary" type="submit" disabled={busy || !turnstileToken}>{busy ? t(locale, "sup.submitting") : t(locale, "sup.submit")}</button></div>
        </form>}
        {message ? <p className="support-message" role="status">{message}</p> : null}
        {savedRequest && diagnosticBundle && !reviewDiagnostics ? <button className="support-secondary" type="button" onClick={() => setReviewDiagnostics(true)}>{t(locale, "sup.helpDiagnostics")}</button> : null}
        {reviewDiagnostics && diagnosticBundle ? <section className="support-diagnostics" aria-label={t(locale, "sup.reviewAria")}>
          <h3>{t(locale, "sup.reviewTitle")}</h3>
          <p>{t(locale, "sup.reviewBody")}</p>
          <pre>{JSON.stringify(diagnosticBundle, null, 2)}</pre>
          <label><input type="checkbox" checked={diagnosticConsent} onChange={(event) => setDiagnosticConsent(event.currentTarget.checked)} /> {t(locale, "sup.reviewConsent")}</label>
          <div className="support-actions"><button type="button" onClick={() => setReviewDiagnostics(false)}>{t(locale, "common.cancel")}</button><button className="support-primary" type="button" disabled={!diagnosticConsent || busy} onClick={() => void uploadDiagnostics()}>{t(locale, "sup.upload")}</button></div>
        </section> : null}
      </div>
    </dialog>
  );
}
