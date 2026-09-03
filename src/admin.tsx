import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

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
    <form onSubmit={submit} style={styles.loginCard}>
      <h1 style={styles.title}>OpenMouse Admin</h1>
      <input
        type="password"
        autoFocus
        placeholder="Password"
        value={password}
        onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
        style={styles.input}
      />
      <button type="submit" disabled={busy || !password} style={styles.button}>
        {busy ? "Checking…" : "Sign in"}
      </button>
      {error && <p style={styles.error}>{error}</p>}
    </form>
  );
}

function formatDay(day: string) {
  const d = new Date(day);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function Trend({ value }: { value: number | null }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <span style={{ ...styles.trend, color: up ? "#4ade80" : "#f87171" }}>
      {up ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/** Bar chart of daily views, hover-scrubbed with a lightweight tooltip. */
function DailyBarChart({ points }: { points: DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 760;
  const height = 200;
  const max = Math.max(1, ...points.map((p) => p.view_count));
  const barGap = 3;
  const barWidth = points.length > 0 ? width / points.length - barGap : 0;

  if (!points.length) return <p style={styles.muted}>No history yet.</p>;

  const active = hover !== null ? points[hover] : points[points.length - 1];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {active.view_count.toLocaleString()}
          <span style={{ ...styles.muted, marginLeft: 8, fontSize: 13 }}>views · {formatDay(active.day)}</span>
        </div>
        <div style={styles.muted}>peak concurrent {active.peak_concurrent}</div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        style={{ display: "block", overflow: "visible" }}
        onMouseLeave={() => setHover(null)}
      >
        {points.map((p, i) => {
          const barHeight = (p.view_count / max) * (height - 4);
          const x = i * (barWidth + barGap);
          const isActive = hover === i || (hover === null && i === points.length - 1);
          return (
            <rect
              key={p.day}
              x={x}
              y={height - barHeight}
              width={Math.max(1, barWidth)}
              height={barHeight}
              rx={2}
              fill={isActive ? "#a78bfa" : "#3f3f52"}
              onMouseEnter={() => setHover(i)}
            />
          );
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span style={styles.axisLabel}>{formatDay(points[0].day)}</span>
        <span style={styles.axisLabel}>{formatDay(points[points.length - 1].day)}</span>
      </div>
    </div>
  );
}

/** Average views by weekday, derived client-side from the daily series. */
function WeekdayBreakdown({ points }: { points: DailyPoint[] }) {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const totals = useMemo(() => {
    const sums = new Array(7).fill(0);
    const counts = new Array(7).fill(0);
    for (const p of points) {
      const d = new Date(p.day);
      if (Number.isNaN(d.getTime())) continue;
      const idx = d.getUTCDay();
      sums[idx] += p.view_count;
      counts[idx] += 1;
    }
    return sums.map((sum, i) => (counts[i] ? sum / counts[i] : 0));
  }, [points]);
  const max = Math.max(1, ...totals);

  if (!points.length) return <p style={styles.muted}>No history yet.</p>;

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 120 }}>
      {totals.map((value, i) => (
        <div key={labels[i]} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: "100%",
              height: Math.max(2, (value / max) * 90),
              background: "linear-gradient(180deg, #a78bfa, #7c3aed)",
              borderRadius: 4,
            }}
            title={`${labels[i]}: ${value.toFixed(1)} avg views`}
          />
          <span style={styles.axisLabel}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

function BarList({ rows, labelKey, valueKey }: { rows: CountRow[]; labelKey: "country" | "mouse_model"; valueKey: "view_count" | "uses" }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  const total = rows.reduce((sum, r) => sum + (Number(r[valueKey]) || 0), 0);
  if (!rows.length) return <p style={styles.muted}>No data yet.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((row, i) => {
        const value = Number(row[valueKey]) || 0;
        const share = total > 0 ? (value / total) * 100 : 0;
        return (
          <div key={String(row[labelKey])} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={styles.rank}>{i + 1}</span>
            <span style={{ width: 140, fontSize: 13, opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {row[labelKey] || "Unknown"}
            </span>
            <div style={{ flex: 1, background: "#1f1f27", borderRadius: 4, overflow: "hidden", height: 10 }}>
              <div style={{ width: `${(value / max) * 100}%`, background: "linear-gradient(90deg, #7c3aed, #a78bfa)", height: "100%" }} />
            </div>
            <span style={{ width: 76, textAlign: "right", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
              {value.toLocaleString()} <span style={styles.muted}>({share.toFixed(0)}%)</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<number>(90);
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

  // Trailing-week vs prior-week comparison, when there's enough history.
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
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>OpenMouse Admin</h1>
          <p style={styles.muted}>
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading…"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={styles.rangeSwitch}>
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => setRange(opt)}
                style={{ ...styles.rangeButton, ...(range === opt ? styles.rangeButtonActive : {}) }}
              >
                {opt}d
              </button>
            ))}
          </div>
          <button
            style={styles.linkButton}
            onClick={() => fetch("/api/admin/logout", { method: "POST" }).then(() => setError("session-expired"))}
          >
            Sign out
          </button>
        </div>
      </header>

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.statRow}>
        <div style={styles.stat}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={styles.liveDot} />
            <div style={styles.statValue}>{stats?.live ?? "—"}</div>
          </div>
          <div style={styles.muted}>Live right now</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statValue}>{stats?.allTimePeak ?? "—"}</div>
          <div style={styles.muted}>
            All-time peak{stats?.allTimePeakAt ? ` · ${new Date(stats.allTimePeakAt).toLocaleDateString()}` : ""}
          </div>
        </div>
        <div style={styles.stat}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <div style={styles.statValue}>{totalViews.toLocaleString()}</div>
            <Trend value={weekTrend} />
          </div>
          <div style={styles.muted}>Views (last {daily.length} days){weekTrend !== null ? " · vs prior week" : ""}</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statValue}>{avgDaily.toFixed(1)}</div>
          <div style={styles.muted}>Avg views / day</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statValue}>{peakDay?.view_count ?? "—"}</div>
          <div style={styles.muted}>Best day{peakDay ? ` · ${formatDay(peakDay.day)}` : ""}</div>
        </div>
      </div>

      <section style={styles.card}>
        <h2 style={styles.h2}>Daily views</h2>
        {daily.length > 0 ? <DailyBarChart points={daily} /> : <p style={styles.muted}>No history yet.</p>}
      </section>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <section style={{ ...styles.card, flex: "1 1 320px" }}>
          <h2 style={styles.h2}>Regions</h2>
          {topRegion && <p style={styles.muted}>Top: {topRegion.country ?? "Unknown"}</p>}
          <BarList rows={stats?.regions ?? []} labelKey="country" valueKey="view_count" />
        </section>
        <section style={{ ...styles.card, flex: "1 1 320px" }}>
          <h2 style={styles.h2}>Most used mice</h2>
          {topMouse && <p style={styles.muted}>Top: {topMouse.mouse_model ?? "Unknown"}</p>}
          <BarList rows={stats?.mice ?? []} labelKey="mouse_model" valueKey="uses" />
        </section>
        <section style={{ ...styles.card, flex: "1 1 320px" }}>
          <h2 style={styles.h2}>Traffic by weekday</h2>
          <WeekdayBreakdown points={daily} />
        </section>
      </div>
    </div>
  );
}

function Admin() {
  // We don't know whether we're already authenticated until /api/admin/stats
  // answers, so start by trying the dashboard; a 401 falls back to login.
  return <Dashboard />;
}

const styles: Record<string, any> = {
  page: {
    fontFamily: "'DM Sans', system-ui, sans-serif",
    background: "#0b0b0f",
    color: "#f4f4f5",
    minHeight: "100vh",
    padding: "32px 40px",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: 24,
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 },
  title: { fontSize: 22, fontWeight: 600, margin: 0 },
  h2: { fontSize: 15, fontWeight: 600, margin: "0 0 12px" },
  muted: { opacity: 0.6, fontSize: 13, margin: "2px 0 0" },
  error: { color: "#f87171", fontSize: 13 },
  card: { background: "#151519", border: "1px solid #232329", borderRadius: 12, padding: 20 },
  statRow: { display: "flex", gap: 16, flexWrap: "wrap" },
  stat: { background: "#151519", border: "1px solid #232329", borderRadius: 12, padding: 20, minWidth: 180, flex: "1 1 180px" },
  statValue: { fontSize: 30, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  trend: { fontSize: 13, fontWeight: 600 },
  liveDot: { width: 8, height: 8, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 8px #4ade80" },
  rank: { width: 16, fontSize: 11, opacity: 0.4, fontVariantNumeric: "tabular-nums" },
  axisLabel: { fontSize: 11, opacity: 0.5 },
  rangeSwitch: { display: "flex", gap: 4, background: "#151519", border: "1px solid #232329", borderRadius: 8, padding: 3 },
  rangeButton: {
    background: "transparent",
    border: "none",
    borderRadius: 6,
    padding: "6px 12px",
    color: "#a1a1aa",
    fontSize: 13,
    cursor: "pointer",
  },
  rangeButtonActive: { background: "#8b5cf6", color: "white" },
  loginCard: {
    fontFamily: "'DM Sans', system-ui, sans-serif",
    background: "#0b0b0f",
    color: "#f4f4f5",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "0 20%",
    boxSizing: "border-box",
  },
  input: {
    background: "#151519",
    border: "1px solid #232329",
    borderRadius: 8,
    padding: "10px 12px",
    color: "#f4f4f5",
    fontSize: 14,
    width: 280,
  },
  button: {
    background: "#8b5cf6",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    color: "white",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  linkButton: {
    background: "transparent",
    border: "none",
    color: "#a1a1aa",
    fontSize: 13,
    cursor: "pointer",
    textDecoration: "underline",
  },
};

createRoot(document.getElementById("admin-app")!).render(<Admin />);
