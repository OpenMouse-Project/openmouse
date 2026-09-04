import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./support-admin.css";

/* ============================================================================
   OpenMouse-Support · staff dashboard
   Discord is the user-facing surface; this is the private staff/developer
   control center. Auth is Discord OAuth2 enforced server-side (see
   functions/api/support/*). Realtime is via lightweight polling.
   ========================================================================== */

type Status = "OPEN" | "IN_PROGRESS" | "WAITING_FOR_USER" | "RESOLVED" | "CLOSED";
type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
// Single staff tier — access is gated by one Discord server role, not by
// individual ids or a hierarchy. Kept as a type (not a literal) for the enum
// value stored on the session/DB row.
type Role = "SUPPORT";

interface Session {
  discordId: string;
  role: Role;
  name: string;
}

interface Ticket {
  id: string;
  number: number;
  public_number: string;
  subject: string;
  description: string;
  category: string;
  device_model: string | null;
  openmouse_version: string | null;
  operating_system: string | null;
  firmware_version: string | null;
  status: Status;
  priority: Priority;
  assigned_to: string | null;
  assigned?: { discord_id: string; display_name: string | null; discord_username: string | null };
  user_discord_id: string;
  user_discord_username: string;
  discord_thread_id: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
}

interface Message {
  id: string;
  content: string;
  message_type: "USER" | "STAFF" | "SYSTEM";
  source: "discord" | "dashboard";
  author_discord_id: string;
  author_name: string;
  is_internal_note: boolean;
  attachments: { url: string; name: string }[];
  delivered_to_discord?: boolean;
  created_at: string;
}

interface Participant {
  ticket_id: string;
  discord_id: string;
  discord_username: string | null;
}

interface AuditEntry {
  id: string;
  action: string;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  ticketNumber?: string | null;
  ticketSubject?: string | null;
}

interface TicketPage {
  total: number;
  page: number;
  pageSize: number;
  rows: Ticket[];
}

interface OverviewData {
  counts: {
    open: number;
    unassigned: number;
    mine: number;
    waitingForUser: number;
    highPriority: number;
    urgent: number;
    resolvedToday: number;
  };
  avgResponseSeconds: number | null;
  recentTickets: Ticket[];
  activity: AuditEntry[];
}

const STATUSES: Status[] = ["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"];
const PRIORITIES: Priority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
const CATEGORIES = [
  "Device Not Detected", "Firmware", "DPI", "Polling Rate", "Lighting",
  "Compatibility", "Crash", "Installation", "Wireless", "Performance", "Other",
];

const STATUS_LABEL: Record<Status, string> = {
  OPEN: "Open", IN_PROGRESS: "In progress", WAITING_FOR_USER: "Waiting for user",
  RESOLVED: "Resolved", CLOSED: "Closed",
};
const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent",
};

/* ---------- helpers ---------- */
function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtAgo(seconds: number | null): string {
  if (seconds == null) return "—";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return hrs >= 24 ? `${Math.floor(hrs / 24)}d` : `${hrs}h ${rem}m`;
}
function assigneeName(t: Ticket): string {
  if (!t.assigned) return "Unassigned";
  return t.assigned.display_name || t.assigned.discord_username || "Staff";
}

/* ---------- icons ---------- */
const iconProps = {
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};
const IcOverview = () => (<svg {...iconProps}><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>);
const IcTickets = () => (<svg {...iconProps}><rect x="3" y="4" width="18" height="17" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>);
const IcAudit = () => (<svg {...iconProps}><path d="M12 6v6l4 2" /><circle cx="12" cy="12" r="9" /></svg>);
const IcMouse = () => (<svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="3" width="10" height="18" rx="5" /><line x1="12" y1="7" x2="12" y2="11" /></svg>);
const IcLogout = () => (<svg width={14} height={14} {...iconProps}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>);

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options,
  });
  if (res.status === 401) throw new ApiError(401, "Not authenticated");
  if (res.status === 403) throw new ApiError(403, "Forbidden");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { message?: string }).message ?? "Request failed");
  }
  return (await res.json()) as T;
}
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/* ---------- login ---------- */
function Login() {
  return (
    <div className="s-login">
      <div className="s-login-card">
        <div className="s-login-brand">
          <div className="s-login-brand-mark"><IcMouse /></div>
          <div>
            <h1 className="s-login-title">OpenMouse-Support</h1>
            <div className="s-login-sub">Staff Dashboard</div>
          </div>
        </div>
        <p className="s-login-desc">
          Internal support &amp; ticket management for the OpenMouse project. Sign in with
          your Discord account — access is restricted to authorized staff.
        </p>
        <a className="s-login-button" href="/api/support/login?redirect=/support">
          <svg viewBox="0 0 24 24" width={18} height={18} fill="white"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.9 3l-.3.6a18 18 0 0 0-7.2 0L8.1 3a19.8 19.8 0 0 0-4.4 1.4A20.8 20.8 0 0 0 .2 18.1a19.9 19.9 0 0 0 6 3l.5-.8a12.9 12.9 0 0 1-1.8-.9l.4-.3a14.2 14.2 0 0 0 12.2 0l.4.3c-.6.3-1.2.6-1.8.9l.5.8a19.8 19.8 0 0 0 6-3 20.7 20.7 0 0 0-2.1-13.7ZM8.7 15.3c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Zm6.6 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Z" /></svg>
          Sign in with Discord
        </a>
        <div className="s-login-foot">Authorized OpenMouse staff only</div>
      </div>
    </div>
  );
}

