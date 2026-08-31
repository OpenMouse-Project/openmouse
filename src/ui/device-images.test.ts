import assert from "node:assert/strict";
import test from "node:test";

import { deviceImage } from "./device-images.ts";

const CDN = "https://pub-ac470fd1b7084597b8a4a45cfc3318fc.r2.dev/";

const hid = (productId: number): HIDDevice => ({ vendorId: 0x046d, productId } as HIDDevice);

test("G502 family USB interfaces use their matching normalized artwork", () => {
  assert.equal(deviceImage(hid(0xc07d)), CDN + "logitech-g502.png");
  assert.equal(deviceImage(hid(0xc095)), CDN + "logitech-g502-x-plus.png");
  assert.equal(deviceImage(hid(0xc099)), CDN + "logitech-g502-x.png");
});

test("G703 wired PIDs and Lightspeed name fallback use the G703 render", () => {
  assert.equal(deviceImage(hid(0xc087)), CDN + "logitech-g703.png");
  assert.equal(deviceImage(hid(0xc090)), CDN + "logitech-g703.png");
  assert.equal(deviceImage(hid(0xc539), "G703 HERO"), CDN + "logitech-g703.png");
  assert.equal(deviceImage(null, "G703 Wired/Wireless Gaming Mouse"), CDN + "logitech-g703.png");
});

test("G502 X receiver artwork follows the paired mouse name", () => {
  assert.equal(deviceImage(hid(0xc547), "G502 X PLUS"), CDN + "logitech-g502-x-plus.png");
  assert.equal(deviceImage(hid(0xc547), "G502 X"), CDN + "logitech-g502-x.png");
});

test("PRO X 2 Superstrike uses its own artwork over USB and shared receivers", () => {
  assert.equal(deviceImage(hid(0xc0a8)), CDN + "logitech-pro-x2-superstrike.png");
  assert.equal(deviceImage(hid(0xc547), "PRO X 2 Superstrike"), CDN + "logitech-pro-x2-superstrike.png");
  assert.equal(deviceImage(null, "Logitech PRO X2 SUPERSTRIKE"), CDN + "logitech-pro-x2-superstrike.png");
});

test("fixture previews resolve product art without a HID device", () => {
  assert.equal(deviceImage(null, "CRDRAKO KO-ONE"), CDN + "crdrako-ko-one.png");
  assert.equal(deviceImage(null, "Zaunkoenig M3K"), CDN + "zaunkoenig-m3k.png");
  assert.equal(deviceImage(null, "Zaunkoenig M2K"), CDN + "zaunkoenig-m3k.png");
  assert.equal(deviceImage(null, "Viper Mini"), CDN + "razer-viper-mini.webp");
  assert.equal(deviceImage(null, "Cobra"), CDN + "razer-cobra.webp");
  assert.equal(deviceImage(null, "Terra Pro"), CDN + "teevolution-terra-pro.png");
  assert.equal(deviceImage(null, "MX Master 3S"), CDN + "logitech-mx-master-3s.png");
  assert.equal(deviceImage(null, "G703"), CDN + "logitech-g703.png");
  assert.equal(deviceImage(null, "OP1we"), CDN + "endgame-gear-op1we.png");
  assert.equal(deviceImage(null, "Endgame Gear OP1we"), CDN + "endgame-gear-op1we.png");
  assert.equal(deviceImage(null, "OP1 8K"), CDN + "endgame-gear-op1-8k.png");
});

test("Pulsar 4K receiver artwork follows the reported mouse name", () => {
  assert.equal(deviceImage(null, "Pulsar 4K Wireless Receiver"), CDN + "pulsar-x2-v2.png");
  assert.equal(deviceImage(null, "Pulsar X2 V2"), CDN + "pulsar-x2-v2.png");
  assert.equal(deviceImage(null, "Pulsar X2 V2 Pro"), CDN + "pulsar-x2-v2.png");
});

test("Attack Shark R5 Ultra wired and wireless share the same artwork", () => {
  const hid373e = (productId: number): HIDDevice => ({ vendorId: 0x373e, productId } as HIDDevice);
  assert.equal(deviceImage(hid373e(0x0046)), CDN + "attackshark-r5-ultra.png");
  assert.equal(deviceImage(hid373e(0x0047)), CDN + "attackshark-r5-ultra.png");
  assert.equal(deviceImage(null, "Attack Shark R5 Ultra"), CDN + "attackshark-r5-ultra.png");
});

test("OP1we wired and wireless share the same artwork, distinct from OP1 8K", () => {
  const hid3367 = (productId: number): HIDDevice => ({ vendorId: 0x3367, productId } as HIDDevice);
  assert.equal(deviceImage(hid3367(0x1961)), CDN + "endgame-gear-op1we.png");
  assert.equal(deviceImage(hid3367(0x1962)), CDN + "endgame-gear-op1we.png");
  assert.equal(deviceImage(null, "OP1we"), CDN + "endgame-gear-op1we.png");
  assert.equal(deviceImage(hid3367(0x1964)), CDN + "endgame-gear-op1-8k.png");
  assert.equal(deviceImage(null, "OP1 8K"), CDN + "endgame-gear-op1-8k.png");
});

