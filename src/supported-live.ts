import { WLMOUSE_PRODUCTS } from "@openmouse/protocol/drivers/vendors";
import { LAMZU_PRODUCTS } from "@openmouse/protocol/lamzu";
import { KEYCHRON_PRODUCTS } from "@openmouse/protocol/keychron";
import { ORBITAL_DEVICES } from "@openmouse/protocol/orbital";

import type { Mouse } from "./supported-mice.ts";
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

function brandModelKey(brand: string, model: string): string {
  return `${normalizeKey(brand)}|${normalizeKey(model)}`;
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
 */
export function mergeLiveMice(base: Mouse[], live: LiveData | null): Mouse[] {
  const known = new Set(base.map((m) => brandModelKey(m.brand, m.model)));

  const rows: Mouse[] = base.map((m) => {
    const votes = live?.reqByKey.get(brandModelKey(m.brand, m.model));
    return votes && votes > m.req ? { ...m, req: votes } : m;
  });

  for (const model of registrySupportedModels()) {
    const key = brandModelKey(model.brand, model.model);
    if (known.has(key)) continue;
    rows.push({
      ...model,
      req: Math.max(model.req, live?.reqByKey.get(key) ?? 0),
      note: "Auto-listed from the @openmouse/protocol driver registry.",
    });
    known.add(key);
  }

  if (live) {
    for (const r of live.requests) {
      const key = brandModelKey(r.manufacturer, r.model);
      if (r.status === "supported") {
        if (known.has(key)) continue;
        rows.push({
          brand: r.manufacturer,
          model: r.model,
          status: "supported",
          req: r.vote_count,
          note: catalogNote(r),
        });
        known.add(key);
        continue;
      }
      if (!PENDING_CATALOG_STATUSES.has(r.status)) continue;
      if (known.has(key)) continue;
      rows.push({
        brand: r.manufacturer,
        model: r.model,
        status: "pending",
        req: r.vote_count,
        note: catalogNote(r),
      });
      known.add(key);
    }
  }

  return rows;
}
