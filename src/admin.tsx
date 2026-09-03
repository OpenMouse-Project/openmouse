import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./admin.css";

type DailyPoint = { day: string; view_count: number; peak_concurrent: number };
type CountRow = { country?: string; mouse_model?: string; view_count?: number; uses?: number };
type Stats = {
  live: number | null;
  allTimePeak: number | null;
  allTimePeakAt: string | null;
  daily: DailyPoint[];
  regions: CountRow[];
  mice: CountRow[];
};

const LIVE_POLL_MS = 5000;
const RANGE_OPTIONS = [7, 30, 90] as const;
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatDay(day: string) {
  const d = new Date(day);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/* ---------- icons ---------- */
const iconProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const IconMouse = () => (<svg {...iconProps}><rect x="7" y="3" width="10" height="18" rx="5" /><line x1="12" y1="7" x2="12" y2="11" /></svg>);
const IconCalendar = () => (<svg {...iconProps}><rect x="3" y="4" width="18" height="17" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /></svg>);
const IconStar = () => (<svg {...iconProps}><path d="M12 2l2.9 6.6L22 9.3l-5 4.9 1.2 7.1L12 17.8l-6.2 3.5L7 14.2 2 9.3l7.1-.7Z" /></svg>);
const IconTrend = () => (<svg {...iconProps}><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>);
const IconLogout = () => (<svg width={14} height={14} {...iconProps}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>);

/* ---------- login ---------- */
function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? "Login failed.");
        return;
      }
      onLoggedIn();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="adm-login">
      <h1>OpenMouse Admin</h1>
      <input
        type="password"
        autoFocus
        placeholder="Password"
        value={password}
        onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
        className="adm-login-input"
      />
      <button type="submit" disabled={busy || !password} className="adm-login-button">
        {busy ? "Checking…" : "Sign in"}
      </button>
      {error && <p className="adm-login-error">{error}</p>}
    </form>
  );
}

/* ---------- chart ---------- */
function DailyChart({ points }: { points: DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const height = 168;
  const max = Math.max(1, ...points.map((p) => p.view_count));
  if (!points.length) return <p className="adm-muted">No history yet.</p>;

  const activeIndex = hover ?? points.length - 1;
  const active = points[activeIndex];
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((p, i) => [i * stepX, height - (p.view_count / max) * (height - 6)] as const);
  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <div>
      <div className="adm-chart-focus">
        {active.view_count.toLocaleString()}
        <span>views · {formatDay(active.day)} · peak concurrent {active.peak_concurrent}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: "block", overflow: "visible", marginTop: 8 }} onMouseLeave={() => setHover(null)}>
        <path d={areaPath} fill="rgba(129,140,248,0.10)" stroke="none" />
        <path d={linePath} fill="none" stroke="#818cf8" strokeWidth={1.75} />
        {coords.map(([x], i) => (
          <rect key={points[i].day} x={x - stepX / 2} y={0} width={Math.max(1, stepX)} height={height} fill="transparent" className="adm-bar-rect" onMouseEnter={() => setHover(i)} />
        ))}
        {coords.map(([x, y], i) => (i === activeIndex ? <circle key={`d-${points[i].day}`} cx={x} cy={y} r={2.5} fill="#818cf8" /> : null))}
      </svg>
      <div className="adm-axis-row">
        <span className="adm-axis-label">{formatDay(points[0].day).toUpperCase()}</span>
        <span className="adm-axis-label">{formatDay(points[points.length - 1].day).toUpperCase()}</span>
      </div>
    </div>
  );
}

