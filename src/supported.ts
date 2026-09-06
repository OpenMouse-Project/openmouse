import "./supported.css";
import { mountOfflineBanner } from "./offline-banner";
import { registerServiceWorker } from "./register-sw";
import { MICE, STATUS, type Mouse, type Status } from "./supported-mice.ts";
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
const activeTags = new Set<Status>();
let activeBrand: string | null = null;
let searchQuery = "";
let brandQuery = "";
let tagsQuery = "";
let mice: Mouse[] = MICE;

// When live data lands while a panel is open, defer that panel's rebuild
// until it closes so focus and scroll position survive the refresh.
let brandDirty = false;
let tagsDirty = false;

// ── Collapsed brand groups ───────────────────────────────────────────────
const COLLAPSED_KEY = "openmouse.collapsedBrands";

function getCollapsedBrands(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function setCollapsedBrands(brands: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...brands]));
  } catch {
    // localStorage unavailable (private mode, etc.); collapse state just won't persist.
  }
}

function toggleBrandCollapsed(brand: string): void {
  const collapsed = getCollapsedBrands();
  if (collapsed.has(brand)) collapsed.delete(brand);
  else collapsed.add(brand);
  setCollapsedBrands(collapsed);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function counts(): Record<string, number> {
  const c: Record<string, number> = { all: 0 };
  for (const k of Object.keys(STATUS)) c[k] = 0;
  for (const m of mice) { c[m.status]++; c.all++; }
  return c;
}

function brandTotals(): Array<{ brand: string; count: number }> {
  const totals: Record<string, number> = {};
  for (const m of mice) totals[m.brand] = (totals[m.brand] || 0) + 1;
  return Object.keys(totals)
    .map((brand) => ({ brand, count: totals[brand] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
}

function brandSlug(brand: string): string {
  return brand.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function visibleMice(): Mouse[] {
  return mice.filter(m => {
    const tOk = activeTags.size === 0 || activeTags.has(m.status);
    const bOk = activeBrand === null || m.brand === activeBrand;
    const q = searchQuery.toLowerCase();
    const sOk = !q || m.model.toLowerCase().includes(q) || m.brand.toLowerCase().includes(q) || m.note.toLowerCase().includes(q);
    return tOk && bOk && sOk;
  });
}

// ── Render ────────────────────────────────────────────────────────────────
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Root element missing");

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
  ["bridge", "Not compatible with WebHID — needs the OpenMouse Bridge companion"],
  ["pending", "Live community request"],
];

const STATUS_DOT: Record<Status, string> = {
  supported: "var(--st-supported)",
  pr: "var(--st-pr)",
  quickwin: "var(--st-quickwin)",
  likely: "var(--st-likely)",
  driver: "var(--st-driver)",
  unknown: "var(--st-unknown)",
  bridge: "var(--st-bridge)",
  pending: "var(--st-pending)",
};

app.innerHTML = `
  <header class="site-header">
    <div class="page-wrap">
      <a class="wordmark" href="/" aria-label="OpenMouse home">
        <img class="wordmark-logo" src="/logo.png" alt="" width="181" height="268">
        OpenMouse
      </a>
      <nav class="header-nav">
        <div class="nav-links">
          <a class="nav-link" href="https://docs.openmouse.app">Contribute</a>
          <a class="nav-link" href="/donate.html">Support</a>
        </div>
        <div class="header-actions">
          <button class="theme-toggle" id="theme-btn" aria-label="Toggle theme">${themeIcon(initialTheme)}</button>
          <a class="github-link" href="https://github.com/OpenMouse-Project/openmouse" target="_blank" rel="noreferrer" aria-label="OpenMouse on GitHub">
            ${GH_SVG}
            <span>GitHub</span>
          </a>
        </div>
      </nav>
    </div>
  </header>

  <div class="page-wrap">
    <div class="page-head">
      <div class="page-kicker">Device catalog</div>
      <h1>Supported Devices</h1>
      <p class="page-sub">Which gaming mice work with OpenMouse — supported models, community requests, and driver status at a glance.</p>
      <p class="page-stats" id="page-stats"></p>
    </div>

    <div class="toolbar">
      <div class="dd" id="dd-brands">
        <button type="button" class="dd-trigger" id="brands-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="dd-label" id="brands-label">All brands</span><span class="chev">▾</span>
        </button>
        <div class="dd-panel" role="listbox" aria-label="Filter by brand">
          <div class="dd-search"><input type="search" id="brands-search" placeholder="Search brands…" aria-label="Search brands" autocomplete="off" spellcheck="false"></div>
          <div class="dd-list" id="brands-list"></div>
        </div>
      </div>
      <div class="dd" id="dd-tags">
        <button type="button" class="dd-trigger" id="tags-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="dd-label" id="tags-label">All tags</span><span class="pill" id="tags-pill" hidden></span><span class="chev">▾</span>
        </button>
        <div class="dd-panel" role="listbox" aria-label="Filter by tag" aria-multiselectable="true">
          <div class="dd-search"><input type="search" id="tags-search" placeholder="Search tags…" aria-label="Search tags" autocomplete="off" spellcheck="false"></div>
          <div class="dd-list" id="tags-list"></div>
        </div>
      </div>
      <div class="search-wrap">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input class="search-input" type="search" id="s-input" placeholder="Search by brand, model, or protocol…" autocomplete="off" spellcheck="false">
      </div>
      <div class="result-count" id="result-count"></div>
    </div>

    <details class="tag-legend" open>
      <summary>What do the tags mean?</summary>
      <ul class="tag-legend-list">
        ${STATUS_LEGEND.map(([key, tip]) => `
          <li><span class="dot" style="background:${STATUS_DOT[key]}"></span><strong>${STATUS[key].label}</strong> — ${tip}</li>`).join("")}
      </ul>
    </details>

    <main class="main-content">
      <div id="device-list"></div>
    </main>

    <footer>
      <span>OpenMouse</span>
      <div class="footer-links">
        <a href="https://x.com/openmouseapp" target="_blank" rel="noreferrer">Follow on X</a>
        <a href="https://github.com/OpenMouse-Project/openmouse" target="_blank" rel="noreferrer">View source</a>
      </div>
    </footer>
  </div>
`;

// ── Tag tooltips: one bubble on <body>, positioned with fixed coords so
// it renders over the dropdown instead of clipping at the panel edge. ────
let tagTip: HTMLDivElement | null = null;
function getTagTip(): HTMLDivElement {
  if (!tagTip) {
    tagTip = document.createElement("div");
    tagTip.className = "tag-tip";
    tagTip.hidden = true;
    document.body.appendChild(tagTip);
  }
  return tagTip;
}
function showTagTip(anchor: HTMLElement, text: string): void {
  if (window.matchMedia("(max-width: 640px)").matches) return;
  const tip = getTagTip();
  tip.textContent = text;
  tip.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let left = r.right + 10;
  if (left + w > window.innerWidth - 8) left = r.left - w - 10;
  if (left < 8) left = 8;
  const top = Math.max(8, Math.min(r.top + r.height / 2 - h / 2, window.innerHeight - h - 8));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
function hideTagTip(): void {
  if (tagTip) tagTip.hidden = true;
}

function closeDropdowns(): void {
  hideTagTip();
  document.querySelectorAll(".dd.open").forEach((d) => {
    d.classList.remove("open");
    if (d.id === "dd-brands") {
      document.getElementById("brands-trigger")?.setAttribute("aria-expanded", "false");
      if (brandDirty) { brandDirty = false; fillBrands(); }
    } else if (d.id === "dd-tags") {
      document.getElementById("tags-trigger")?.setAttribute("aria-expanded", "false");
      if (tagsDirty) { tagsDirty = false; fillTags(); }
    }
  });
}

document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest(".dd")) closeDropdowns();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDropdowns();
});

function toggleDropdown(id: string, triggerId: string): void {
  const dd = document.getElementById(id);
  if (!dd) return;
  const wasOpen = dd.classList.contains("open");
  closeDropdowns();
  dd.classList.toggle("open", !wasOpen);
  document.getElementById(triggerId)?.setAttribute("aria-expanded", String(!wasOpen));
  if (!wasOpen) dd.querySelector<HTMLInputElement>(".dd-search input")?.focus();
}

// ── Brands dropdown (option B: filter the page) ───────────────────────────
function fillBrands(): void {
  const dd = document.getElementById("dd-brands");
  const list = document.getElementById("brands-list");
  const label = document.getElementById("brands-label");
  if (!dd || !list || !label) return;
  if (dd.classList.contains("open")) { brandDirty = true; return; }

  label.textContent = activeBrand ?? "All brands";
  const q = brandQuery.toLowerCase();
  const rows: string[] = [];
  rows.push(`
    <button type="button" class="opt${activeBrand === null ? " is-selected" : ""}" data-brand="" role="option" aria-selected="${activeBrand === null}">
      <span class="dot${activeBrand === null ? " on" : ""}"></span>
      <span class="copy"><strong>All brands</strong><small>Show everything</small></span>
      <span class="count">${mice.length}</span>
    </button>`);
  for (const { brand, count } of brandTotals()) {
    if (q && !brand.toLowerCase().includes(q)) continue;
    const selected = activeBrand === brand;
    rows.push(`
      <button type="button" class="opt${selected ? " is-selected" : ""}" data-brand="${brand}" role="option" aria-selected="${selected}">
        <span class="dot${selected ? " on" : ""}"></span>
        <span class="copy"><strong>${brand}</strong><small>Brand</small></span>
        <span class="count">${count}</span>
      </button>`);
  }
  const bst = list.scrollTop;
  list.innerHTML = rows.length > 1 ? rows.join("") : `<p class="no-results">No brands match.</p>`;
  list.scrollTop = bst;
  list.querySelectorAll<HTMLButtonElement>(".opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const picked = btn.dataset.brand || null;
      activeBrand = picked;
      brandQuery = "";
      const search = document.getElementById("brands-search") as HTMLInputElement | null;
      if (search) search.value = "";
      closeDropdowns();
      fillBrands();
      renderList();
    });
  });
}

