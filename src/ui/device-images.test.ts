import assert from "node:assert/strict";
import test from "node:test";

import { deviceImage } from "./device-images.ts";

const hid = (productId: number): HIDDevice => ({ vendorId: 0x046d, productId } as HIDDevice);

test("G502 family USB interfaces use their matching normalized artwork", () => {
  assert.equal(deviceImage(hid(0xc07d)), "/devices/logitech-g502.png");
  assert.equal(deviceImage(hid(0xc095)), "/devices/logitech-g502-x-plus.png");
  assert.equal(deviceImage(hid(0xc099)), "/devices/logitech-g502-x.png");
});

test("G703 wired PIDs and Lightspeed name fallback use the G703 render", () => {
  assert.equal(deviceImage(hid(0xc087)), "/devices/logitech-g703.png");
  assert.equal(deviceImage(hid(0xc090)), "/devices/logitech-g703.png");
  assert.equal(deviceImage(hid(0xc539), "G703 HERO"), "/devices/logitech-g703.png");
  assert.equal(deviceImage(null, "G703 Wired/Wireless Gaming Mouse"), "/devices/logitech-g703.png");
});

test("G502 X receiver artwork follows the paired mouse name", () => {
  assert.equal(deviceImage(hid(0xc547), "G502 X PLUS"), "/devices/logitech-g502-x-plus.png");
  assert.equal(deviceImage(hid(0xc547), "G502 X"), "/devices/logitech-g502-x.png");
});

test("PRO X 2 Superstrike uses its own artwork over USB and shared receivers", () => {
  assert.equal(deviceImage(hid(0xc0a8)), "/devices/logitech-pro-x2-superstrike.png");
  assert.equal(deviceImage(hid(0xc547), "PRO X 2 Superstrike"), "/devices/logitech-pro-x2-superstrike.png");
  assert.equal(deviceImage(null, "Logitech PRO X2 SUPERSTRIKE"), "/devices/logitech-pro-x2-superstrike.png");
});

test("fixture previews resolve product art without a HID device", () => {
  assert.equal(deviceImage(null, "CRDRAKO KO-ONE"), "/devices/crdrako-ko-one.png");
  assert.equal(deviceImage(null, "Zaunkoenig M3K"), "/devices/zaunkoenig-m3k.png");
  assert.equal(deviceImage(null, "Zaunkoenig M2K"), "/devices/zaunkoenig-m3k.png");
  assert.equal(deviceImage(null, "Viper Mini"), "/devices/razer-viper-mini.webp");
  assert.equal(deviceImage(null, "Cobra"), "/devices/razer-cobra.webp");
  assert.equal(deviceImage(null, "Terra Pro"), "/devices/teevolution-terra-pro.png");
  assert.equal(deviceImage(null, "MX Master 3S"), "/devices/logitech-mx-master-3s.png");
  assert.equal(deviceImage(null, "G703"), "/devices/logitech-g703.png");
  assert.equal(deviceImage(null, "OP1we"), "/devices/endgame-gear-op1we.png");
  assert.equal(deviceImage(null, "Endgame Gear OP1we"), "/devices/endgame-gear-op1we.png");
  assert.equal(deviceImage(null, "OP1 8K"), "/devices/endgame-gear-op1-8k.png");
});

test("Pulsar 4K receiver artwork follows the reported mouse name", () => {
  assert.equal(deviceImage(null, "Pulsar 4K Wireless Receiver"), "/devices/pulsar-x2-v2.png");
  assert.equal(deviceImage(null, "Pulsar X2 V2"), "/devices/pulsar-x2-v2.png");
  assert.equal(deviceImage(null, "Pulsar X2 V2 Pro"), "/devices/pulsar-x2-v2.png");
});

test("Attack Shark R5 Ultra wired and wireless share the same artwork", () => {
  const hid373e = (productId: number): HIDDevice => ({ vendorId: 0x373e, productId } as HIDDevice);
  assert.equal(deviceImage(hid373e(0x0046)), "/devices/attackshark-r5-ultra.png");
  assert.equal(deviceImage(hid373e(0x0047)), "/devices/attackshark-r5-ultra.png");
  assert.equal(deviceImage(null, "Attack Shark R5 Ultra"), "/devices/attackshark-r5-ultra.png");
});

test("OP1we wired and wireless share the same artwork, distinct from OP1 8K", () => {
  const hid3367 = (productId: number): HIDDevice => ({ vendorId: 0x3367, productId } as HIDDevice);
  assert.equal(deviceImage(hid3367(0x1961)), "/devices/endgame-gear-op1we.png");
  assert.equal(deviceImage(hid3367(0x1962)), "/devices/endgame-gear-op1we.png");
  assert.equal(deviceImage(null, "OP1we"), "/devices/endgame-gear-op1we.png");
  assert.equal(deviceImage(hid3367(0x1964)), "/devices/endgame-gear-op1-8k.png");
  assert.equal(deviceImage(null, "OP1 8K"), "/devices/endgame-gear-op1-8k.png");
});

test("Pulsar Pro receiver uses its dongle artwork", () => {
  const device = { vendorId: 0x3710, productId: 0x5405 } as HIDDevice;
  assert.equal(deviceImage(device, "Pulsar PRO Dongle"), "/devices/pulsar-pro-dongle.png");
});
