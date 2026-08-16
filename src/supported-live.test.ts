import assert from "node:assert/strict";
import test from "node:test";

import type { Mouse } from "./supported-mice.ts";
import {
  mergeLiveMice,
  normalizeKey,
  registrySupportedModels,
  type LiveData,
} from "./supported-live.ts";

const BASE: Mouse[] = [
  { brand: "WLMouse", model: "Beast X", status: "supported", req: 1, note: "tracked" },
  { brand: "Logitech", model: "G502", status: "supported", req: 42, note: "tracked" },
];

function live(reqByKey: Record<string, number> = {}, requests: LiveData["requests"] = []): LiveData {
  return { reqByKey: new Map(Object.entries(reqByKey)), requests };
}

test("normalizeKey collapses case, spaces, and punctuation", () => {
  assert.equal(normalizeKey("  Logitech G502 X  "), "logitechg502x");
  assert.equal(normalizeKey("WLMouse Beast X Pro"), "wlmousebeastxpro");
  assert.equal(normalizeKey("Starlight-12 / ULX"), "starlight12ulx");
});

test("registrySupportedModels lists named driver-covered models without receivers or dupes", () => {
  const models = registrySupportedModels();
  assert.ok(models.length > 0, "expected some registry-listed models");
  const keys = new Set(models.map((m) => `${m.brand}\u0000${m.model}`));
  assert.equal(keys.size, models.length, "duplicate brand+model rows");
  assert.ok(models.every((m) => m.status === "supported"));
  assert.ok(!models.some((m) => /receiver|dongle/i.test(m.model)), "receivers leaked in");
  assert.ok(models.some((m) => m.brand === "WLMouse" && m.model === "Beast G"));
  assert.ok(models.some((m) => m.brand === "Orbital" && m.model === "Pathfinder V1"));
});

test("request counts only override the baseline when the catalog has more votes", () => {
  const merged = mergeLiveMice(BASE, live({ "wlmouse|beastx": 5 }));
  const beastX = merged.find((m) => m.brand === "WLMouse");
  assert.equal(beastX?.req, 5);
  const g502 = merged.find((m) => m.brand === "Logitech");
  assert.equal(g502?.req, 42, "baseline must be kept when the catalog has fewer votes");
});

test("registry-listed models are appended when missing from the table", () => {
  const merged = mergeLiveMice(BASE, null);
  assert.ok(merged.some((m) => m.brand === "WLMouse" && m.model === "Beast G"), "Beast G missing");
  assert.ok(merged.some((m) => m.brand === "WLMouse" && m.model === "Beast X Pro"), "Beast X Pro missing");
  assert.equal(merged.filter((m) => m.brand === "WLMouse" && m.model === "Beast X").length, 1, "base row duplicated");
});

test("unmatched community requests appear as pending rows", () => {
  const merged = mergeLiveMice([], live({}, [
    {
      id: "r1",
      manufacturer: "Roccat",
      model: "Kone XP",
      connection: "Wireless",
      features: ["DPI", "Polling rate"],
      can_test: false,
      status: "submitted",
      vote_count: 12,
      created_at: "2026-01-01T00:00:00Z",
    },
  ]));
  const roccat = merged.find((m) => m.brand === "Roccat");
  assert.deepEqual(
    [roccat?.brand, roccat?.model, roccat?.status, roccat?.req],
    ["Roccat", "Kone XP", "pending", 12],
  );
});

test("catalog rows already tracked do not duplicate, and declined rows are skipped", () => {
  const merged = mergeLiveMice(BASE, live({ "wlmouse|beastx": 3 }, [
    {
      id: "r1",
      manufacturer: "WLMouse",
      model: "Beast X",
      connection: "Wireless",
      features: [],
      can_test: false,
      status: "submitted",
      vote_count: 3,
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "r2",
      manufacturer: "Redragon",
      model: "M908",
      connection: "Wired",
      features: [],
      can_test: false,
      status: "declined",
      vote_count: 1,
      created_at: "2026-01-01T00:00:00Z",
    },
  ]));
  const beastX = merged.filter((m) => m.brand === "WLMouse" && m.model === "Beast X");
  assert.equal(beastX.length, 1, "tracked catalog row must not be appended again");
  assert.equal(beastX[0].req, 3);
  assert.ok(!merged.some((m) => m.brand === "Redragon"), "declined requests are hidden");
});
