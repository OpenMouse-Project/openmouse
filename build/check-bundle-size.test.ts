import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkBundles } from "./check-bundle-size.ts";

const tempDirs: string[] = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, number>): string {
  const dir = mkdtempSync(join(tmpdir(), "om-assets-"));
  tempDirs.push(dir);
  const assets = join(dir, "assets");
  mkdirSync(assets, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(assets, name), Buffer.alloc(bytes));
  }
  return assets;
}

test("checkBundles passes on a small fixture", () => {
  const assets = fixture({ "main-abc.js": 100, "lazy-abc.js": 100, "app-abc.css": 50 });
  assert.equal(checkBundles(assets), false);
});
test("checkBundles grants slack to preview-fixture builds", () => {
  const under = fixture({ "main-abc.js": 100, "preview-fixtures-abc.js": 3_810_000 });
  assert.equal(checkBundles(under), false);
  const over = fixture({ "main-abc.js": 100, "preview-fixtures-abc.js": 3_820_000 });
  assert.equal(checkBundles(over), true);
});
