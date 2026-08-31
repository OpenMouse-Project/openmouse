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

test("Pulsar receiver falls back to the generic Pulsar render (no dongle art)", () => {
  const device = { vendorId: 0x3710, productId: 0x5405 } as HIDDevice;
  assert.equal(deviceImage(device, "Pulsar PRO Dongle"), "/devices/pulsar-x2-v2.png");
});

const dev = (vendorId: number, productId: number): HIDDevice => ({ vendorId, productId } as HIDDevice);

test("G203/G102 family shares the G203 render by PID and name", () => {
  assert.equal(deviceImage(dev(0x046d, 0xc084)), "/devices/logitech-g203.png"); // G203 Prodigy
  assert.equal(deviceImage(dev(0x046d, 0xc092)), "/devices/logitech-g203.png"); // G203 Lightsync
  assert.equal(deviceImage(dev(0x046d, 0xc089)), "/devices/logitech-g203.png"); // G102 Lightsync
  assert.equal(deviceImage(null, "G203 LIGHTSYNC"), "/devices/logitech-g203.png");
  assert.equal(deviceImage(null, "Logitech G102 LIGHTSYNC"), "/devices/logitech-g203.png");
});

test("G402 / G303 / G403 / G903 resolve by PID and name", () => {
  assert.equal(deviceImage(dev(0x046d, 0xc07e)), "/devices/logitech-g402.png");
  assert.equal(deviceImage(null, "G402 Hyperion Fury"), "/devices/logitech-g402.png");
  assert.equal(deviceImage(dev(0x046d, 0xc080)), "/devices/logitech-g303.png");
  assert.equal(deviceImage(null, "G303 Shroud Edition"), "/devices/logitech-g303.png");
  assert.equal(deviceImage(dev(0x046d, 0xc08f)), "/devices/logitech-g403.png");
  assert.equal(deviceImage(null, "G403 HERO"), "/devices/logitech-g403.png");
  assert.equal(deviceImage(dev(0x046d, 0xc08e)), "/devices/logitech-g903.png");
  assert.equal(deviceImage(null, "G903 HERO"), "/devices/logitech-g903.png");
});

test("G Pro family uses the classic shell; G Pro 2 gets its own render", () => {
  assert.equal(deviceImage(dev(0x046d, 0xc085)), "/devices/logitech-g-pro.png"); // G Pro (2017)
  assert.equal(deviceImage(dev(0x046d, 0xc08c)), "/devices/logitech-g-pro.png"); // G Pro Hero
  assert.equal(deviceImage(null, "G Pro Wireless Gaming Mouse"), "/devices/logitech-g-pro.png");
  assert.equal(deviceImage(null, "G Pro 2 Lightspeed"), "/devices/logitech-g-pro-2.png");
  // The Superlight must keep its own render, not the classic G Pro shell.
  assert.equal(deviceImage(null, "G Pro X Superlight"), "/devices/logitech-pro-x-superlight-2c.png");
});

test("G305/G304 and G309 use their own renders by name", () => {
  assert.equal(deviceImage(null, "G305 LIGHTSPEED"), "/devices/logitech-g305.png");
  assert.equal(deviceImage(null, "G304"), "/devices/logitech-g305.png");
  assert.equal(deviceImage(null, "G309 Lightspeed"), "/devices/logitech-g309.png");
});

test("MX Anywhere 3 and MX Ergo S resolve by name over their shared Bolt receiver", () => {
  assert.equal(deviceImage(null, "MX Anywhere 3"), "/devices/logitech-mx-anywhere-3.png");
  assert.equal(deviceImage(null, "MX Ergo S Wireless Trackball"), "/devices/logitech-mx-ergo-s.png");
});

test("DeathAdder V2 family shares the V2 render; V4 Pro gets its own", () => {
  assert.equal(deviceImage(dev(0x1532, 0x0084)), "/devices/razer-deathadder-v2.png"); // V2 wired
  assert.equal(deviceImage(dev(0x1532, 0x007c)), "/devices/razer-deathadder-v2.png"); // V2 Pro
  assert.equal(deviceImage(dev(0x1532, 0x007d)), "/devices/razer-deathadder-v2.png");
  assert.equal(deviceImage(dev(0x1532, 0x006e)), "/devices/razer-deathadder-v2.png"); // Essential
  assert.equal(deviceImage(null, "DeathAdder V2"), "/devices/razer-deathadder-v2.png");
  assert.equal(deviceImage(null, "DeathAdder V2 Pro"), "/devices/razer-deathadder-v2.png");
  assert.equal(deviceImage(null, "DeathAdder Essential"), "/devices/razer-deathadder-v2.png");
  assert.equal(deviceImage(dev(0x1532, 0x00be)), "/devices/razer-deathadder-v4-pro.png");
  assert.equal(deviceImage(dev(0x1532, 0x00ef)), "/devices/razer-deathadder-v4-pro.png"); // Carbon
  assert.equal(deviceImage(null, "DeathAdder V4 Pro"), "/devices/razer-deathadder-v4-pro.png");
  // Test-needed V3 Pro and V2 X HyperSpeed must NOT pick up V3/V2 artwork.
  assert.equal(deviceImage(null, "DeathAdder V3 Pro"), "/devices/unknown-device.png");
  assert.equal(deviceImage(null, "DeathAdder V2 X HyperSpeed"), "/devices/unknown-device.png");
});

