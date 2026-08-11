import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  listSupportRequests,
  contributeDiagnostics,
  submitSupportRequest,
  voteForRequest,
  voterToken,
  type SupportRequest,
} from "../support-requests";

const FEATURES = ["DPI", "Polling rate", "Buttons", "Profiles", "Lighting", "Battery"];

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

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (open) {
      setMessage("Loading requests…");
      void listSupportRequests().then((rows) => { setRequests(rows); setMessage(""); })
        .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load requests."));
    }
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? requests.filter((item) => `${item.manufacturer} ${item.model}`.toLowerCase().includes(needle)) : requests;
  }, [query, requests]);

  async function vote(item: SupportRequest): Promise<void> {
    setBusy(true);
    try {
      await voteForRequest(item.id, voterToken(localStorage));
      setRequests((rows) => rows.map((row) => row.id === item.id ? { ...row, vote_count: row.vote_count + 1 } : row));
      setMessage(`Your vote for ${item.manufacturer} ${item.model} was recorded.`);
    } catch (error) {
      setMessage(error instanceof Error && /duplicate/i.test(error.message) ? "You already voted for this mouse." : error instanceof Error ? error.message : "Could not record your vote.");
    } finally { setBusy(false); }
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
        features: data.getAll("features").map(String),
        canTest: data.get("can_test") === "on",
      }, voterToken(localStorage));
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
      await contributeDiagnostics(savedRequest.id, diagnosticBundle, voterToken(localStorage));
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
        <p className="support-intro">Search first. If your mouse is already here, add your vote; otherwise create a new request.</p>
        {!showForm ? <>
          <input className="support-search" type="search" value={query} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search manufacturer or model" aria-label="Search mouse requests" autoFocus />
          <div className="support-results">
            {matches.map((item) => <article key={item.id}><div><strong>{item.manufacturer} {item.model}</strong><small>{item.connection} · {item.status}</small></div><button type="button" disabled={busy} onClick={() => void vote(item)}><b>{item.vote_count}</b> Vote</button></article>)}
            {!message && matches.length === 0 ? <p>No matching requests yet.</p> : null}
          </div>
          <button className="support-primary" type="button" onClick={() => setShowForm(true)}>Request a different mouse</button>
        </> : <form className="support-form" onSubmit={(event) => void submit(event)}>
          <div className="support-two"><label>Manufacturer<input name="manufacturer" required placeholder="Pulsar" /></label><label>Model<input name="model" required placeholder="X2V2" /></label></div>
          <label>Connection<select name="connection"><option>Not sure</option><option>Wired USB</option><option>Wireless USB receiver</option><option>Bluetooth</option><option>Wired and wireless</option></select></label>
          <fieldset><legend>What should OpenMouse support?</legend><div className="support-features">{FEATURES.map((feature) => <label key={feature}><input type="checkbox" name="features" value={feature} />{feature}</label>)}</div></fieldset>
          <label className="support-check"><input type="checkbox" name="can_test" /> I can help test support for this mouse</label>
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