/* ---------- stat tile ---------- */
function Stat({ icon, value, label }: { icon: any; value: any; label: string }) {
  return (
    <div className="s-stat">
      <div className="s-stat-top"><div className="s-stat-icon">{icon}</div></div>
      <div className="s-stat-value">{value}</div>
      <div className="s-stat-label">{label}</div>
    </div>
  );
}

/* ---------- overview ---------- */
function OverviewView({ session }: { session: Session }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api<OverviewData>("/api/support/overview");
        if (active) { setData(d); setError(null); }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => { active = false; };
  }, [session]);

  if (error && !data) return <div className="s-error-panel">Could not load overview: {error}</div>;
  if (!data) return <div className="s-loading"><span className="s-spinner" />Loading overview…</div>;

  return (
    <>
      <div className="s-stat-row">
        <Stat icon={<IcTickets />} value={data.counts.open} label="Open tickets" />
        <Stat icon={<IcTickets />} value={data.counts.unassigned} label="Unassigned" />
        <Stat icon={<IcTickets />} value={data.counts.mine} label="My tickets" />
        <Stat icon={<IcOverview />} value={data.counts.waitingForUser} label="Waiting for user" />
        <Stat icon={<IcOverview />} value={data.counts.highPriority} label="High priority" />
        <Stat icon={<IcAudit />} value={data.counts.urgent} label="Urgent" />
        <Stat icon={<IcAudit />} value={data.counts.resolvedToday} label="Resolved today" />
        <Stat icon={<IcAudit />} value={fmtAgo(data.avgResponseSeconds)} label="Avg first response" />
      </div>

      <div className="s-row2">
        <section className="s-card">
          <div className="s-card-head">
            <div>
              <p className="s-card-title">Recent tickets</p>
              <p className="s-card-sub">Most recently created</p>
            </div>
          </div>
          {data.recentTickets.length ? (
            <table className="s-table">
              <thead><tr><th>Ticket</th><th>Subject</th><th>User</th><th>Status</th><th>Priority</th></tr></thead>
              <tbody>
                {data.recentTickets.map((t) => (
                  <tr key={t.id} onClick={() => (location.hash = `#/tickets/${t.id}`)}>
                    <td className="s-ticket-number">{t.public_number}</td>
                    <td className="s-subject">{t.subject}</td>
                    <td className="s-cell-muted">{t.user_discord_username || t.user_discord_id}</td>
                    <td><StatusPill s={t.status} /></td>
                    <td><PriorityPill p={t.priority} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="s-empty">No tickets yet.</div>}
        </section>

        <section className="s-card">
          <div className="s-card-head">
            <div>
              <p className="s-card-title">Recent activity</p>
              <p className="s-card-sub">Latest staff &amp; ticket events</p>
            </div>
          </div>
          {data.activity.length ? (
            <div className="s-audit">
              {data.activity.map((a) => (
                <AuditRow key={a.id} entry={a} clickable />
              ))}
            </div>
          ) : <div className="s-empty">No activity yet.</div>}
        </section>
      </div>
    </>
  );
}

function StatusPill({ s }: { s: Status }) {
  return <span className={`s-pill s-pill-status-${s}`}>{STATUS_LABEL[s]}</span>;
}
function PriorityPill({ p }: { p: Priority }) {
  return <span className={`s-pill s-pill-priority-${p}`}>{PRIORITY_LABEL[p]}</span>;
}

const ACTION_LABEL: Record<string, string> = {
  ticket_created: "Ticket created", ticket_assigned: "Assigned", ticket_reassigned: "Reassigned",
  ticket_unassigned: "Unassigned", status_changed: "Status changed", priority_changed: "Priority changed",
  staff_reply: "Staff replied", internal_note: "Internal note", ticket_reopened: "Reopened",
  ticket_resolved: "Resolved", ticket_closed: "Closed", participant_added: "Participant added",
  participant_removed: "Participant removed",
};

function AuditRow({ entry, clickable }: { entry: AuditEntry; clickable?: boolean }) {
  return (
    <div className="s-audit-item">
      <span className="s-audit-action">{ACTION_LABEL[entry.action] ?? entry.action}</span>
      <span className="s-audit-actor">{entry.actor_name ?? entry.metadata?.actor ?? "—"}</span>
      {entry.ticketNumber && clickable && (
        <span className="s-cell-muted">· <a href={`#/tickets/${entry.metadata?.ticket_id ?? ""}`} onClick={(e) => e.stopPropagation()}>{entry.ticketNumber}</a></span>
      )}
      <span className="s-audit-time">{fmtTime(entry.created_at)}</span>
    </div>
  );
}

/* ---------- tickets list ---------- */
type Filter = "all" | "unassigned" | "mine" | "open" | "resolved" | "closed";

const TICKET_FILTERS: { key: Filter; label: string; statusArg: string }[] = [
  { key: "all", label: "All", statusArg: "all" },
  { key: "open", label: "Open", statusArg: "all" },
  { key: "unassigned", label: "Unassigned", statusArg: "all" },
  { key: "mine", label: "My tickets", statusArg: "all" },
  { key: "resolved", label: "Resolved", statusArg: "all" },
  { key: "closed", label: "Closed", statusArg: "all" },
];

function TicketsView({ session }: { session: Session }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("updated");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [data, setData] = useState<TicketPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [filter, status, debouncedQ, priority, category]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      filter, status, priority, category, sort, dir,
      page: String(page), pageSize: String(pageSize),
    });
    if (debouncedQ) params.set("q", debouncedQ);
    (async () => {
      try {
        const d = await api<TicketPage>(`/api/support/tickets?${params.toString()}`);
        if (active) { setData(d); setError(null); }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => { active = false; };
  }, [filter, status, debouncedQ, priority, category, sort, dir, page, pageSize, session]);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  return (
    <>
      <div className="s-tabs">
        {TICKET_FILTERS.map((f) => (
          <button key={f.key} className={`s-tab ${filter === f.key ? "is-active" : ""}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="s-toolbar">
        <input type="search" className="s-input" placeholder="Search number, subject, user, device, category…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <select className="s-select" value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="s-select" value={priority} onChange={(e) => setPriority((e.target as HTMLSelectElement).value)}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <select className="s-select" value={category} onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="s-select" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value)}>
          <option value="updated">Sort: last activity</option>
          <option value="created">Sort: created</option>
          <option value="priority">Sort: priority</option>
        </select>
        <button className="s-btn-ghost s-btn s-btn-sm" onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}>
          {dir === "desc" ? "Desc ↓" : "Asc ↑"}
        </button>
      </div>

      {error && !data && <div className="s-error-panel">Could not load tickets: {error}</div>}

      <section className="s-card">
        {!data ? (
          <div className="s-loading"><span className="s-spinner" />Loading tickets…</div>
        ) : data.rows.length ? (
          <table className="s-table">
            <thead>
              <tr><th>Ticket</th><th>Subject</th><th>User</th><th>Device</th><th>Category</th><th>Status</th><th>Priority</th><th>Assigned</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {data.rows.map((t) => (
                <tr key={t.id} onClick={() => (location.hash = `#/tickets/${t.id}`)}>
                  <td className="s-ticket-number">{t.public_number}</td>
                  <td className="s-subject">{t.subject}</td>
                  <td>
                    <div className="s-user-cell">
                      <span className="s-user-name">{t.user_discord_username || "Unknown"}</span>
                      <span className="s-user-id">{t.user_discord_id}</span>
                    </div>
                  </td>
                  <td className="s-cell-muted">{t.device_model || "—"}</td>
                  <td className="s-cell-muted">{t.category}</td>
                  <td><StatusPill s={t.status} /></td>
                  <td><PriorityPill p={t.priority} /></td>
                  <td className="s-cell-muted">{assigneeName(t)}</td>
                  <td className="s-cell-muted s-time">{fmtTime(t.last_activity_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="s-empty">No tickets match your search.</div>}
      </section>

      <div className="s-pagination">
        <span>{data?.total ?? 0} results · page {page} / {totalPages}</span>
        <button className="s-page-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
        <button className="s-page-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
      </div>
    </>
  );
}

/* ---------- ticket detail ---------- */
function TicketDetailView({ id }: { id: string }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [staff, setStaff] = useState<{ discord_id: string; display_name: string | null; discord_username: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [conversationUnavailable, setConversationUnavailable] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Polling cursor = the newest message id the client has seen (Discord pages by
  // message id, not timestamp). Ref, not state, so the poll interval is stable.
  const pollCursorRef = useRef<string | null>(null);
  // Oldest Discord message id loaded so far, for lazy-loading older history.
  const oldestDiscordIdRef = useRef<string | null>(null);

  // Single staff tier now: any authenticated staff member can manage participants.
  const canManage = true;

  const newestMessageId = (msgs: Message[]): string | null => {
    let newest: string | null = null;
    for (const m of msgs) {
      if (!m.id.startsWith("ln:")) {
        if (newest === null || m.id > newest) newest = m.id;
      }
    }
    return newest;
  };

  const loadDetail = async () => {
    const d = await api<{ ticket: Ticket; messages: Message[]; participants: Participant[]; audit: AuditEntry[]; conversationUnavailable?: boolean; hasMoreOlder?: boolean }>(`/api/support/ticket/${id}`);
    setTicket(d.ticket);
    setMessages(d.messages);
    setParticipants(d.participants);
    setAudit(d.audit);
    setConversationUnavailable(!!d.conversationUnavailable);
    setHasMoreOlder(!!d.hasMoreOlder);
    pollCursorRef.current = newestMessageId(d.messages);
    oldestDiscordIdRef.current = oldestDiscordMessageId(d.messages);
    return d.ticket;
  };

  const oldestDiscordMessageId = (msgs: Message[]): string | null => {
    let oldest: string | null = null;
    for (const m of msgs) {
      if (!m.id.startsWith("ln:")) {
        if (oldest === null || m.id < oldest) oldest = m.id;
      }
    }
    return oldest;
  };

  const loadOlder = async () => {
    if (loadingOlder || !oldestDiscordIdRef.current) return;
    setLoadingOlder(true);
    setStaffError(null);
    try {
      const beforeId = oldestDiscordIdRef.current;
      const d = await api<{ messages: Message[]; hasMoreOlder?: boolean; conversationUnavailable?: boolean }>(`/api/support/ticket/${id}?before=${encodeURIComponent(beforeId)}`);
      if (d.conversationUnavailable) setConversationUnavailable(true);
      setMessages((prev) => {
        if (!d.messages.length) return prev;
        const seen = new Set(prev.map((m) => m.id));
        const older = d.messages.filter((m) => !seen.has(m.id));
        return [...older, ...prev];
      });
      setHasMoreOlder(!!d.hasMoreOlder);
      oldestDiscordIdRef.current = oldestDiscordMessageId(d.messages) ?? oldestDiscordIdRef.current;
    } catch (e) {
      setStaffError((e as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await loadDetail();
        if (!active) return;
        setError(null);
        api<{ staff: unknown[] }>("/api/support/staff").then((r) => active && setStaff(r.staff as never)).catch(() => {});
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => { active = false; };
  }, [id]);

  // Realtime polling: new messages / status / priority / assignment appear here.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const after = pollCursorRef.current;
        const p = await api<{ messages: Message[]; ticket: Partial<Ticket> }>(`/api/support/poll?after=${after ? encodeURIComponent(after) : ""}&ticket=${id}`);
        if (p.messages.length) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = p.messages.filter((m) => !seen.has(m.id));
            if (!fresh.length) return prev;
            return [...prev, ...fresh];
          });
          pollCursorRef.current = newestMessageId([...p.messages]);
        }
        if (p.ticket) {
          setTicket((prev) => (prev ? { ...prev, ...p.ticket } : prev));
        }
      } catch { /* transient poll errors are fine */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [id]);

  const doMutation = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setStaffError(null);
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      await loadDetail();
    } catch (e) {
      setStaffError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !ticket) return <div className="s-error-panel">Could not load ticket: {error}</div>;
  if (!ticket) return <div className="s-loading"><span className="s-spinner" />Loading ticket…</div>;

  return (
    <div className="s-detail">
      <div className="s-thread">
        <div className="s-thread-head">
          <div>
            <h2 className="s-h1" style={{ fontSize: 18 }}>
              <span className="s-ticket-number">{ticket.public_number}</span> · {ticket.subject}
            </h2>
            <p className="s-muted">Created {fmtTime(ticket.created_at)} · Updated {fmtTime(ticket.last_activity_at)}</p>
          </div>
          <StatusPill s={ticket.status} />
          <PriorityPill p={ticket.priority} />
        </div>

        {staffError && <div className="s-error-panel">{staffError}</div>}

        {conversationUnavailable && (
          <div className="s-warn-panel">
            The Discord thread is currently unavailable, so the live conversation can't be loaded. Ticket metadata and internal notes are still shown; any undelivered replies are queued below.
          </div>
        )}

        <div className="s-thread-scroll">
          {hasMoreOlder && !conversationUnavailable && (
            <button className="s-btn s-btn-ghost s-load-older" disabled={loadingOlder} onClick={loadOlder}>
              {loadingOlder ? "Loading…" : "Load older messages"}
            </button>
          )}
          {messages.length === 0 && <div className="s-empty">No messages yet in this ticket.</div>}
          {messages.map((m) => (
            <MessageRow key={m.id} m={m} onRetry={(mid) => { doMutation(`/api/support/ticket/${id}/retry`, { outboxId: mid.startsWith("ln:") ? mid.slice(3) : null }); }} />
          ))}
        </div>

        <div className="s-replybox">
          <textarea
            className="s-textarea"
            placeholder="Reply to the user… (posted into the same Discord ticket thread)"
            value={reply}
            onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)}
          />
          <div className="s-reply-actions">
            <button className="s-btn" disabled={busy || !reply.trim()} onClick={() => { doMutation(`/api/support/ticket/${id}/reply`, { content: reply.trim() }); setReply(""); }}>
              {busy ? "Sending…" : "Send reply"}
            </button>
          </div>
        </div>

        <div className="s-replybox" style={{ marginTop: 6 }}>
          <textarea
            className="s-textarea-note"
            placeholder="Internal note (staff-only, never sent to Discord)…"
            value={note}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          />
          <div className="s-reply-actions">
            <button className="s-btn s-btn-warn" disabled={busy || !note.trim()} onClick={() => { doMutation(`/api/support/ticket/${id}/note`, { content: note.trim() }); setNote(""); }}>
              {busy ? "Saving…" : "Add internal note"}
            </button>
          </div>
        </div>
      </div>

      <aside className="s-info">
        <div className="s-info-section">
          <span className="s-info-label">User</span>
          <span className="s-info-value">
            {ticket.user_discord_username || "Unknown"}
            <br /><code>{ticket.user_discord_id}</code>
          </span>
        </div>

        <div className="s-info-section">
          <span className="s-info-label">Ticket info</span>
          <span className="s-info-value">
            Device: {ticket.device_model || "—"}<br />
            OpenMouse: {ticket.openmouse_version || "—"}<br />
            OS: {ticket.operating_system || "—"}<br />
            Firmware: {ticket.firmware_version || "—"}<br />
            Category: {ticket.category}
          </span>
        </div>

        <div className="s-info-section">
          <span className="s-info-label">Status</span>
          <div className="s-info-actions">
            {STATUSES.map((s) => (
              <button key={s} className={`s-btn s-btn-ghost s-btn-sm ${ticket.status === s ? "is-active" : ""}`} disabled={busy || ticket.status === s} onClick={() => doMutation(`/api/support/ticket/${id}/status`, { status: s })}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="s-info-section">
          <span className="s-info-label">Priority</span>
          <div className="s-info-actions">
            {PRIORITIES.map((p) => (
              <button key={p} className={`s-btn s-btn-ghost s-btn-sm ${ticket.priority === p ? "is-active" : ""}`} disabled={busy || ticket.priority === p} onClick={() => doMutation(`/api/support/ticket/${id}/priority`, { priority: p })}>
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="s-info-section">
          <span className="s-info-label">Assigned staff</span>
          <select
            className="s-select"
            style={{ width: "100%" }}
            value={ticket.assigned_to ?? ""}
            onChange={(e) => doMutation(`/api/support/ticket/${id}/assign`, { assigneeDiscordId: (e.target as HTMLSelectElement).value || null })}
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.discord_id} value={s.discord_id}>{s.display_name || s.discord_username || s.discord_id}</option>
            ))}
          </select>
        </div>

        {canManage && (
          <div className="s-info-section">
            <span className="s-info-label">Participants</span>
            <div className="s-info-value">
              {participants.length === 0 && <span className="s-note-row">No additional participants.</span>}
              {participants.map((p) => (
                <div key={p.discord_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                  <span>{p.discord_username || p.discord_id} <code style={{ fontSize: 11 }}>· {p.discord_id}</code></span>
                  <button className="s-btn s-btn-ghost s-btn-sm" onClick={() => doMutation(`/api/support/ticket/${id}/participants`, { action: "remove", discordId: p.discord_id })}>−</button>
                </div>
              ))}
              <AddParticipant id={id} onAdd={() => loadDetail()} />
            </div>
          </div>
        )}

        <div className="s-info-section">
          <span className="s-info-label">Discord thread</span>
          <span className="s-info-value">
            {ticket.discord_thread_id ? <code>{ticket.discord_thread_id}</code> : <span className="s-note-row">No thread linked.</span>}
            <div className="s-server-note">Staff replies appear in the same user-facing thread; the dashboard never creates a new one.</div>
          </span>
        </div>

        <div className="s-info-section">
          <span className="s-info-label">Audit log</span>
          <div className="s-audit" style={{ maxHeight: 260 }}>
            {audit.length === 0 && <span className="s-note-row">No events.</span>}
            {audit.map((a) => (
              <AuditRow key={a.id} entry={a} />
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function MessageRow({ m, onRetry }: { m: Message; onRetry?: (id: string) => void }) {
  const author = m.author_name || m.author_discord_id;
  const pending = m.delivered_to_discord === false;
  if (m.is_internal_note) {
    return (
      <div className="s-msg">
        <div className="s-avatar">🔒</div>
        <div className="s-msg-body">
          <div className="s-msg-meta">
            <span className="s-msg-author">{author} · <span className="s-note-tag">Internal note</span></span>
            <span className="s-msg-time">{fmtTime(m.created_at)}</span>
          </div>
          <div className="s-msg-bubble s-note">{m.content}</div>
        </div>
      </div>
    );
  }
  const isStaff = m.source === "dashboard" || m.message_type === "STAFF";
  return (
    <div className="s-msg">
      <div className="s-avatar">{isStaff ? "⚙" : "U"}</div>
      <div className="s-msg-body">
        <div className="s-msg-meta">
          <span className="s-msg-author">{author}</span>
          {isStaff && <span className="s-note-tag" style={{ color: "var(--s-adm-accent)" }}>Staff</span>}
          {pending && (
            <button className="s-note-tag s-pending-btn" onClick={() => onRetry?.(m.id)}>
              Not delivered — retry
            </button>
          )}
          <span className="s-msg-time">{fmtTime(m.created_at)}</span>
        </div>
        <div className={`s-msg-bubble ${isStaff ? "s-side" : ""} ${pending ? "s-pending" : ""}`}>{m.content || <em>Attachment only</em>}</div>
        {m.attachments?.length > 0 && (
          <div className="s-attach">{m.attachments.map((a) => (<a key={a.url} href={a.url} target="_blank" rel="noreferrer">{(a as { name?: string }).name || "attachment"}</a>))}</div>
        )}
      </div>
    </div>
  );
}

function AddParticipant({ id, onAdd }: { id: string; onAdd: () => void }) {
  const [discordId, setDiscordId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
      <input className="s-input" style={{ flex: 1, minWidth: 90 }} placeholder="Discord id" value={discordId} onInput={(e) => setDiscordId((e.target as HTMLInputElement).value)} />
      <input className="s-input" style={{ flex: 1, minWidth: 90 }} placeholder="Name (opt)" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      <button
        className="s-btn s-btn-ghost s-btn-sm"
        disabled={busy || !discordId}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`/api/support/ticket/${id}/participants`, { method: "POST", body: JSON.stringify({ action: "add", discordId: discordId.trim(), name: name.trim() }) });
            setDiscordId(""); setName(""); onAdd();
          } catch { /* handled implicitly */ } finally { setBusy(false); }
        }}
      >+ Add</button>
    </div>
  );
}

/* ---------- audit view ---------- */
function AuditView() {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api<{ audit: AuditEntry[] }>("/api/support/audit");
        if (active) setItems(d.audit);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => { active = false; };
  }, []);
  if (error && !items) return <div className="s-error-panel">Could not load audit log: {error}</div>;
  if (!items) return <div className="s-loading"><span className="s-spinner" />Loading audit log…</div>;
  return (
    <section className="s-card">
      <div className="s-card-head">
        <div>
          <p className="s-card-title">Audit log</p>
          <p className="s-card-sub">Staff actions &amp; ticket events</p>
        </div>
      </div>
      {items.length ? (
        <div className="s-audit" style={{ maxHeight: "none" }}>
          {items.map((a) => <AuditRow key={a.id} entry={a} />)}
        </div>
      ) : <div className="s-empty">No audit events.</div>}
    </section>
  );
}

/* ---------- audit API endpoint (server side add) ---------- */
/* Audit list is served by functions/api/support/audit.js, defined below. */

/* ---------- shell ---------- */
function Shell({ session }: { session: Session }) {
  const [route, setRoute] = useState<{ view: string; ticketId?: string }>({ view: "overview" });

  useEffect(() => {
    const parse = () => {
      const h = location.hash.replace(/^#\/?/, "");
      const [view, ticketId] = h.split("/");
      if (view === "tickets" && ticketId) setRoute({ view: "tickets", ticketId });
      else if (view === "audit") setRoute({ view: "audit" });
      else setRoute({ view: "overview" });
    };
    window.addEventListener("hashchange", parse);
    parse();
    return () => window.removeEventListener("hashchange", parse);
  }, []);

  const nav = (view: string) => (location.hash = `#/${view}`);
  const title = route.view === "tickets" && route.ticketId ? "Ticket detail" : route.view === "audit" ? "Audit log" : "Overview";

  return (
    <div className="s-shell">
      <aside className="s-sidebar">
        <div className="s-brand">
          <div className="s-brand-mark"><IcMouse /></div>
          <div>
            <div className="s-brand-name">OpenMouse-Support</div>
            <div className="s-brand-sub">Staff Dashboard</div>
          </div>
        </div>
        <nav className="s-nav">
          <div className="s-nav-label">Support</div>
          <div className={`s-nav-item ${route.view === "overview" ? "is-active" : ""}`} onClick={() => nav("overview")}><IcOverview />Overview</div>
          <div className={`s-nav-item ${route.view === "tickets" ? "is-active" : ""}`} onClick={() => nav("tickets")}><IcTickets />Tickets</div>
          <div className={`s-nav-item ${route.view === "audit" ? "is-active" : ""}`} onClick={() => nav("audit")}><IcAudit />Audit log</div>
        </nav>
        <div className="s-sidebar-user">
          <div className="s-user-row">
            <span className="s-user-name">{session.name}</span>
            <span className="s-user-role">{session.role}</span>
          </div>
          <button className="s-logout" onClick={() => fetch("/api/support/logout", { method: "POST" }).then(() => (location.href = "/support"))}>
            <IcLogout /> Sign out
          </button>
        </div>
      </aside>
      <main className="s-main">
        <div className="s-topbar">
          <div>
            <h1 className="s-h1">{title}</h1>
            <p className="s-muted">OpenMouse-Support · {session.discordId}</p>
          </div>
        </div>
        <div className="s-content">
          {route.view === "overview" && <OverviewView session={session} />}
          {route.view === "tickets" && !route.ticketId && <TicketsView session={session} />}
          {route.view === "tickets" && route.ticketId && <TicketDetailView id={route.ticketId} />}
          {route.view === "audit" && <AuditView />}
        </div>
      </main>
    </div>
  );
}

/* ---------- root ---------- */
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const s = await api<Session>("/api/support/me");
        setSession(s);
      } catch {
        setSession(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="s-root">
        <div className="s-loading"><span className="s-spinner" />Checking session…</div>
      </div>
    );
  }
  if (!session) return <div className="s-root"><Login /></div>;
  return <div className="s-root"><Shell session={session} /></div>;
}

createRoot(document.getElementById("support-admin-app")!).render(<App />);