/** GitHub-style intensity heatmap of views by weekday, one row per week. */
function WeekdayHeatmap({ points }: { points: DailyPoint[] }) {
  const weeks = useMemo(() => {
    const chunks: (DailyPoint | null)[][] = [];
    for (let i = 0; i < points.length; i += 7) {
      const slice = points.slice(i, i + 7);
      const cells: (DailyPoint | null)[] = new Array(7).fill(null);
      slice.forEach((p) => {
        const d = new Date(p.day);
        if (!Number.isNaN(d.getTime())) cells[d.getUTCDay()] = p;
      });
      chunks.push(cells);
    }
    return chunks;
  }, [points]);
  if (!points.length) return <p className="adm-muted">No history yet.</p>;
  const max = Math.max(1, ...points.map((p) => p.view_count));

  return (
    <div>
      <div className="adm-heatmap">
        {weeks.map((week, wi) => (
          <div className="adm-heatmap-row" key={wi}>
            <span className="adm-hm-label">W{wi + 1}</span>
            {week.map((cell, di) =>
              cell ? (
                <div key={di} className="adm-hm-cell" title={`${formatDay(cell.day)}: ${cell.view_count} views`} style={{ background: `rgba(57, 226, 160, ${(0.12 + (cell.view_count / max) * 0.7).toFixed(2)})` }} />
              ) : (
                <div key={di} className="adm-hm-cell" style={{ background: "transparent" }} />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="adm-hm-foot">
        <span />
        {WEEKDAY_LABELS.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </div>
  );
}

function DataTable({ rows, labelKey, valueKey, nameHeader, valueHeader }: {
  rows: CountRow[]; labelKey: "country" | "mouse_model"; valueKey: "view_count" | "uses"; nameHeader: string; valueHeader: string;
}) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  if (!rows.length) return <p className="adm-muted">No data yet.</p>;
  return (
    <table className="adm-table">
      <thead><tr><th></th><th>{nameHeader}</th><th className="is-num">{valueHeader}</th></tr></thead>
      <tbody>
        {rows.map((row, i) => {
          const value = Number(row[valueKey]) || 0;
          return (
            <tr key={String(row[labelKey])}>
              <td className="is-rank">{String(i + 1).padStart(2, "0")}</td>
              <td>
                <div className="adm-table-name">
                  <div className="adm-table-bar"><div className="adm-table-bar-fill" style={{ width: `${(value / max) * 100}%` }} /></div>
                  {row[labelKey] || "Unknown"}
                </div>
              </td>
              <td className="is-num">{value.toLocaleString()}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------- dashboard ---------- */
function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<number>(30);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = async (days: number) => {
    const response = await fetch(`/api/admin/stats?days=${days}`);
    if (response.status === 401) { setError("session-expired"); return; }
    if (!response.ok) { setError("Could not load stats."); return; }
    setStats(await response.json());
    setLastUpdated(new Date());
    setError(null);
  };

  useEffect(() => {
    load(range);
    const interval = setInterval(() => load(range), LIVE_POLL_MS);
    return () => clearInterval(interval);
  }, [range]);

  const daily = stats?.daily ?? [];
  const regions = stats?.regions ?? [];
  const mice = stats?.mice ?? [];

  const totalViews = useMemo(() => daily.reduce((sum, d) => sum + d.view_count, 0), [daily]);
  const avgDaily = daily.length ? totalViews / daily.length : 0;
  const peakDay = useMemo(() => daily.reduce<DailyPoint | null>((best, d) => (!best || d.view_count > best.view_count ? d : best), null), [daily]);
  const quietDay = useMemo(() => daily.reduce<DailyPoint | null>((worst, d) => (!worst || d.view_count < worst.view_count ? d : worst), null), [daily]);
  const bestWeekday = useMemo(() => {
    if (!daily.length) return null;
    const sums = new Array(7).fill(0);
    daily.forEach((d) => { const dt = new Date(d.day); if (!Number.isNaN(dt.getTime())) sums[dt.getUTCDay()] += d.view_count; });
    const bestIndex = sums.reduce((best, v, i) => (v > sums[best] ? i : best), 0);
    return WEEKDAY_NAMES[bestIndex];
  }, [daily]);
  const weekTrend = useMemo(() => {
    if (daily.length < 14) return null;
    const last7 = daily.slice(-7).reduce((s, d) => s + d.view_count, 0);
    const prev7 = daily.slice(-14, -7).reduce((s, d) => s + d.view_count, 0);
    return pctChange(last7, prev7);
  }, [daily]);

  const regionTotal = regions.reduce((s, r) => s + (r.view_count ?? 0), 0);
  const mouseTotal = mice.reduce((s, r) => s + (r.uses ?? 0), 0);
  const liveVal = stats?.live ?? 0;
  const peakVal = stats?.allTimePeak ?? 0;
  const concurrencyRatio = peakVal > 0 ? Math.min(100, (liveVal / peakVal) * 100) : 0;
  const trackedSince = daily.length ? formatDay(daily[0].day) : "—";

  if (error === "session-expired") return <LoginForm onLoggedIn={() => load(range)} />;

  return (
    <div className="adm-root">
      <div className="adm-topbar">
        <div className="adm-brand">
          <div className="adm-brand-mark"><IconMouse /></div>
          <div>
            <div className="adm-brand-name">OpenMouse Admin</div>
            <div className="adm-brand-sub">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading…"}</div>
          </div>
        </div>
        <div className="adm-topbar-right">
          <div className="adm-range-switch">
            {RANGE_OPTIONS.map((opt) => (
              <button key={opt} className={`adm-range-btn ${range === opt ? "is-active" : ""}`} onClick={() => setRange(opt)}>{opt}D</button>
            ))}
          </div>
          <button className="adm-icon-btn" title="Sign out" onClick={() => fetch("/api/admin/logout", { method: "POST" }).then(() => setError("session-expired"))}>
            <IconLogout />
          </button>
        </div>
      </div>

      <div className="adm-content">
        {error && <p className="adm-login-error">{error}</p>}

        <div className="adm-bento">
          <div className="adm-tile adm-live-tile a-live">
            <div className="adm-live-label"><span className="adm-pulse" />Live right now</div>
            <div className="adm-live-value">{stats?.live ?? "—"}</div>
            <div className="adm-live-sub">All-time peak <b>{stats?.allTimePeak ?? "—"}</b>{stats?.allTimePeakAt ? ` · ${new Date(stats.allTimePeakAt).toLocaleDateString()}` : ""}</div>
            <div className="adm-live-ring">
              <div className="adm-ring-track"><div className="adm-ring-fill" style={{ width: `${concurrencyRatio}%` }} /></div>
              <div className="adm-ring-label">{concurrencyRatio.toFixed(0)}% of peak</div>
            </div>
          </div>

          <div className="adm-tile adm-chart-tile a-chart">
            <div className="adm-chart-head">
              <p className="adm-chart-title">Daily views</p>
              <span className="adm-chart-sub">LAST {daily.length}D · AVG {avgDaily.toFixed(1)}</span>
            </div>
            <DailyChart points={daily} />
          </div>

          <div className="adm-tile adm-mini a-peak">
            <div className="adm-mini-label"><IconTrend />Views, {daily.length}d</div>
            <div className="adm-mini-value">{totalViews.toLocaleString()}</div>
            {weekTrend != null && (
              <span className={`adm-pill ${weekTrend >= 0 ? "is-up" : "is-down"}`}>{weekTrend >= 0 ? "▲" : "▼"} {Math.abs(weekTrend).toFixed(1)}%</span>
            )}
          </div>
          <div className="adm-tile adm-mini a-avg">
            <div className="adm-mini-label"><IconCalendar />Avg / day</div>
            <div className="adm-mini-value indigo">{avgDaily.toFixed(1)}</div>
            <div className="adm-mini-sub">median-adjacent</div>
          </div>
          <div className="adm-tile adm-mini a-best">
            <div className="adm-mini-label"><IconStar />Best day</div>
            <div className="adm-mini-value">{peakDay?.view_count ?? "—"}</div>
            <div className="adm-mini-sub">{peakDay ? formatDay(peakDay.day) : "—"}</div>
          </div>
          <div className="adm-tile adm-mini a-trend">
            <div className="adm-mini-label"><IconTrend />Best weekday</div>
            <div className="adm-mini-value indigo">{bestWeekday ?? "—"}</div>
            <div className="adm-mini-sub">by total views</div>
          </div>

          <div className="adm-tile adm-table-tile a-regions">
            <p className="adm-chart-title">Regions</p>
            <span className="adm-chart-sub">{regionTotal.toLocaleString()} views · {regions.length} regions</span>
            <DataTable rows={regions} labelKey="country" valueKey="view_count" nameHeader="Country" valueHeader="Views" />
          </div>
          <div className="adm-tile adm-table-tile a-mice">
            <p className="adm-chart-title">Most used mice</p>
            <span className="adm-chart-sub">{mouseTotal.toLocaleString()} connects · {mice.length} models</span>
            <DataTable rows={mice} labelKey="mouse_model" valueKey="uses" nameHeader="Model" valueHeader="Uses" />
          </div>

          <div className="adm-tile a-heat">
            <p className="adm-chart-title">Traffic by weekday</p>
            <span className="adm-chart-sub">Views per day, by week</span>
            <WeekdayHeatmap points={daily} />
          </div>
          <div className="adm-tile a-detail">
            <p className="adm-chart-title">Session detail</p>
            <span className="adm-chart-sub">Derived from the current range</span>
            <div className="adm-kv-grid">
              <div className="adm-kv"><div className="adm-kv-label">Tracked since</div><div className="adm-kv-value">{trackedSince}</div></div>
              <div className="adm-kv"><div className="adm-kv-label">Days tracked</div><div className="adm-kv-value">{daily.length}</div></div>
              <div className="adm-kv"><div className="adm-kv-label">Quietest day</div><div className="adm-kv-value">{quietDay ? `${quietDay.view_count} · ${formatDay(quietDay.day)}` : "—"}</div></div>
              <div className="adm-kv"><div className="adm-kv-label">7d trend</div><div className="adm-kv-value">{weekTrend != null ? `${weekTrend >= 0 ? "+" : ""}${weekTrend.toFixed(1)}%` : "—"}</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Admin() {
  // We don't know whether we're already authenticated until /api/admin/stats
  // answers, so start by trying the dashboard; a 401 falls back to login.
  return <Dashboard />;
}

createRoot(document.getElementById("admin-app")!).render(<Admin />);