test("Pulsar receiver falls back to the generic Pulsar render (no dongle art)", () => {
  const device = { vendorId: 0x3710, productId: 0x5405 } as HIDDevice;
  assert.equal(deviceImage(device, "Pulsar PRO Dongle"), CDN + "pulsar-x2-v2.png");
});

const dev = (vendorId: number, productId: number): HIDDevice => ({ vendorId, productId } as HIDDevice);

test("G203/G102 family shares the G203 render by PID and name", () => {
  assert.equal(deviceImage(dev(0x046d, 0xc084)), CDN + "logitech-g203.png"); // G203 Prodigy
  assert.equal(deviceImage(dev(0x046d, 0xc092)), CDN + "logitech-g203.png"); // G203 Lightsync
  assert.equal(deviceImage(dev(0x046d, 0xc089)), CDN + "logitech-g203.png"); // G102 Lightsync
  assert.equal(deviceImage(null, "G203 LIGHTSYNC"), CDN + "logitech-g203.png");
  assert.equal(deviceImage(null, "Logitech G102 LIGHTSYNC"), CDN + "logitech-g203.png");
});

test("G402 / G303 / G403 / G903 resolve by PID and name", () => {
  assert.equal(deviceImage(dev(0x046d, 0xc07e)), CDN + "logitech-g402.png");
  assert.equal(deviceImage(null, "G402 Hyperion Fury"), CDN + "logitech-g402.png");
  assert.equal(deviceImage(dev(0x046d, 0xc080)), CDN + "logitech-g303.png");
  assert.equal(deviceImage(null, "G303 Shroud Edition"), CDN + "logitech-g303.png");
  assert.equal(deviceImage(dev(0x046d, 0xc08f)), CDN + "logitech-g403.png");
  assert.equal(deviceImage(null, "G403 HERO"), CDN + "logitech-g403.png");
  assert.equal(deviceImage(dev(0x046d, 0xc08e)), CDN + "logitech-g903.png");
  assert.equal(deviceImage(null, "G903 HERO"), CDN + "logitech-g903.png");
});

test("G Pro family uses the classic shell; G Pro 2 gets its own render", () => {
  assert.equal(deviceImage(dev(0x046d, 0xc085)), CDN + "logitech-g-pro.png"); // G Pro (2017)
  assert.equal(deviceImage(dev(0x046d, 0xc08c)), CDN + "logitech-g-pro.png"); // G Pro Hero
  assert.equal(deviceImage(null, "G Pro Wireless Gaming Mouse"), CDN + "logitech-g-pro.png");
  assert.equal(deviceImage(null, "G Pro 2 Lightspeed"), CDN + "logitech-g-pro-2.png");
  // The Superlight must keep its own render, not the classic G Pro shell.
  assert.equal(deviceImage(null, "G Pro X Superlight"), CDN + "logitech-pro-x-superlight-2c.png");
});

test("G305/G304 and G309 use their own renders by name", () => {
  assert.equal(deviceImage(null, "G305 LIGHTSPEED"), CDN + "logitech-g305.png");
  assert.equal(deviceImage(null, "G304"), CDN + "logitech-g305.png");
  assert.equal(deviceImage(null, "G309 Lightspeed"), CDN + "logitech-g309.png");
});

test("MX Anywhere 3 and MX Ergo S resolve by name over their shared Bolt receiver", () => {
  assert.equal(deviceImage(null, "MX Anywhere 3"), CDN + "logitech-mx-anywhere-3.png");
  assert.equal(deviceImage(null, "MX Ergo S Wireless Trackball"), CDN + "logitech-mx-ergo-s.png");
});

test("DeathAdder V2 family shares the V2 render; V4 Pro gets its own", () => {
  assert.equal(deviceImage(dev(0x1532, 0x0084)), CDN + "razer-deathadder-v2.png"); // V2 wired
  assert.equal(deviceImage(dev(0x1532, 0x007c)), CDN + "razer-deathadder-v2.png"); // V2 Pro
  assert.equal(deviceImage(dev(0x1532, 0x007d)), CDN + "razer-deathadder-v2.png");
  assert.equal(deviceImage(dev(0x1532, 0x006e)), CDN + "razer-deathadder-v2.png"); // Essential
  assert.equal(deviceImage(null, "DeathAdder V2"), CDN + "razer-deathadder-v2.png");
  assert.equal(deviceImage(null, "DeathAdder V2 Pro"), CDN + "razer-deathadder-v2.png");
  assert.equal(deviceImage(null, "DeathAdder Essential"), CDN + "razer-deathadder-v2.png");
  assert.equal(deviceImage(dev(0x1532, 0x00be)), CDN + "razer-deathadder-v4-pro.png");
  assert.equal(deviceImage(dev(0x1532, 0x00ef)), CDN + "razer-deathadder-v4-pro.png"); // Carbon
  assert.equal(deviceImage(null, "DeathAdder V4 Pro"), CDN + "razer-deathadder-v4-pro.png");
  // Test-needed V3 Pro and V2 X HyperSpeed must NOT pick up V3/V2 artwork.
  assert.equal(deviceImage(null, "DeathAdder V3 Pro"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "DeathAdder V2 X HyperSpeed"), CDN + "unknown-device.png");
});

