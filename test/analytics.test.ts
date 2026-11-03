import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";

// src/platform/analytics.ts reads import.meta.env at module top (Vite folds
// it statically at build time). node --test has no import.meta.env, so load
// the module through a transpile with the env stubbed to {} — analytics off.
async function loadAnalytics(): Promise<typeof Analytics> {
  const source = readFileSync(new URL("../src/platform/analytics.ts", import.meta.url), "utf8")
    .replaceAll("import.meta.env", "({})");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const context = {
    exports,
    module: { exports },
    require: (name: string): unknown => {
      if (name.includes("posthog")) throw new Error("posthog must stay lazy in tests");
      throw new Error(`unexpected require ${name}`);
    },
    window: { addEventListener: (): void => undefined, dispatchEvent: (): boolean => true },
    location: { origin: "http://localhost" },
    localStorage: { getItem: (): null => null, setItem: (): void => undefined },
  };
  vm.runInNewContext(code, context);
  return context.module.exports as typeof Analytics;
}

const { deviceProps, scrubError } = await loadAnalytics();

test("deviceProps keeps numeric ids and brand, never free-text names", () => {
  // deviceProps runs inside a vm context (unavoidable: analytics.ts reads
  // import.meta.env at module top), so compare via JSON — prototypes differ.
  const seen = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
  assert.deepStrictEqual(
    seen(deviceProps({ vendorId: 0x046d, productId: 0xc336, brand: "Logitech" })),
    { vendor_id: 0x046d, product_id: 0xc336, brand: "Logitech" },
  );
  // Extra keys (e.g. a stale productName) must not leak through.
  assert.deepStrictEqual(
    seen(deviceProps({ vendorId: 1, productId: 2, productName: "G502 X", brand: "B" } as never)),
    { vendor_id: 1, product_id: 2, brand: "B" },
  );
  assert.deepStrictEqual(seen(deviceProps(null)), {});
});

test("scrubError caps and redacts sensitive text", () => {
  const { error_message } = scrubError(new Error("failed for user@example.com at C:\\logs\\run id abcdef1234567890"));
  assert.doesNotMatch(error_message, /user@example\.com/);
  assert.doesNotMatch(error_message, /abcdef1234567890/);
  assert.ok(error_message.length <= 200);
});
