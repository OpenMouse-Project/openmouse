import { WLMOUSE_PRODUCTS } from "@openmouse/protocol/drivers/vendors";
import { LAMZU_PRODUCTS } from "@openmouse/protocol/lamzu";
import { KEYCHRON_PRODUCTS } from "@openmouse/protocol/keychron";
import { ORBITAL_DEVICES } from "@openmouse/protocol/orbital";
import { FANTECH_PRODUCTS } from "@openmouse/protocol/fantech";

import { MICE, type Mouse } from "./supported-mice.ts";
import { listSupportRequests, type SupportRequest } from "./support-requests.ts";

/**
 * Realtime inputs for the supported-devices page:
 *
 *  1. Request counts: the Supabase support catalog is fetched and overlaid on
 *     matching table rows, and catalog rows no one has tracked yet are shown as
 *     `pending` requests.
 *  2. Supported list: models named by the `@openmouse/protocol` product
 *     registries are added as `supported` rows automatically, so a model the
 *     drivers cover can never be missing from the page.
 *
 * Both degrade gracefully: no configuration, a failed fetch, or an empty
 * catalog falls back to the static table.
 */

export function normalizeKey(part: string): string {
  return part.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

/**
 * Canonical display names come from the static table, keyed by their
 * normalized form, so any casing/spacing variant of a known brand renders
 * with the same name. Spelling typos need explicit aliases on top.
 */
const CANONICAL_BRAND_BY_KEY = new Map(
  [...new Set(MICE.map((m) => m.brand))].map((brand) => [normalizeKey(brand), brand] as const),
);

const BRAND_TYPOS: Record<string, string> = {
  reddragon: "Redragon",
  redrasgon: "Redragon",
  logitec: "Logitech",
  logitechg: "Logitech",
  glorius: "Glorious",
  raser: "Razer",
  razerbasilisk: "Razer",
  razerviper8k: "Razer",
  thecosmicbyte: "Cosmic Byte",
  dunevoyger: "Dune Voyager",
  hsxj: "HXSJ",
  rapoovpro: "Rapoo",
  mxanywhere2: "Logitech",
  mxanywhere3: "Logitech",
  mxanywhere3s: "Logitech",
  hyperxpulsefirehastle2: "HyperX",
  rog: "Asus",
  asus: "Asus",
  asusrog: "Asus",
  tuf: "Asus",
};

/**
 * Catalog submissions carry free-text manufacturer names, so brand typos and
 * aliases collapse onto the canonical name used by the static table.
 */
export function canonicalBrand(brand: string): string {
  const key = normalizeKey(brand);
  return BRAND_TYPOS[key] ?? CANONICAL_BRAND_BY_KEY.get(key) ?? brand;
}

function brandModelKey(brand: string, model: string): string {
  return `${normalizeKey(canonicalBrand(brand))}|${normalizeKey(model)}`;
}

/**
 * Build a set of normalized words from a model name, dropping common filler
 * words ("wireless", "gaming", "mouse") that vary between catalog submissions.
 */
function modelWords(model: string): Set<string> {
  const skip = new Set(["wireless", "wired", "gaming", "mouse", "keyboard", "the", "a", "and", "or", "for"]);
  return new Set(
    model
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !skip.has(w)),
  );
}

/**
 * Two entries from the same brand are considered the same device when they share
 * at least 2 significant words, the shorter name's words are at least 60 %
 * present in the longer one, and the shorter has at least 70 % as many words
 * as the longer (prevents "Beast X Pro" matching "Beast Mini Pro").
 *
 * "WG14P Yari Pro" vs "WG14P Yari Pro Wireless 8K Gaming Mouse" → match.
 * "Beast X Pro" vs "Beast Mini Pro" → no match (different product line).
 */
function modelsMatch(a: string, b: string): boolean {
  const aw = modelWords(a);
  const bw = modelWords(b);
  if (aw.size === 0 || bw.size === 0) return false;
  const smaller = aw.size <= bw.size ? aw : bw;
  const larger = aw.size <= bw.size ? bw : aw;
  if (smaller.size < 2) return false;
  if (smaller.size / larger.size < 0.7) return false;
  let shared = 0;
  for (const w of smaller) if (larger.has(w)) shared++;
  return shared / smaller.size >= 0.6;
}

/**
 * Models the protocol's PID registries name and whose drivers therefore
 * definitively cover them. Only registries that carry names are used; bare-PID
 * registries (Teevolution, Zaunkoenig, Ninjutso) stay curated. Receivers and
 * dongles are excluded.
 */