test("DeathAdder V3 wired resolves by name (PID not pinned)", () => {
  assert.equal(deviceImage(null, "DeathAdder V3"), "/devices/razer-deathadder-v3.png");
});

test("Viper V3 HyperSpeed and Viper V4 Pro use their own renders", () => {
  assert.equal(deviceImage(dev(0x1532, 0x00b8)), "/devices/razer-viper-v3-hyperspeed.png");
  assert.equal(deviceImage(null, "Viper V3 HyperSpeed"), "/devices/razer-viper-v3-hyperspeed.png");
  assert.equal(deviceImage(dev(0x1532, 0x00e5)), "/devices/razer-viper-v4-pro.png");
  assert.equal(deviceImage(dev(0x1532, 0x00e6)), "/devices/razer-viper-v4-pro.png");
  assert.equal(deviceImage(null, "Viper V4 Pro"), "/devices/razer-viper-v4-pro.png");
});

test("Endgame Gear XM2 8K and XM2w resolve to their own renders", () => {
  assert.equal(deviceImage(dev(0x3367, 0x1966)), "/devices/endgame-gear-xm2-8k.png");
  assert.equal(deviceImage(dev(0x3367, 0x1980)), "/devices/endgame-gear-xm2-8k.png");
  assert.equal(deviceImage(null, "XM2 8K"), "/devices/endgame-gear-xm2-8k.png");
  assert.equal(deviceImage(null, "XM2w 4K"), "/devices/endgame-gear-xm2w.png");
  // XM2w must not be caught by the OP1 render.
  assert.equal(deviceImage(null, "Endgame Gear XM2w 4K"), "/devices/endgame-gear-xm2w.png");
});

test("WLMouse Beast X / Beast Mini / Beast X Pro have no render and fall back to unknown", () => {
  assert.equal(deviceImage(dev(0x36a7, 0xa883)), "/devices/unknown-device.png");
  assert.equal(deviceImage(dev(0x36a7, 0xa884)), "/devices/unknown-device.png");
  assert.equal(deviceImage(null, "WLMouse Beast X"), "/devices/unknown-device.png");
  assert.equal(deviceImage(dev(0x36a7, 0xa886)), "/devices/unknown-device.png");
  assert.equal(deviceImage(null, "WLMouse Beast Mini"), "/devices/unknown-device.png");
  assert.equal(deviceImage(dev(0x36a7, 0xa870)), "/devices/unknown-device.png");
  assert.equal(deviceImage(null, "WLMouse Beast X Pro"), "/devices/unknown-device.png");
  // Sword X keeps its render (not skipped).
  assert.equal(deviceImage(dev(0x36a7, 0xa878)), "/devices/wlmouse-sword-x.png");
  assert.equal(deviceImage(null, "WLMouse Sword X"), "/devices/wlmouse-sword-x.png");
});

test("VGN Dragonfly F2 Master+, Lamzu Maya X, ATK F1 V2, Orbital and moddo resolve", () => {
  assert.equal(deviceImage(dev(0x3554, 0xfb56)), "/devices/vgn-dragonfly-f2.png");
  assert.equal(deviceImage(dev(0x3554, 0xfb57)), "/devices/vgn-dragonfly-f2.png");
  assert.equal(deviceImage(null, "Dragonfly F2 Master+"), "/devices/vgn-dragonfly-f2.png");
  assert.equal(deviceImage(dev(0x373e, 0x001c)), "/devices/lamzu-maya-x.png");
  assert.equal(deviceImage(dev(0x373e, 0x001e)), "/devices/lamzu-maya-x.png");
  assert.equal(deviceImage(null, "Lamzu Maya X"), "/devices/lamzu-maya-x.png");
  assert.equal(deviceImage(null, "ATK F1 V2 Ultra Max"), "/devices/atk-f1-v2-ultra-max.png");
  // Orbital has no product render yet; it resolves to the generic placeholder.
  assert.equal(deviceImage(dev(0x1915, 0x080c)), "/devices/unknown-device.png");
  assert.equal(deviceImage(null, "Orbital Ghost"), "/devices/unknown-device.png");
  // moddo has no product render yet; it resolves to the generic placeholder.
  assert.equal(deviceImage(null, "moddoMOUSE"), "/devices/unknown-device.png");
});

test("Finalmouse Starlight-12 / ULX resolves by name", () => {
  assert.equal(deviceImage(null, "Finalmouse Starlight-12"), "/devices/finalmouse-ulx.png");
  assert.equal(deviceImage(null, "Finalmouse ULX"), "/devices/finalmouse-ulx.png");
});

test("test-needed and unsupported models are not given new artwork", () => {
  assert.equal(deviceImage(null, "Razer Basilisk V3"), "/devices/unknown-device.png");
  assert.equal(deviceImage(null, "Razer Viper Ultimate"), "/devices/unknown-device.png");
  assert.equal(deviceImage(null, "Attack Shark X3"), "/devices/unknown-device.png");
  assert.equal(deviceImage(null, "Endgame Gear OP1w 4K v2"), "/devices/unknown-device.png");
  assert.equal(deviceImage(null, "VGN Dragonfly R1 Pro"), "/devices/unknown-device.png");
  assert.equal(deviceImage(null, "Razer Viper 8KHz"), "/devices/unknown-device.png");
});
