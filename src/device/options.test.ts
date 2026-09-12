import assert from "node:assert/strict";
import test from "node:test";

import { valuesWithCurrent } from "./options.ts";

test("a current value outside the writable range remains visible", () => {
  assert.deepEqual(valuesWithCurrent([1, 2, 3], 0), [0, 1, 2, 3]);
  assert.deepEqual(valuesWithCurrent([1, 2, 3], 4), [1, 2, 3, 4]);
});

test("a writable current value is not duplicated", () => {
  const offered = [1, 2, 3];
  assert.equal(valuesWithCurrent(offered, 2), offered);
  assert.equal(valuesWithCurrent(offered, null), offered);
  assert.equal(valuesWithCurrent(offered, undefined), offered);
});
