import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sites } from "./sites-vite-plugin.ts";

test("sites closeBundle writes the asset-serving worker into a tmp root", async () => {
  const root = mkdtempSync(join(tmpdir(), "om-sites-"));
  const plugin = sites();
  plugin.configResolved?.({ root, build: { outDir: "dist" } } as never);
  await plugin.closeBundle?.();
  const bytes = readFileSync(join(root, "dist", "server", "index.js"), "utf8");
  assert.equal(
    bytes,
    `export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
`,
  );
});
