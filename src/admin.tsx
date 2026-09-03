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

function Sparkline({ points }: { points: DailyPoint[] }) {
  const width = 720;
  const height = 160;
  const max = Math.max(1, ...points.map((p) => p.view_count));
  const path = points
    .map((p, i) => {
      const x = points.length > 1 ? (i / (points.length - 1)) * width : 0;
      const y = height - (p.view_count / max) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: "block" }}>
      <path d={path} fill="none" stroke="#8b5cf6" strokeWidth={2} />
    </svg>
  );
}

function BarList({ rows, labelKey, valueKey }: { rows: CountRow[]; labelKey: "country" | "mouse_model"; valueKey: "view_count" | "uses" }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  if (!rows.length) return <p style={styles.muted}>No data yet.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((row) => {
        const value = Number(row[valueKey]) || 0;
        return (
          <div key={String(row[labelKey])} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 160, fontSize: 13, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {row[labelKey] || "Unknown"}
            </span>
            <div style={{ flex: 1, background: "#1f1f27", borderRadius: 4, overflow: "hidden", height: 10 }}>
              <div style={{ width: `${(value / max) * 100}%`, background: "#8b5cf6", height: "100%" }} />
            </div>
            <span style={{ width: 40, textAlign: "right", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{value}</span>
          </div>
        );
      })}
    </div>
  );
}

function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const response = await fetch("/api/admin/stats");
    if (response.status === 401) {
      setError("session-expired");
      return;
    }
    if (!response.ok) {
      setError("Could not load stats.");
      return;
    }
    setStats(await response.json());
    setError(null);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, LIVE_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const totalViews = useMemo(() => stats?.daily.reduce((sum, d) => sum + d.view_count, 0) ?? 0, [stats]);

  if (error === "session-expired") {
    return <LoginForm onLoggedIn={load} />;
  }

  return (
    <div style={styles.page}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={styles.title}>OpenMouse Admin</h1>
        <button
          style={styles.linkButton}
          onClick={() => fetch("/api/admin/logout", { method: "POST" }).then(() => setError("session-expired"))}
        >
          Sign out
        </button>
      </header>

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.statRow}>
        <div style={styles.stat}>
          <div style={styles.statValue}>{stats?.live ?? "—"}</div>
          <div style={styles.muted}>Live right now</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statValue}>{stats?.allTimePeak ?? "—"}</div>
          <div style={styles.muted}>
            All-time peak{stats?.allTimePeakAt ? ` · ${new Date(stats.allTimePeakAt).toLocaleString()}` : ""}
          </div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statValue}>{totalViews}</div>
          <div style={styles.muted}>Views (last {stats?.daily.length ?? 0} days)</div>
        </div>
      </div>

      <section style={styles.card}>
        <h2 style={styles.h2}>Daily views</h2>
        {stats && stats.daily.length > 0 ? <Sparkline points={stats.daily} /> : <p style={styles.muted}>No history yet.</p>}
      </section>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <section style={{ ...styles.card, flex: "1 1 320px" }}>
          <h2 style={styles.h2}>Regions</h2>
          <BarList rows={stats?.regions ?? []} labelKey="country" valueKey="view_count" />
        </section>
        <section style={{ ...styles.card, flex: "1 1 320px" }}>
          <h2 style={styles.h2}>Most used mice</h2>
          <BarList rows={stats?.mice ?? []} labelKey="mouse_model" valueKey="uses" />
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
  title: { fontSize: 22, fontWeight: 600, margin: 0 },
  h2: { fontSize: 15, fontWeight: 600, margin: "0 0 12px" },
  muted: { opacity: 0.6, fontSize: 13 },
  error: { color: "#f87171", fontSize: 13 },
  card: { background: "#151519", border: "1px solid #232329", borderRadius: 12, padding: 20 },
  statRow: { display: "flex", gap: 16, flexWrap: "wrap" },
  stat: { background: "#151519", border: "1px solid #232329", borderRadius: 12, padding: 20, minWidth: 200, flex: "1 1 200px" },
  statValue: { fontSize: 32, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
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
