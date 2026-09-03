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

/* ---------- icons (inline, stroke-based) ---------- */

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
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
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
const IconGlobe = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" />
  </svg>
);
const IconLogout = () => (
  <svg width={14} height={14} {...iconProps}>
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

function DailyLineChart({ points }: { points: DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 940;
  const height = 200;
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
      <div className="adm-chart-value">
        {active.view_count.toLocaleString()}
        <span className="adm-muted">
          VIEWS · {formatDay(active.day).toUpperCase()} · PEAK CONCURRENT {active.peak_concurrent}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        style={{ display: "block", overflow: "visible", marginTop: 8 }}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke="#232326" strokeWidth={1} />
        <path d={areaPath} fill="rgba(95, 217, 138, 0.06)" stroke="none" />
        <path d={linePath} fill="none" stroke="#5fd98a" strokeWidth={1.5} />
        {coords.map(([x], i) => (
          <rect
            key={points[i].day}
            x={x - stepX / 2}
            y={0}
            width={Math.max(1, stepX)}
            height={height}
            fill="transparent"
            className="adm-bar-rect"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {coords.map(([x, y], i) =>
          i === activeIndex ? <circle key={`d-${points[i].day}`} cx={x} cy={y} r={2.5} fill="#5fd98a" /> : null,
        )}
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
                  style={{ background: `rgba(95, 217, 138, ${(0.12 + (cell.view_count / max) * 0.75).toFixed(2)})` }}
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

function DataTable({
  rows,
  labelKey,
  valueKey,
  nameHeader,
  valueHeader,
}: {
  rows: CountRow[];
  labelKey: "country" | "mouse_model";
  valueKey: "view_count" | "uses";
  nameHeader: string;
  valueHeader: string;
}) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  const total = rows.reduce((sum, r) => sum + (Number(r[valueKey]) || 0), 0);
  if (!rows.length) return <p className="adm-muted">No data yet.</p>;
  return (
    <table className="adm-table">
      <thead>
        <tr>
          <th></th>
          <th>{nameHeader}</th>
          <th className="is-num">{valueHeader}</th>
          <th className="is-num">Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const value = Number(row[valueKey]) || 0;
          const share = total > 0 ? (value / total) * 100 : 0;
          return (
            <tr key={String(row[labelKey])}>
              <td className="is-rank">{String(i + 1).padStart(2, "0")}</td>
              <td>
                <div className="adm-table-name">
                  <div className="adm-table-bar">
                    <div className="adm-table-bar-fill" style={{ width: `${(value / max) * 100}%` }} />
                  </div>
                  {row[labelKey] || "Unknown"}
                </div>
              </td>
              <td className="is-num">{value.toLocaleString()}</td>
              <td className="is-num">{share.toFixed(1)}%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------- stat tile ---------- */

function StatTile({
  icon,
  value,
  label,
  live,
  trend,
  accent,
}: {
  icon: any;
  value: any;
  label: string;
  live?: boolean;
  trend?: number | null;
  accent?: string;
}) {
  return (
    <div className="adm-stat" style={accent ? ({ "--adm-accent-color": accent } as any) : undefined}>
      <div className="adm-stat-top">
        <span className="adm-stat-label-top">
          {icon}
          {label}
        </span>
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
  const regions = stats?.regions ?? [];
  const mice = stats?.mice ?? [];

  const totalViews = useMemo(() => daily.reduce((sum, d) => sum + d.view_count, 0), [daily]);
  const avgDaily = daily.length ? totalViews / daily.length : 0;
  const medianDaily = useMemo(() => {
    if (!daily.length) return 0;
    const sorted = [...daily].map((d) => d.view_count).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }, [daily]);
  const peakDay = useMemo(
    () => daily.reduce<DailyPoint | null>((best, d) => (!best || d.view_count > best.view_count ? d : best), null),
    [daily],
  );
  const quietDay = useMemo(
    () => daily.reduce<DailyPoint | null>((worst, d) => (!worst || d.view_count < worst.view_count ? d : worst), null),
    [daily],
  );
  const bestWeekday = useMemo(() => {
    if (!daily.length) return null;
    const sums = new Array(7).fill(0);
    daily.forEach((d) => {
      const dt = new Date(d.day);
      if (!Number.isNaN(dt.getTime())) sums[dt.getUTCDay()] += d.view_count;
    });
    const bestIndex = sums.reduce((best, v, i) => (v > sums[best] ? i : best), 0);
    return { name: WEEKDAY_NAMES[bestIndex], total: sums[bestIndex] };
  }, [daily]);

  const weekTrend = useMemo(() => {
    if (daily.length < 14) return null;
    const last7 = daily.slice(-7).reduce((s, d) => s + d.view_count, 0);
    const prev7 = daily.slice(-14, -7).reduce((s, d) => s + d.view_count, 0);
    return pctChange(last7, prev7);
  }, [daily]);

  const regionTotal = regions.reduce((s, r) => s + (r.view_count ?? 0), 0);
  const mouseTotal = mice.reduce((s, r) => s + (r.uses ?? 0), 0);
  const concurrencyRatio = stats?.live != null && stats.allTimePeak ? (stats.live / stats.allTimePeak) * 100 : null;
  const trackedSince = daily.length ? formatDay(daily[0].day) : "—";

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
            <span className="adm-sf-dot" /> SESSION ACTIVE · 12H TTL
          </div>
        </div>
      </aside>

      <main className="adm-main">
        <div className="adm-topbar">
          <div>
            <h1 className="adm-h1">Overview</h1>
            <p className="adm-muted">{lastUpdated ? `UPDATED ${lastUpdated.toLocaleTimeString()}` : "LOADING…"}</p>
          </div>
          <div className="adm-topbar-right">
            <div className="adm-range-switch">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  className={`adm-range-btn ${range === opt ? "is-active" : ""}`}
                  onClick={() => setRange(opt)}
                >
                  {opt}D
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
            <StatTile icon={<IconPulse />} value={stats?.live ?? "—"} label="Live right now" live accent="#5fd98a" />
            <StatTile
              icon={<IconPeak />}
              value={stats?.allTimePeak ?? "—"}
              label={`All-time peak${stats?.allTimePeakAt ? ` · ${new Date(stats.allTimePeakAt).toLocaleDateString()}` : ""}`}
              accent="#5b9bd9"
            />
            <StatTile
              icon={<IconTrend />}
              value={totalViews.toLocaleString()}
              label={`Views · last ${daily.length}d`}
              trend={weekTrend}
              accent="#d9a95b"
            />
            <StatTile icon={<IconCalendar />} value={avgDaily.toFixed(1)} label="Avg views / day" accent="#5b9bd9" />
            <StatTile
              icon={<IconStar />}
              value={peakDay?.view_count ?? "—"}
              label={`Best day${peakDay ? ` · ${formatDay(peakDay.day)}` : ""}`}
              accent="#d9a95b"
            />
            <StatTile icon={<IconCalendar />} value={medianDaily.toFixed(0)} label="Median views / day" accent="#5b9bd9" />
            <StatTile
              icon={<IconRegions />}
              value={regions.length}
              label={`Regions tracked${topEntry(regions, "country") ? ` · top ${topEntry(regions, "country")}` : ""}`}
              accent="#5fd98a"
            />
            <StatTile
              icon={<IconDevices />}
              value={mice.length}
              label={`Mouse models seen${topEntry(mice, "mouse_model") ? ` · top ${topEntry(mice, "mouse_model")}` : ""}`}
              accent="#5fd98a"
            />
          </div>

          <section className="adm-card">
            <div className="adm-card-head">
              <div>
                <p className="adm-card-title">Daily views</p>
                <p className="adm-card-sub">Site visits per day, last {daily.length} days</p>
              </div>
            </div>
            <DailyLineChart points={daily} />
          </section>

          <div className="adm-row2">
            <section className="adm-card">
              <div className="adm-card-head">
                <div>
                  <p className="adm-card-title">Regions</p>
                  <p className="adm-card-sub">{regionTotal.toLocaleString()} views across {regions.length} regions</p>
                </div>
              </div>
              <DataTable rows={regions} labelKey="country" valueKey="view_count" nameHeader="Country" valueHeader="Views" />
            </section>
            <section className="adm-card">
              <div className="adm-card-head">
                <div>
                  <p className="adm-card-title">Most used mice</p>
                  <p className="adm-card-sub">{mouseTotal.toLocaleString()} connects across {mice.length} models</p>
                </div>
              </div>
              <DataTable rows={mice} labelKey="mouse_model" valueKey="uses" nameHeader="Model" valueHeader="Uses" />
            </section>
          </div>

          <div className="adm-row3">
            <section className="adm-card">
              <div className="adm-card-head">
                <div>
                  <p className="adm-card-title">Traffic by weekday</p>
                  <p className="adm-card-sub">Views per day, by week</p>
                </div>
              </div>
              <WeekdayHeatmap points={daily} />
            </section>
            <section className="adm-card">
              <div className="adm-card-head">
                <div>
                  <p className="adm-card-title">Session detail</p>
                  <p className="adm-card-sub">Derived from the current range</p>
                </div>
              </div>
              <div className="adm-kv-grid">
                <div className="adm-kv">
                  <div className="adm-kv-label">Tracked since</div>
                  <div className="adm-kv-value">{trackedSince}</div>
                </div>
                <div className="adm-kv">
                  <div className="adm-kv-label">Days tracked</div>
                  <div className="adm-kv-value">{daily.length}</div>
                </div>
                <div className="adm-kv">
                  <div className="adm-kv-label">Best weekday</div>
                  <div className="adm-kv-value">{bestWeekday?.name ?? "—"}</div>
                </div>
                <div className="adm-kv">
                  <div className="adm-kv-label">Quietest day</div>
                  <div className="adm-kv-value">{quietDay ? `${quietDay.view_count} · ${formatDay(quietDay.day)}` : "—"}</div>
                </div>
                <div className="adm-kv">
                  <div className="adm-kv-label">Live vs. peak</div>
                  <div className="adm-kv-value">{concurrencyRatio != null ? `${concurrencyRatio.toFixed(0)}%` : "—"}</div>
                </div>
                <div className="adm-kv">
                  <div className="adm-kv-label">7d trend</div>
                  <div className="adm-kv-value">{weekTrend != null ? `${weekTrend >= 0 ? "+" : ""}${weekTrend.toFixed(1)}%` : "—"}</div>
                </div>
              </div>
            </section>
            <section className="adm-card">
              <div className="adm-card-head">
                <div>
                  <p className="adm-card-title">Top region</p>
                  <p className="adm-card-sub">By share of tracked views</p>
                </div>
              </div>
              <TopShare row={regions[0]} labelKey="country" valueKey="view_count" total={regionTotal} icon={<IconGlobe />} />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

function topEntry(rows: CountRow[], labelKey: "country" | "mouse_model"): string | null {
  const value = rows[0]?.[labelKey];
  return typeof value === "string" ? value : null;
}

function TopShare({
  row,
  labelKey,
  valueKey,
  total,
  icon,
}: {
  row?: CountRow;
  labelKey: "country" | "mouse_model";
  valueKey: "view_count" | "uses";
  total: number;
  icon: any;
}) {
  if (!row) return <p className="adm-muted">No data yet.</p>;
  const value = Number(row[valueKey]) || 0;
  const share = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div className="adm-stat-icon" style={{ width: 36, height: 36 }}>
        {icon}
      </div>
      <div>
        <div className="adm-stat-value" style={{ fontSize: 20 }}>
          {row[labelKey]}
        </div>
        <div className="adm-stat-label">
          {value.toLocaleString()} views · {share.toFixed(1)}% of total
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
