import "./supported.css";
import { MICE, STATUS, TABS, type Mouse, type Status } from "./supported-mice.ts";
import { fetchLiveData, mergeLiveMice, type LiveData } from "./supported-live.ts";

// ── Data ──────────────────────────────────────────────────────────────────
// Mouse/status data lives in ./supported-mice.ts (verified at build time by
// ./supported-mice.test.ts). Live request counts, new community requests, and
// registry-listed supported models are merged in at runtime from
// ./supported-live.ts.

// ── Theme ─────────────────────────────────────────────────────────────────
const THEME_KEY = "openmouse.theme";
type Theme = "light" | "dark";

function getTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const SUN_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
const MOON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
function themeIcon(t: Theme): string { return t === "dark" ? SUN_SVG : MOON_SVG; }

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  const btn = document.getElementById("theme-btn");
  if (btn) btn.innerHTML = themeIcon(theme);
}

// ── State ─────────────────────────────────────────────────────────────────
let activeFilter: Status | "all" = "all";
let searchQuery = "";
let mice: Mouse[] = MICE;

// ── Helpers ───────────────────────────────────────────────────────────────
function counts(): Record<string, number> {
  const c: Record<string, number> = { all: 0 };
  for (const k of Object.keys(STATUS)) c[k] = 0;
  for (const m of mice) { c[m.status]++; c.all++; }
  return c;
}

function visibleMice(): Mouse[] {
  return mice.filter(m => {
    const fOk = activeFilter === "all" || m.status === activeFilter;
    const q = searchQuery.toLowerCase();
    const sOk = !q || m.model.toLowerCase().includes(q) || m.brand.toLowerCase().includes(q) || m.note.toLowerCase().includes(q);
    return fOk && sOk;
  });
}

// ── Render ────────────────────────────────────────────────────────────────
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Root element missing");

applyTheme(getTheme());

applyTheme(getTheme());

const GH_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7A11.5 11.5 0 0 0 8.4 23c.6.1.8-.3.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C15.8 3.7 17 4 17 4c.6 1.5.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.8 5.4-5.5 5.7.4.4.8 1.1.8 2.2v4.3c0 .4.2.7.8.6A11.5 11.5 0 0 0 12 .7Z"/></svg>`;
const initialTheme = getTheme();

const STATUS_LEGEND: Array<[Status, string]> = [
  ["supported", "Confirmed working with a registered driver"],
  ["pr", "Pull request adding the driver is open"],
  ["quickwin", "Protocol implemented — only PID/config entry missing"],
  ["likely", "Driver probably covers it — needs hardware test"],
  ["driver", "No driver exists yet"],
  ["unknown", "Protocol not yet identified"],
  ["pending", "Live community request"],
];

app.innerHTML = `
  <header class="site-header">
    <a class="wordmark" href="/" aria-label="OpenMouse home">
      <img class="wordmark-logo" src="/logo.png" alt="" width="181" height="268">
      OpenMouse
    </a>
    <nav class="header-nav">
      <a class="nav-link" href="/demo.html">UI demo</a>
      <a class="nav-link nav-current" href="/supported.html" aria-current="page">Devices</a>
      <a class="nav-link" href="/contributors.html">Hall of Fame</a>
      <button class="theme-toggle" id="theme-btn" aria-label="Toggle theme">${themeIcon(initialTheme)}</button>
      <a class="github-link" href="https://github.com/OpenMouse-Project/openmouse" target="_blank" rel="noreferrer" aria-label="OpenMouse on GitHub">
        ${GH_SVG}
        GitHub
      </a>
    </nav>
  </header>

  <div class="page-head">
    <h1>Supported Devices</h1>
    <p class="page-sub">Which gaming mice work with OpenMouse — supported models, community requests, and driver status at a glance.</p>
  </div>

  <div class="search-bar">
    <div class="search-wrap">
      <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input class="search-input" type="search" id="s-input" placeholder="Search by brand, model, or protocol…" autocomplete="off" spellcheck="false">
    </div>
  </div>

  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <div class="sb-section">
        <div class="sb-heading">Legend</div>
        <ul class="sb-legend">
          ${STATUS_LEGEND.map(([key, desc]) => `
            <li>
              <span class="legend-dot status-${key}"></span>
              <span class="legend-label">${STATUS[key].label}</span>
              <span class="legend-desc">${desc}</span>
            </li>
          `).join("")}
        </ul>
      </div>
      <div class="sb-section">
        <div class="sb-heading">Brands</div>
        <div class="sb-stats" id="page-stats"></div>
        <ul class="sb-brands" id="sb-brands"></ul>
      </div>
    </aside>

    <main class="main-content">
      <div class="toolbar">
        <div class="ftabs" id="ftabs" role="tablist"></div>
        <div class="result-count" id="result-count"></div>
      </div>
      <div id="device-list"></div>
    </main>
  </div>

  <footer>
    <span>OpenMouse</span>
    <div class="footer-links">
      <a href="https://x.com/openmouseapp" target="_blank" rel="noreferrer">Follow on X</a>
      <a href="https://github.com/OpenMouse-Project/openmouse" target="_blank" rel="noreferrer">View source</a>
    </div>
  </footer>
`;

