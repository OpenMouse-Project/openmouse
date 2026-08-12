import assert from "node:assert/strict";
import test from "node:test";

import { deviceImage } from "./device-images.ts";

const hid = (productId: number): HIDDevice => ({ vendorId: 0x046d, productId } as HIDDevice);

test("G502 family USB interfaces use their matching normalized artwork", () => {
  assert.equal(deviceImage(hid(0xc07d)), "/devices/logitech-g502.png");
  assert.equal(deviceImage(hid(0xc095)), "/devices/logitech-g502-x-plus.png");
  assert.equal(deviceImage(hid(0xc099)), "/devices/logitech-g502-x.png");
});

test("G502 X receiver artwork follows the paired mouse name", () => {
  assert.equal(deviceImage(hid(0xc547), "G502 X PLUS"), "/devices/logitech-g502-x-plus.png");
  assert.equal(deviceImage(hid(0xc547), "G502 X"), "/devices/logitech-g502-x.png");
});

test("fixture previews resolve product art without a HID device", () => {
  assert.equal(deviceImage(null, "CRDRAKO KO-ONE"), "/devices/crdrako-ko-one.png");
  assert.equal(deviceImage(null, "Zaunkoenig M3K"), "/devices/zaunkoenig-m3k.png");
  assert.equal(deviceImage(null, "Zaunkoenig M2K"), "/devices/zaunkoenig-m3k.png");
});