export function registrySupportedModels(): Mouse[] {
  const rows: Mouse[] = [];

  for (const [pid, info] of WLMOUSE_PRODUCTS) {
    if (info.wireless || /receiver/i.test(info.name)) continue;
    rows.push({ brand: "WLMouse", model: info.name, status: "supported", req: 0, note: "", pids: [pid] });
  }
  for (const [pid, info] of LAMZU_PRODUCTS) {
    rows.push({
      brand: info.brand ?? "Lamzu",
      model: info.model,
      status: "supported",
      req: 0,
      note: "",
      pids: [pid],
    });
  }
  for (const [pid, info] of KEYCHRON_PRODUCTS) {
    if (info.receiver) continue;
    rows.push({ brand: "Keychron", model: info.name, status: "supported", req: 0, note: "", pids: [pid] });
  }
  for (const [pid, info] of ORBITAL_DEVICES) {
    if (info.receiver) continue;
    rows.push({ brand: "Orbital", model: info.name, status: "supported", req: 0, note: "", pids: [pid] });
  }
  for (const [pid, info] of FANTECH_PRODUCTS) {
    rows.push({ brand: "Fantech", model: info.model, status: "supported", req: 0, note: "", pids: [pid] });
  }

  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = brandModelKey(row.brand, row.model);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface LiveData {
  /** vote_count by normalized `brand|model` key. */
  reqByKey: Map<string, number>;
  requests: SupportRequest[];
}

export async function fetchLiveData(): Promise<LiveData> {
  const requests = await listSupportRequests();
  const reqByKey = new Map<string, number>();
  for (const r of requests) {
    reqByKey.set(brandModelKey(r.manufacturer, r.model), r.vote_count);
  }
  return { reqByKey, requests };
}

const PENDING_CATALOG_STATUSES = new Set(["submitted", "reviewing", "planned"]);

function catalogNote(r: SupportRequest): string {
  const parts = [r.connection, ...r.features].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Community request.";
}

/**
 * Merge the static table with live data:
 *  - registry-listed supported models are appended when missing (no network),
 *  - request counts override curated baselines when the catalog has votes,
 *  - unmatched community requests become `pending` rows.
 *
 * Matching uses both exact normalized keys and fuzzy model-name comparison so
 * that community requests with slightly different names (extra suffixes like
 * "Wireless 8K Gaming Mouse") merge into the registry entry automatically.
 */
export function mergeLiveMice(base: Mouse[], live: LiveData | null): Mouse[] {
  const known = new Set(base.map((m) => brandModelKey(m.brand, m.model)));
  const byBrand = new Map<string, Mouse[]>();
  for (const m of base) {
    const bk = normalizeKey(canonicalBrand(m.brand));
    if (!byBrand.has(bk)) byBrand.set(bk, []);
    byBrand.get(bk)!.push(m);
  }

  /** Check if a brand+model already exists via exact key or fuzzy match. */
  function isAlreadyKnown(brand: string, model: string): boolean {
    const key = brandModelKey(brand, model);
    if (known.has(key)) return true;
    const bk = normalizeKey(canonicalBrand(brand));
    const siblings = byBrand.get(bk);
    if (siblings) {
      for (const s of siblings) {
        if (modelsMatch(s.model, model)) return true;
      }
    }
    return false;
  }

  /** Find the matching existing row so we can overlay vote counts. */
  function findExisting(brand: string, model: string): Mouse | undefined {
    const bk = normalizeKey(canonicalBrand(brand));
    const siblings = byBrand.get(bk);
    if (siblings) {
      for (const s of siblings) {
        if (modelsMatch(s.model, model)) return s;
      }
    }
    return undefined;
  }

  const rows: Mouse[] = base.map((m) => {
    const votes = live?.reqByKey.get(brandModelKey(m.brand, m.model));
    return votes != null ? { ...m, req: votes } : m;
  });

  for (const model of registrySupportedModels()) {
    const key = brandModelKey(model.brand, model.model);
    if (known.has(key)) continue;
    // Also skip if a fuzzy match exists in the base table.
    if (isAlreadyKnown(model.brand, model.model)) continue;
    rows.push({
      ...model,
      req: Math.max(model.req, live?.reqByKey.get(key) ?? 0),
      note: "Auto-listed from the @openmouse/protocol driver registry.",
    });
    known.add(key);
    // Register for downstream fuzzy matching.
    const bk = normalizeKey(canonicalBrand(model.brand));
    if (!byBrand.has(bk)) byBrand.set(bk, []);
    byBrand.get(bk)!.push(model);
  }

  if (live) {
    for (const r of live.requests) {
      const key = brandModelKey(r.manufacturer, r.model);
      // Overlay vote count on an existing row (exact or fuzzy).
      const existing = findExisting(r.manufacturer, r.model);
      if (existing) {
        existing.req = r.vote_count;
        continue;
      }
      if (known.has(key)) continue;
      if (r.status === "supported") {
        const entry: Mouse = {
          brand: canonicalBrand(r.manufacturer),
          model: r.model,
          status: "supported",
          req: r.vote_count,
          note: catalogNote(r),
        };
        rows.push(entry);
        known.add(key);
        const bk = normalizeKey(canonicalBrand(r.manufacturer));
        if (!byBrand.has(bk)) byBrand.set(bk, []);
        byBrand.get(bk)!.push(entry);
        continue;
      }
      if (!PENDING_CATALOG_STATUSES.has(r.status)) continue;
      const entry: Mouse = {
        brand: canonicalBrand(r.manufacturer),
        model: r.model,
        status: "pending",
        req: r.vote_count,
        note: catalogNote(r),
      };
      rows.push(entry);
      known.add(key);
      const bk = normalizeKey(canonicalBrand(r.manufacturer));
      if (!byBrand.has(bk)) byBrand.set(bk, []);
      byBrand.get(bk)!.push(entry);
    }
  }

  return rows;
}
