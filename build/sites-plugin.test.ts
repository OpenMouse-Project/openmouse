import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sites } from "./sites-vite-plugin.ts";

const tempRoots: string[] = [];
after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

test("sites closeBundle writes the asset-serving worker into a tmp root", async () => {
  const root = mkdtempSync(join(tmpdir(), "om-sites-"));
  tempRoots.push(root);
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
