import assert from "node:assert/strict";
import test from "node:test";

import { deviceImage } from "./device-images.ts";

test("fixture previews resolve product art without a HID device", () => {
  assert.equal(deviceImage(null, "CRDRAKO KO-ONE"), "/devices/crdrako-ko-one.png");
  assert.equal(deviceImage(null, "Zaunkoenig M3K"), "/devices/zaunkoenig-m3k.png");
  assert.equal(deviceImage(null, "Zaunkoenig M2K"), "/devices/zaunkoenig-m3k.png");
});