// ── Tags dropdown (multi-select, tooltips carry the old legend copy) ──────
function fillTags(): void {
  const dd = document.getElementById("dd-tags");
  const list = document.getElementById("tags-list");
  const label = document.getElementById("tags-label");
  const pill = document.getElementById("tags-pill");
  if (!dd || !list || !label || !pill) return;
  if (dd.classList.contains("open")) { tagsDirty = true; return; }

  label.textContent = activeTags.size === 0 ? "All tags" : "Tags";
  pill.hidden = activeTags.size === 0;
  pill.textContent = activeTags.size === 0 ? "" : String(activeTags.size);

  const q = tagsQuery.toLowerCase();
  const rows: string[] = [];
  for (const [key, tip] of STATUS_LEGEND) {
    if (q && !STATUS[key].label.toLowerCase().includes(q)) continue;
    const on = activeTags.has(key);
    rows.push(`
      <button type="button" class="opt${on ? " is-selected" : ""}" data-tag="${key}" data-tip="${tip}" role="option" aria-selected="${on}">
        <span class="dot" style="background:${STATUS_DOT[key]}"></span>
        <span class="copy"><strong>${STATUS[key].label}</strong><small>Tag</small></span>
        <span class="check">${on ? "✓" : ""}</span>
      </button>`);
  }
  const st = list.scrollTop;
  list.innerHTML = rows.length > 0 ? rows.join("") : `<p class="no-results">No tags match.</p>`;
  list.scrollTop = st;
  list.querySelectorAll<HTMLButtonElement>(".opt").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.tag as Status;
      if (activeTags.has(key)) activeTags.delete(key);
      else activeTags.add(key);
      // Rebuild now (not via the dirty flag) so the check paints
      // while the panel stays open for multi-select.
      const dd = document.getElementById("dd-tags");
      const wasOpen = dd?.classList.contains("open") ?? false;
      tagsDirty = false;
      dd?.classList.remove("open");
      fillTags();
      if (wasOpen) {
        dd?.classList.add("open");
        dd?.querySelector<HTMLElement>(`.opt[data-tag="${key}"]`)?.focus();
      }
      renderList();
    });
  });
}