document.getElementById("theme-btn")?.addEventListener("click", () => {
  applyTheme(getTheme() === "dark" ? "light" : "dark");
});

document.getElementById("s-input")?.addEventListener("input", e => {
  searchQuery = (e.target as HTMLInputElement).value;
  renderList();
});

function renderTabs(): void {
  const c = counts();
  document.getElementById("ftabs")!.innerHTML = TABS.map(t =>
    `<button class="ftab${activeFilter === t.key ? " on" : ""}" data-key="${t.key}" role="tab" aria-selected="${activeFilter === t.key}">
      ${t.label}<span class="ftab-n">${c[t.key] ?? 0}</span>
    </button>`
  ).join("");
  document.getElementById("ftabs")!.querySelectorAll<HTMLButtonElement>(".ftab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.key as typeof activeFilter;
      renderTabs();
      renderList();
    });
  });
}

function renderStats(): void {
  const c = counts();
  const el = document.getElementById("page-stats");
  if (!el) return;
  const total = c.all;
  const supported = c.supported ?? 0;
  el.innerHTML = `<div class="sb-stat-row"><span class="sb-stat-num">${supported}</span><span class="sb-stat-label">supported · </span><span class="sb-stat-num">${total}</span><span class="sb-stat-label">total tracked</span></div>`;
}

function renderBrandIndex(): void {
  const el = document.getElementById("sb-brands");
  if (!el) return;
  const brands: Record<string, number> = {};
  for (const m of mice) brands[m.brand] = (brands[m.brand] || 0) + 1;
  const sorted = Object.keys(brands).sort((a, b) => brands[b] - brands[a]);
  el.innerHTML = sorted.map(b =>
    `<li><a href="#brand-${b.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}" class="sb-brand-link">${b}</a><span class="sb-brand-count">${brands[b]}</span></li>`
  ).join("");
}

function renderResultCount(): void {
  const data = visibleMice();
  const el = document.getElementById("result-count");
  if (el) el.textContent = `${data.length} device${data.length === 1 ? "" : "s"}`;
}

function renderList(): void {
  const data = visibleMice();
  const el = document.getElementById("device-list")!;

  renderResultCount();
  renderStats();
  renderBrandIndex();

  if (!data.length) {
    el.innerHTML = `<p class="no-results">No devices match your search.</p>`;
    return;
  }

  const groups: Record<string, Mouse[]> = {};
  for (const m of data) (groups[m.brand] = groups[m.brand] || []).push(m);

  const sortedBrands = Object.keys(groups).sort((a, b) => {
    const ra = groups[a].reduce((s, m) => s + m.req, 0);
    const rb = groups[b].reduce((s, m) => s + m.req, 0);
    return rb - ra || a.localeCompare(b);
  });

  el.innerHTML = sortedBrands.map(brand => {
    const items = groups[brand].sort((a, b) =>
      STATUS[a.status].order - STATUS[b.status].order || b.req - a.req,
    );
    const totalReq = items.reduce((s, m) => s + m.req, 0);

    const rows = items.map(m =>
      `<tr>
        <td><span class="status-badge status-${m.status}">${STATUS[m.status].label}</span></td>
        <td class="device-name">${m.model}</td>
        <td class="device-note">${m.note || "—"}</td>
        <td class="req-count${m.req >= 3 ? " hot" : ""}">${m.req > 0 ? m.req : "—"}</td>
      </tr>`
    ).join("");

    return `<div class="brand-group" id="brand-${brand.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}">
      <div class="brand-header">${brand}${totalReq > 0 ? ` <span class="brand-reqs">(${totalReq} request${totalReq === 1 ? "" : "s"})</span>` : ""}</div>
      <table class="device-table">
        <thead><tr><th>Status</th><th>Model</th><th>Notes</th><th style="text-align:right">Votes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join("");
}

renderTabs();
renderList();

// ── Live updates ──────────────────────────────────────────────────────────
async function refresh(): Promise<void> {
  let live: LiveData | null = null;
  try {
    live = await fetchLiveData();
  } catch {
    // Support catalog not configured or unreachable: keep the static table.
  }
  mice = mergeLiveMice(MICE, live);

  renderTabs();
  renderList();
}

void refresh();
setInterval(() => void refresh(), 60_000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refresh();
});
window.addEventListener("focus", () => void refresh());