test("DeathAdder V3 wired resolves by name (PID not pinned)", () => {
  assert.equal(deviceImage(null, "DeathAdder V3"), CDN + "razer-deathadder-v3.png");
});

test("Viper V3 HyperSpeed and Viper V4 Pro use their own renders", () => {
  assert.equal(deviceImage(dev(0x1532, 0x00b8)), CDN + "razer-viper-v3-hyperspeed.png");
  assert.equal(deviceImage(null, "Viper V3 HyperSpeed"), CDN + "razer-viper-v3-hyperspeed.png");
  assert.equal(deviceImage(dev(0x1532, 0x00e5)), CDN + "razer-viper-v4-pro.png");
  assert.equal(deviceImage(dev(0x1532, 0x00e6)), CDN + "razer-viper-v4-pro.png");
  assert.equal(deviceImage(null, "Viper V4 Pro"), CDN + "razer-viper-v4-pro.png");
});

test("Endgame Gear XM2 8K and XM2w resolve to their own renders", () => {
  assert.equal(deviceImage(dev(0x3367, 0x1966)), CDN + "endgame-gear-xm2-8k.png");
  assert.equal(deviceImage(dev(0x3367, 0x1980)), CDN + "endgame-gear-xm2-8k.png");
  assert.equal(deviceImage(null, "XM2 8K"), CDN + "endgame-gear-xm2-8k.png");
  assert.equal(deviceImage(null, "XM2w 4K"), CDN + "endgame-gear-xm2w.png");
  // XM2w must not be caught by the OP1 render.
  assert.equal(deviceImage(null, "Endgame Gear XM2w 4K"), CDN + "endgame-gear-xm2w.png");
});

test("WLMouse Beast X / Beast Mini / Beast X Pro have no render and fall back to unknown", () => {
  assert.equal(deviceImage(dev(0x36a7, 0xa883)), CDN + "unknown-device.png");
  assert.equal(deviceImage(dev(0x36a7, 0xa884)), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "WLMouse Beast X"), CDN + "unknown-device.png");
  assert.equal(deviceImage(dev(0x36a7, 0xa886)), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "WLMouse Beast Mini"), CDN + "unknown-device.png");
  assert.equal(deviceImage(dev(0x36a7, 0xa870)), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "WLMouse Beast X Pro"), CDN + "unknown-device.png");
  // Sword X keeps its render (not skipped).
  assert.equal(deviceImage(dev(0x36a7, 0xa878)), CDN + "wlmouse-sword-x.png");
  assert.equal(deviceImage(null, "WLMouse Sword X"), CDN + "wlmouse-sword-x.png");
});

test("VGN Dragonfly F2 Master+, Lamzu Maya X, ATK F1 V2, Orbital and moddo resolve", () => {
  assert.equal(deviceImage(dev(0x3554, 0xfb56)), CDN + "vgn-dragonfly-f2.png");
  assert.equal(deviceImage(dev(0x3554, 0xfb57)), CDN + "vgn-dragonfly-f2.png");
  assert.equal(deviceImage(null, "Dragonfly F2 Master+"), CDN + "vgn-dragonfly-f2.png");
  assert.equal(deviceImage(dev(0x373e, 0x001c)), CDN + "lamzu-maya-x.png");
  assert.equal(deviceImage(dev(0x373e, 0x001e)), CDN + "lamzu-maya-x.png");
  assert.equal(deviceImage(null, "Lamzu Maya X"), CDN + "lamzu-maya-x.png");
  assert.equal(deviceImage(null, "ATK F1 V2 Ultra Max"), CDN + "atk-f1-v2-ultra-max.png");
  // Orbital has no product render yet; it resolves to the generic placeholder.
  assert.equal(deviceImage(dev(0x1915, 0x080c)), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "Orbital Ghost"), CDN + "unknown-device.png");
  // moddo has no product render yet; it resolves to the generic placeholder.
  assert.equal(deviceImage(null, "moddoMOUSE"), CDN + "unknown-device.png");
});

test("Finalmouse Starlight-12 / ULX resolves by name", () => {
  assert.equal(deviceImage(null, "Finalmouse Starlight-12"), CDN + "finalmouse-ulx.png");
  assert.equal(deviceImage(null, "Finalmouse ULX"), CDN + "finalmouse-ulx.png");
});

test("test-needed and unsupported models are not given new artwork", () => {
  assert.equal(deviceImage(null, "Razer Basilisk V3"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "Razer Viper Ultimate"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "Attack Shark X3"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "Endgame Gear OP1w 4K v2"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "VGN Dragonfly R1 Pro"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "Razer Viper 8KHz"), CDN + "unknown-device.png");
});
