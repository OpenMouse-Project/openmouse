import "./supported.css";
import { MICE, STATUS, TABS, type Mouse, type Status } from "./supported-mice.ts";
import { fetchLiveData, mergeLiveMice, type LiveData } from "./supported-live.ts";

// ── Data ──────────────────────────────────────────────────────────────────
// Mouse/status data lives in ./supported-mice.ts (verified at build time by
// ./supported-mice.test.ts). Live request counts, new community requests, and
// registry-listed supported models are merged in at runtime from
// ./supported-live.ts.

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

const GH_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7A11.5 11.5 0 0 0 8.4 23c.6.1.8-.3.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C15.8 3.7 17 4 17 4c.6 1.5.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.8 5.4-5.5 5.7.4.4.8 1.1.8 2.2v4.3c0 .4.2.7.8.6A11.5 11.5 0 0 0 12 .7Z"/></svg>`;

const heroSupported = MICE.filter(m => m.status === "supported").length;
const heroBrands = new Set(MICE.filter(m => m.status === "supported").map(m => m.brand)).size;

app.innerHTML = `
  <div class="landing-grid" aria-hidden="true"></div>
  <header class="site-header">
    <a class="wordmark" href="/" aria-label="OpenMouse home">
      <img class="wordmark-logo" src="/logo.png" alt="" width="181" height="268">
      OpenMouse
    </a>
    <div class="header-actions">
      <a class="demo-link" href="/demo.html">UI demo</a>
      <a class="demo-link nav-current" href="/supported.html" aria-current="page">Devices</a>
      <a class="demo-link" href="/contributors.html">Hall of Fame</a>
      <a class="github-link" href="https://github.com/OpenMouse-Project/openmouse" target="_blank" rel="noreferrer" aria-label="OpenMouse on GitHub">
        ${GH_SVG}
        GitHub <span aria-hidden="true">↗</span>
      </a>
    </div>
  </header>

  <main style="padding-bottom:6rem">
    <div class="devices-hero">
      <p class="eyebrow">DEVICE SUPPORT</p>
      <h1>Community<br><em>requests.</em></h1>
      <p class="lead">
        <strong id="hero-supported">${heroSupported} models</strong> confirmed working across <strong id="hero-brands">${heroBrands}</strong> brands.
        Community-requested devices are tracked below — filter by status or search by name.
      </p>
    </div>

    <div class="filter-bar">
      <input class="search-input" type="search" id="s-input" placeholder="Search model or brand…" autocomplete="off">
      <div class="ftabs" id="ftabs" role="tablist"></div>
    </div>

    <div class="stat-row" id="stat-row"></div>
    <div id="device-list"></div>
  </main>

  <footer>
    <span>OpenMouse · One place to manage supported mice.</span>
    <div class="footer-links">
      <a href="https://x.com/openmouseapp" target="_blank" rel="noreferrer">Follow @openmouseapp on X <span aria-hidden="true">↗</span></a>
      <a href="https://github.com/OpenMouse-Project/openmouse" target="_blank" rel="noreferrer">View source on GitHub <span aria-hidden="true">↗</span></a>
    </div>
  </footer>
`;

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
  document.getElementById("stat-row")!.innerHTML = (Object.keys(STATUS) as Status[]).map(k =>
    `<span class="stat-chip">
      <span class="sdot sdot-${k}" aria-hidden="true"></span>
      ${STATUS[k].label}: <strong>${c[k]}</strong>
    </span>`
  ).join("");
}

function renderList(): void {
  const data = visibleMice();
  const el = document.getElementById("device-list")!;

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
      `<div class="device-row">
        <div style="min-width:0">
          <div class="device-name">${m.model}</div>
          <div class="device-note">${m.note}</div>
        </div>
        <span class="spill spill-${m.status}">${STATUS[m.status].label}</span>
        ${m.req > 0 ? `<span class="req-n${m.req >= 3 ? " hot" : ""}">${m.req}&thinsp;req</span>` : ""}
      </div>`,
    ).join("");

    return `<div class="brand-grp">
      <div class="brand-lbl">${brand} <span class="brand-reqs">${totalReq} request${totalReq === 1 ? "" : "s"}</span></div>
      <div class="device-card">${rows}</div>
    </div>`;
  }).join("");
}

renderTabs();
renderStats();
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

  const supported = mice.filter(m => m.status === "supported");
  const heroSupportedEl = document.getElementById("hero-supported");
  const heroBrandsEl = document.getElementById("hero-brands");
  if (heroSupportedEl) heroSupportedEl.textContent = String(supported.length);
  if (heroBrandsEl) heroBrandsEl.textContent = String(new Set(supported.map(m => m.brand)).size);

  renderTabs();
  renderStats();
  renderList();
}

void refresh();
setInterval(() => void refresh(), 60_000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refresh();
});
window.addEventListener("focus", () => void refresh());
