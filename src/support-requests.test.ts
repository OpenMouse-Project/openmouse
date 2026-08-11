import assert from "node:assert/strict";
import test from "node:test";
import { voterToken } from "./support-requests.ts";

test("voter token is stable in browser storage", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) } as Storage;
  const first = voterToken(storage);
  assert.equal(voterToken(storage), first);
  assert.match(first, /^[0-9a-f-]{36}$/);
});
