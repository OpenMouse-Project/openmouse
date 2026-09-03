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

function formatDay(day: string) {
  const d = new Date(day);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/* ---------- icons (inline, stroke-based to match the sidebar's line-icon set) ---------- */

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const IconOverview = () => (
  <svg {...iconProps}>
    <path d="M3 12h4l3 8 4-16 3 8h4" />
  </svg>
);
const IconLive = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);
const IconRegions = () => (
  <svg {...iconProps}>
    <path d="M12 21c4-4.5 7-8.2 7-11.5A7 7 0 0 0 5 9.5C5 12.8 8 16.5 12 21Z" />
    <circle cx="12" cy="9.5" r="2.3" />
  </svg>
);
const IconDevices = () => (
  <svg {...iconProps}>
    <rect x="6" y="2" width="12" height="20" rx="6" />
    <line x1="12" y1="6" x2="12" y2="10" />
  </svg>
);
const IconSettings = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);
const IconMouse = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="7" y="3" width="10" height="18" rx="5" />
    <line x1="12" y1="7" x2="12" y2="11" />
  </svg>
);
const IconPulse = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="3" />
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
  </svg>
);
const IconPeak = () => (
  <svg {...iconProps}>
    <path d="M3 3v18h18" />
    <path d="M7 14l4-5 3 3 5-7" />
  </svg>
);
const IconTrend = () => (
  <svg {...iconProps}>
    <path d="M3 12h4l3 8 4-16 3 8h4" />
  </svg>
);
const IconCalendar = () => (
  <svg {...iconProps}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="16" y1="2" x2="16" y2="6" />
  </svg>
);
const IconStar = () => (
  <svg {...iconProps}>
    <path d="M12 2l2.9 6.6L22 9.3l-5 4.9 1.2 7.1L12 17.8l-6.2 3.5L7 14.2 2 9.3l7.1-.7Z" />
  </svg>
);
const IconLogout = () => (
  <svg width={15} height={15} {...iconProps}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

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
      <h1 className="adm-h1">OpenMouse Admin</h1>
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

/* ---------- charts ---------- */

function DailyBarChart({ points }: { points: DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 940;
  const height = 210;
  const gap = 4;
  const max = Math.max(1, ...points.map((p) => p.view_count));
  const barWidth = points.length > 0 ? width / points.length - gap : 0;

  if (!points.length) return <p className="adm-muted">No history yet.</p>;

  const activeIndex = hover ?? points.length - 1;
  const active = points[activeIndex];

  return (
    <div>
      <div className="adm-chart-value">
        {active.view_count.toLocaleString()}
        <span className="adm-muted">
          views · {formatDay(active.day)} · peak concurrent {active.peak_concurrent}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        style={{ display: "block", overflow: "visible", marginTop: 6 }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="admBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8fe0ac" />
            <stop offset="100%" stopColor="#3fae6a" />
          </linearGradient>
        </defs>
        <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke="#1c1c26" strokeWidth={1} />
        {points.map((p, i) => {
          const barHeight = (p.view_count / max) * (height - 8);
          const x = i * (barWidth + gap);
          const isActive = i === activeIndex;
          return (
            <rect
              key={p.day}
              className="adm-bar-rect"
              x={x}
              y={height - barHeight}
              width={Math.max(1, barWidth)}
              height={barHeight}
              rx={2.5}
              fill={isActive ? "url(#admBarGrad)" : "#1c1c26"}
              onMouseEnter={() => setHover(i)}
            />
          );
        })}
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
                <div
                  key={di}
                  className="adm-hm-cell"
                  title={`${formatDay(cell.day)}: ${cell.view_count} views`}
                  style={{ background: `rgba(105, 210, 141, ${(0.12 + (cell.view_count / max) * 0.75).toFixed(2)})` }}
                />
              ) : (
                <div key={di} className="adm-hm-cell" style={{ background: "transparent" }} />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="adm-hm-foot">
        <span />
        {WEEKDAY_LABELS.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

function BarList({ rows, labelKey, valueKey }: { rows: CountRow[]; labelKey: "country" | "mouse_model"; valueKey: "view_count" | "uses" }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  const total = rows.reduce((sum, r) => sum + (Number(r[valueKey]) || 0), 0);
  if (!rows.length) return <p className="adm-muted">No data yet.</p>;
  return (
    <div className="adm-bar-list">
      {rows.map((row, i) => {
        const value = Number(row[valueKey]) || 0;
        const share = total > 0 ? (value / total) * 100 : 0;
        return (
          <div className="adm-bar-item" key={String(row[labelKey])}>
            <span className="adm-rank">{String(i + 1).padStart(2, "0")}</span>
            <span className="adm-bl-label">{row[labelKey] || "Unknown"}</span>
            <div className="adm-bl-track">
              <div className="adm-bl-fill" style={{ width: `${(value / max) * 100}%` }} />
            </div>
            <span className="adm-bl-value">
              {value.toLocaleString()} <span className="adm-muted">{share.toFixed(0)}%</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- stat tile ---------- */

function StatTile({
  icon,
  value,
  label,
  live,
  trend,
}: {
  icon: any;
  value: any;
  label: string;
  live?: boolean;
  trend?: number | null;
}) {
  return (
    <div className="adm-stat">
      <div className="adm-stat-top">
        <div className="adm-stat-icon">{icon}</div>
        {trend != null && (
          <span className={`adm-pill ${trend >= 0 ? "is-up" : "is-down"}`}>
            {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="adm-stat-value">
        {live && <span className="adm-live-dot" />}
        {value}
      </div>
      <div className="adm-stat-label">{label}</div>
    </div>
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
    if (response.status === 401) {
      setError("session-expired");
      return;
    }
    if (!response.ok) {
      setError("Could not load stats.");
      return;
    }
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
  const totalViews = useMemo(() => daily.reduce((sum, d) => sum + d.view_count, 0), [daily]);
  const avgDaily = daily.length ? totalViews / daily.length : 0;
  const peakDay = useMemo(
    () => daily.reduce<DailyPoint | null>((best, d) => (!best || d.view_count > best.view_count ? d : best), null),
    [daily],
  );

  const weekTrend = useMemo(() => {
    if (daily.length < 14) return null;
    const last7 = daily.slice(-7).reduce((s, d) => s + d.view_count, 0);
    const prev7 = daily.slice(-14, -7).reduce((s, d) => s + d.view_count, 0);
    return pctChange(last7, prev7);
  }, [daily]);

  const topRegion = stats?.regions?.[0];
  const topMouse = stats?.mice?.[0];

  if (error === "session-expired") {
    return <LoginForm onLoggedIn={() => load(range)} />;
  }

  return (
    <div className="adm-root">
      <aside className="adm-sidebar">
        <div className="adm-brand">
          <div className="adm-brand-mark">
            <IconMouse />
          </div>
          <div>
            <div className="adm-brand-name">OpenMouse</div>
            <div className="adm-brand-sub">Admin</div>
          </div>
        </div>
        <nav className="adm-nav">
          <div className="adm-nav-label">Monitor</div>
          <div className="adm-nav-item is-active">
            <IconOverview />
            Overview
          </div>
          <div className="adm-nav-item">
            <IconLive />
            Live sessions
          </div>
          <div className="adm-nav-item">
            <IconRegions />
            Regions
          </div>
          <div className="adm-nav-item">
            <IconDevices />
            Devices
          </div>
          <div className="adm-nav-label">Manage</div>
          <div className="adm-nav-item">
            <IconSettings />
            Settings
          </div>
        </nav>
        <div className="adm-sidebar-foot">
          <div className="adm-sf-row">
            <span className="adm-sf-dot" /> Session active · 12h TTL
          </div>
        </div>
      </aside>

      <main className="adm-main">
        <div className="adm-topbar">
          <div>
            <h1 className="adm-h1">Overview</h1>
            <p className="adm-muted">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading…"}</p>
          </div>
          <div className="adm-topbar-right">
            <div className="adm-range-switch">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  className={`adm-range-btn ${range === opt ? "is-active" : ""}`}
                  onClick={() => setRange(opt)}
                >
                  {opt}d
                </button>
              ))}
            </div>
            <button
              className="adm-icon-btn"
              title="Sign out"
              onClick={() => fetch("/api/admin/logout", { method: "POST" }).then(() => setError("session-expired"))}
            >
              <IconLogout />
            </button>
          </div>
        </div>

        <div className="adm-content">
          {error && <p className="adm-login-error">{error}</p>}

          <div className="adm-stat-row">
            <StatTile icon={<IconPulse />} value={stats?.live ?? "—"} label="Live right now" live />
            <StatTile
              icon={<IconPeak />}
              value={stats?.allTimePeak ?? "—"}
              label={`All-time peak${stats?.allTimePeakAt ? ` · ${new Date(stats.allTimePeakAt).toLocaleDateString()}` : ""}`}
            />
            <StatTile
              icon={<IconTrend />}
              value={totalViews.toLocaleString()}
              label={`Views · last ${daily.length} days`}
              trend={weekTrend}
            />
            <StatTile icon={<IconCalendar />} value={avgDaily.toFixed(1)} label="Avg views / day" />
            <StatTile
              icon={<IconStar />}
              value={peakDay?.view_count ?? "—"}
              label={`Best day${peakDay ? ` · ${formatDay(peakDay.day)}` : ""}`}
            />
          </div>

          <section className="adm-card">
            <div className="adm-card-head">
              <div>
                <p className="adm-card-title">Daily views</p>
                <p className="adm-card-sub">Site visits per day, last {daily.length} days</p>
              </div>
            </div>
            <DailyBarChart points={daily} />
          </section>

          <div className="adm-row3">
            <section className="adm-card">
              <div className="adm-card-head">
                <div>
                  <p className="adm-card-title">Regions</p>
                  <p className="adm-card-sub">Top: {topRegion?.country ?? "—"}</p>
                </div>
              </div>
              <BarList rows={stats?.regions ?? []} labelKey="country" valueKey="view_count" />
            </section>
            <section className="adm-card">
              <div className="adm-card-head">
                <div>
                  <p className="adm-card-title">Most used mice</p>
                  <p className="adm-card-sub">Top: {topMouse?.mouse_model ?? "—"}</p>
                </div>
              </div>
              <BarList rows={stats?.mice ?? []} labelKey="mouse_model" valueKey="uses" />
            </section>
            <section className="adm-card">
              <div className="adm-card-head">
                <div>
                  <p className="adm-card-title">Traffic by weekday</p>
                  <p className="adm-card-sub">Views per day, by week</p>
                </div>
              </div>
              <WeekdayHeatmap points={daily} />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

function Admin() {
  // We don't know whether we're already authenticated until /api/admin/stats
  // answers, so start by trying the dashboard; a 401 falls back to login.
  return <Dashboard />;
}

createRoot(document.getElementById("admin-app")!).render(<Admin />);
