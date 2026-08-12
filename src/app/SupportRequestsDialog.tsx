import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  listSupportRequests,
  contributeDiagnostics,
  submitSupportRequest,
  voteForRequest,
  votingSiteKey,
  type SupportRequest,
  SUPPORT_REQUEST_WRITES_ENABLED,
} from "../support-requests";
import { loadTurnstile } from "../turnstile";

export function SupportRequestsDialog({ open, onClose, diagnosticBundle }: { open: boolean; onClose: () => void; diagnosticBundle: unknown | null }): ReactNode {
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
      setMessage("Loading requests…");
      void listSupportRequests().then((rows) => { setRequests(rows); setMessage(""); })
        .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load requests."));
      void votingSiteKey().then(setTurnstileSiteKey)
        .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Voting protection is not configured."));
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
        "error-callback": () => setMessage("Anti-spam verification failed to load."),
      });
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Anti-spam check did not load."));
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
      setMessage(`Your vote for ${item.manufacturer} ${item.model} was recorded.`);
    } catch (error) {
      setMessage(error instanceof Error && /duplicate/i.test(error.message) ? "You already voted for this mouse." : error instanceof Error ? error.message : "Could not record your vote.");
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
      }, "");
      setRequests((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      setSavedRequest(saved);
      setQuery(`${saved.manufacturer} ${saved.model}`);
      setShowForm(false);
      setMessage("Request saved. Your vote was added too.");
      form.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this request.");
    } finally { setBusy(false); }
  }

  async function uploadDiagnostics(): Promise<void> {
    if (!savedRequest || !diagnosticBundle || !diagnosticConsent) return;
    setBusy(true);
    try {
      await contributeDiagnostics(savedRequest.id, diagnosticBundle, "");
      setReviewDiagnostics(false);
      setMessage("Diagnostics uploaded separately. Thank you for helping us investigate this mouse.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload diagnostics.");
    } finally { setBusy(false); }
  }

  return (
    <dialog ref={dialog} className="support-dialog" aria-labelledby="support-dialog-title" onClose={onClose} onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
      <div className="support-dialog-inner">
        <header><div><p className="overline">DEVICE SUPPORT</p><h2 id="support-dialog-title">Request a mouse</h2></div><button type="button" onClick={onClose} aria-label="Close">×</button></header>
        <p className="support-intro">{turnstileSiteKey
          ? "Complete the anti-spam check, then add one vote to a mouse already listed. New requests remain temporarily paused."
          : "Voting and new requests are temporarily paused while we add stronger abuse protection."}</p>
        <div className="support-turnstile" ref={turnstileHost} aria-label="Anti-spam verification" />
        {!showForm ? <>
          <input className="support-search" type="search" value={query} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search manufacturer or model" aria-label="Search mouse requests" autoFocus />
          <div className="support-results">
            {matches.map((item) => <article key={item.id}><div><strong>{item.manufacturer} {item.model}</strong><small>{item.connection} · {item.status}</small></div><button type="button" disabled={busy || !turnstileSiteKey || !turnstileToken} onClick={() => void vote(item)} title={!turnstileSiteKey ? "Voting protection is loading" : !turnstileToken ? "Complete the anti-spam check first" : undefined}><b>{item.vote_count}</b> {turnstileSiteKey ? "Vote" : "Loading"}</button></article>)}
            {!message && matches.length === 0 ? <p>No matching requests yet.</p> : null}
          </div>
          <button className="support-primary" type="button" disabled={!SUPPORT_REQUEST_WRITES_ENABLED} onClick={() => setShowForm(true)}>{SUPPORT_REQUEST_WRITES_ENABLED ? "Request a different mouse" : "Requests temporarily paused"}</button>
        </> : <form className="support-form" onSubmit={(event) => void submit(event)}>
          <div className="support-two"><label>Manufacturer<input name="manufacturer" required placeholder="Pulsar" /></label><label>Model<input name="model" required placeholder="X2V2" /></label></div>
          <label>Connection<select name="connection"><option>Not sure</option><option>Wired USB</option><option>Wireless USB receiver</option><option>Bluetooth</option><option>Wired and wireless</option></select></label>
          <p className="support-scope">A request covers the whole mouse: performance settings, buttons, profiles, lighting, battery information, and every other capability we can support.</p>
          <p className="support-consent">This submits only the fields shown here. Device diagnostics are never attached automatically.</p>
          <div className="support-actions"><button type="button" onClick={() => setShowForm(false)}>Back</button><button className="support-primary" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit request"}</button></div>
        </form>}
        {message ? <p className="support-message" role="status">{message}</p> : null}
        {savedRequest && diagnosticBundle && !reviewDiagnostics ? <button className="support-secondary" type="button" onClick={() => setReviewDiagnostics(true)}>Help add support with diagnostics</button> : null}
        {reviewDiagnostics && diagnosticBundle ? <section className="support-diagnostics" aria-label="Diagnostic upload review">
          <h3>Review diagnostics before uploading</h3>
          <p>Reports may contain firmware, receiver identifiers, onboard settings, and recent HID traffic. Nothing below is uploaded until you consent.</p>
          <pre>{JSON.stringify(diagnosticBundle, null, 2)}</pre>
          <label><input type="checkbox" checked={diagnosticConsent} onChange={(event) => setDiagnosticConsent(event.currentTarget.checked)} /> I reviewed this data and agree to upload it for this support request.</label>
          <div className="support-actions"><button type="button" onClick={() => setReviewDiagnostics(false)}>Cancel</button><button className="support-primary" type="button" disabled={!diagnosticConsent || busy} onClick={() => void uploadDiagnostics()}>Upload diagnostics</button></div>
        </section> : null}
      </div>
    </dialog>
  );
}