function renderStats(): void {
  const c = counts();
  const el = document.getElementById("page-stats");
  if (!el) return;
  el.innerHTML = `<strong>${c.supported ?? 0}</strong> supported · <strong>${c.all}</strong> total tracked`;
}

function renderResultCount(): void {
  const data = visibleMice();
  const el = document.getElementById("result-count");
  if (el) el.textContent = `${data.length} device${data.length === 1 ? "" : "s"}`;
}

function clearAllFilters(): void {
  activeTags.clear();
  activeBrand = null;
  searchQuery = "";
  brandQuery = "";
  tagsQuery = "";
  const sInput = document.getElementById("s-input") as HTMLInputElement | null;
  if (sInput) sInput.value = "";
  const bSearch = document.getElementById("brands-search") as HTMLInputElement | null;
  if (bSearch) bSearch.value = "";
  const tSearch = document.getElementById("tags-search") as HTMLInputElement | null;
  if (tSearch) tSearch.value = "";
  fillBrands();
  fillTags();
  renderList();
}

function renderList(): void {
  const data = visibleMice();
  const el = document.getElementById("device-list")!;

  renderResultCount();
  renderStats();

  if (!data.length) {
    el.innerHTML = `<div class="no-results">
      <p>No devices match these filters.</p>
      <button type="button" class="clear-filters" id="clear-filters">Clear brand and tag filters</button>
    </div>`;
    document.getElementById("clear-filters")?.addEventListener("click", clearAllFilters);
    return;
  }

  const groups: Record<string, Mouse[]> = {};
  for (const m of data) (groups[m.brand] = groups[m.brand] || []).push(m);

  const sortedBrands = Object.keys(groups).sort((a, b) => {
    const ra = groups[a].reduce((s, m) => s + m.req, 0);
    const rb = groups[b].reduce((s, m) => s + m.req, 0);
    return rb - ra || a.localeCompare(b);
  });

  const collapsed = getCollapsedBrands();

  el.innerHTML = sortedBrands.map(brand => {
    const items = groups[brand].sort((a, b) =>
      STATUS[a.status].order - STATUS[b.status].order || b.req - a.req,
    );
    const totalReq = items.reduce((s, m) => s + m.req, 0);
    const isCollapsed = collapsed.has(brand);

    const rows = items.map(m =>
      `<tr>
        <td><span class="status-badge status-${m.status}">${STATUS[m.status].label}</span></td>
        <td class="device-name">${m.model}</td>
        <td class="device-note">${m.note || "—"}</td>
        <td class="req-count${m.req >= 3 ? " hot" : ""}">${m.req > 0 ? m.req : "—"}</td>
      </tr>`
    ).join("");

    return `<div class="brand-group${isCollapsed ? " collapsed" : ""}" id="brand-${brandSlug(brand)}" data-brand="${brand.replace(/"/g, "&quot;")}">
      <button type="button" class="brand-header" aria-expanded="${!isCollapsed}">
        <svg class="brand-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        <span>${brand}</span>
        <span class="brand-count-total">${items.length}</span>
        ${totalReq > 0 ? `<span class="brand-reqs">(${totalReq} request${totalReq === 1 ? "" : "s"})</span>` : ""}
      </button>
      <table class="device-table">
        <thead><tr><th>Status</th><th>Model</th><th>Notes</th><th style="text-align:right">Votes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join("");

  el.querySelectorAll<HTMLButtonElement>(".brand-header").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = btn.closest<HTMLElement>(".brand-group");
      const brand = group?.dataset.brand;
      if (!brand) return;
      const nowCollapsed = group.classList.toggle("collapsed");
      btn.setAttribute("aria-expanded", String(!nowCollapsed));
      toggleBrandCollapsed(brand);
    });
  });
}

// ── Wiring ────────────────────────────────────────────────────────────────
document.getElementById("theme-btn")?.addEventListener("click", () => {
  applyTheme(getTheme() === "dark" ? "light" : "dark");
});

document.getElementById("s-input")?.addEventListener("input", e => {
  searchQuery = (e.target as HTMLInputElement).value;
  renderList();
});

document.getElementById("brands-trigger")?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleDropdown("dd-brands", "brands-trigger");
});
document.getElementById("tags-trigger")?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleDropdown("dd-tags", "tags-trigger");
});
document.getElementById("brands-search")?.addEventListener("input", e => {
  brandQuery = (e.target as HTMLInputElement).value;
  brandDirty = false;
  // Rebuild the open list without touching the focused input.
  const dd = document.getElementById("dd-brands");
  const wasOpen = dd?.classList.contains("open") ?? false;
  dd?.classList.remove("open");
  fillBrands();
  if (wasOpen) dd?.classList.add("open");
});
document.getElementById("tags-search")?.addEventListener("input", e => {
  tagsQuery = (e.target as HTMLInputElement).value;
  tagsDirty = false;
  const dd = document.getElementById("dd-tags");
  const wasOpen = dd?.classList.contains("open") ?? false;
  dd?.classList.remove("open");
  fillTags();
  if (wasOpen) dd?.classList.add("open");
});

const tagsList = document.getElementById("tags-list");
tagsList?.addEventListener("mouseover", (e) => {
  const opt = (e.target as HTMLElement).closest?.(".opt[data-tip]") as HTMLElement | null;
  if (!opt) { hideTagTip(); return; }
  showTagTip(opt, opt.dataset.tip || "");
});
tagsList?.addEventListener("mouseout", (e) => {
  const to = (e.relatedTarget as HTMLElement | null)?.closest?.(".opt[data-tip]");
  if (!to) hideTagTip();
});
tagsList?.addEventListener("focusin", (e) => {
  const opt = (e.target as HTMLElement).closest?.(".opt[data-tip]") as HTMLElement | null;
  if (opt) showTagTip(opt, opt.dataset.tip || "");
});
tagsList?.addEventListener("focusout", hideTagTip);
tagsList?.addEventListener("scroll", hideTagTip);
window.addEventListener("resize", hideTagTip);

fillBrands();
fillTags();
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

  fillBrands();
  fillTags();
  renderList();
}

void refresh();
setInterval(() => void refresh(), 60_000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refresh();
});
window.addEventListener("focus", () => void refresh());

registerServiceWorker();
mountOfflineBanner();
