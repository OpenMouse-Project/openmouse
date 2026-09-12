import assert from "node:assert/strict";
import test from "node:test";

import { deviceImage } from "./device-images.ts";

const CDN = "https://img.openmouse.app/";

const dev = (vendorId: number, productId: number): HIDDevice => ({ vendorId, productId } as HIDDevice);

test("G502 family resolves entirely by name", () => {
  assert.equal(deviceImage(null, "G502"), CDN + "logitech-g502.png");
  assert.equal(deviceImage(null, "G502 X PLUS"), CDN + "logitech-g502-x-plus.png");
  assert.equal(deviceImage(null, "G502 X"), CDN + "logitech-g502-x.png");
});

test("G703 name resolves the G703 render regardless of transport", () => {
  assert.equal(deviceImage(null, "G703 HERO"), CDN + "logitech-g703.png");
  assert.equal(deviceImage(null, "G703 Wired/Wireless Gaming Mouse"), CDN + "logitech-g703.png");
});

test("G502 X receiver artwork follows the paired mouse name", () => {
  assert.equal(deviceImage(dev(0x046d, 0xc547), "G502 X PLUS"), CDN + "logitech-g502-x-plus.png");
  assert.equal(deviceImage(dev(0x046d, 0xc547), "G502 X"), CDN + "logitech-g502-x.png");
});

test("PRO X 2 Superstrike resolves by name over any shared receiver", () => {
  assert.equal(deviceImage(dev(0x046d, 0xc547), "PRO X 2 Superstrike"), CDN + "logitech-pro-x2-superstrike.png");
  assert.equal(deviceImage(null, "Logitech PRO X2 SUPERSTRIKE"), CDN + "logitech-pro-x2-superstrike.png");
});

test("Razer Orochi V2 resolves by name", () => {
  assert.equal(deviceImage(dev(0x1532, 0x0094), "Razer Orochi V2"), CDN + "razer-orochi-v2.png");
});

test("Corsair NIGHTSWORD RGB falls back to the placeholder until art exists", () => {
  assert.equal(deviceImage(dev(0x1b1c, 0x1b5c), "Corsair NIGHTSWORD RGB"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "CORSAIR NIGHTSWORD RGB Gaming Mouse"), CDN + "unknown-device.png");
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

test("VXE R1 family resolves by name across every generation", () => {
  assert.equal(deviceImage(null, "VXE R1"), CDN + "vxe-r1-series.png");
  assert.equal(deviceImage(null, "VXE R1 SE"), CDN + "vxe-r1-series.png");
  assert.equal(deviceImage(null, "VXE R1 SE+"), CDN + "vxe-r1-series.png");
  assert.equal(deviceImage(null, "VXE R1 Pro"), CDN + "vxe-r1-series.png");
  assert.equal(deviceImage(null, "VXE R1 Pro Max"), CDN + "vxe-r1-series.png");
});

test("Attack Shark R5 Ultra resolves by name", () => {
  assert.equal(deviceImage(null, "Attack Shark R5 Ultra"), CDN + "attackshark-r5-ultra.png");
});

test("ATK ZERO resolves by name", () => {
  assert.equal(deviceImage(null, "ATK ZERO"), CDN + "atk-zero.png");
});

test("Dareu A950 PRO Mg resolves by name", () => {
  assert.equal(deviceImage(null, "Dareu A950 PRO Mg"), CDN + "dareu-a950-pro-mg.png");
});

test("Attack Shark R2 resolves by name (PID 0x402D is shared with the M5 Pro)", () => {
  assert.equal(deviceImage(null, "Attack Shark R2"), CDN + "attackshark-r2.png");
  // The shared receiver PID must NOT resolve to the R2 render.
  assert.equal(
    deviceImage(dev(0x3151, 0x402d), "Lingbao M5 Pro"),
    CDN + "unknown-device.png",
  );
});

test("OP1we and OP1 8K resolve to distinct renders by name", () => {
  assert.equal(deviceImage(null, "OP1we"), CDN + "endgame-gear-op1we.png");
  assert.equal(deviceImage(null, "OP1 8K"), CDN + "endgame-gear-op1-8k.png");
});

test("Pulsar receiver falls back to the generic Pulsar render (no dongle art)", () => {
  const device = { vendorId: 0x3710, productId: 0x5405 } as HIDDevice;
  assert.equal(deviceImage(device, "Pulsar PRO Dongle"), CDN + "pulsar-x2-v2.png");
});

test("G203/G102 family shares the G203 render by name", () => {
  assert.equal(deviceImage(null, "G203 LIGHTSYNC"), CDN + "logitech-g203.png");
  assert.equal(deviceImage(null, "Logitech G102 LIGHTSYNC"), CDN + "logitech-g203.png");
});

test("G402 / G303 / G403 / G903 resolve by name", () => {
  assert.equal(deviceImage(null, "G402 Hyperion Fury"), CDN + "logitech-g402.png");
  assert.equal(deviceImage(null, "G303 Shroud Edition"), CDN + "logitech-g303.png");
  assert.equal(deviceImage(null, "G403 HERO"), CDN + "logitech-g403.png");
  assert.equal(deviceImage(null, "G903 HERO"), CDN + "logitech-g903.png");
});

test("G Pro family uses the classic shell; G Pro Wireless and G Pro 2 get their own renders", () => {
  assert.equal(deviceImage(null, "G Pro"), CDN + "logitech-g-pro.png"); // G Pro (2017) / Hero
  // G Pro Wireless shares its Lightspeed receiver PID (0xc539) with other
  // models (e.g. G703), so it can only be resolved by its reported name.
  assert.equal(deviceImage(null, "G Pro Wireless Gaming Mouse"), CDN + "logitech-gpro-wireless.png");
  assert.equal(deviceImage(null, "G Pro 2 Lightspeed"), CDN + "logitech-g-pro-2.png");
  // The Superlight must keep its own render, not the classic G Pro shell.
  assert.equal(deviceImage(null, "G Pro X Superlight"), CDN + "logitech-pro-x-superlight-2c.png");
  // The original Superlight (PID 0xc094) reports its own HID++ device name as
  // "PRO X Wireless", not "Superlight" — confirmed against real hardware.
  assert.equal(deviceImage(dev(0x046d, 0xc094), "PRO X Wireless"), CDN + "logitech-pro-x-superlight-2c.png");
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
  assert.equal(deviceImage(null, "DeathAdder V2"), CDN + "razer-deathadder-v2.png");
  assert.equal(deviceImage(null, "DeathAdder V2 Pro"), CDN + "razer-deathadder-v2.png");
  assert.equal(deviceImage(null, "DeathAdder Essential"), CDN + "razer-deathadder-v2.png");
  assert.equal(deviceImage(null, "DeathAdder V4 Pro"), CDN + "razer-deathadder-v4-pro.png");
  assert.equal(deviceImage(null, "DeathAdder V4 Pro Carbon Fiber Edition"), CDN + "razer-deathadder-v4-pro.png");
  // Test-needed V3 Pro and V2 X HyperSpeed must NOT pick up V3/V2 artwork.
  assert.equal(deviceImage(null, "DeathAdder V3 Pro"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "DeathAdder V2 X HyperSpeed"), CDN + "unknown-device.png");
});

test("DeathAdder V3 wired resolves by name", () => {
  assert.equal(deviceImage(null, "DeathAdder V3"), CDN + "razer-deathadder-v3.png");
});

test("Viper family resolves each generation to its own render", () => {
  assert.equal(deviceImage(null, "Viper V2 Pro"), CDN + "razer-viper-v2-pro.png");
  assert.equal(deviceImage(null, "Viper V3 Pro"), CDN + "razer-viper-v3-pro.png");
  // Viper V3 Pro SE must NOT fall into the plain V3 Pro render — no art of
  // its own yet, so it resolves to the placeholder.
  assert.equal(deviceImage(null, "Viper V3 Pro SE"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "Viper V3 HyperSpeed"), CDN + "razer-viper-v3-hyperspeed.png");
  assert.equal(deviceImage(null, "Viper V4 Pro"), CDN + "razer-viper-v4-pro.png");
  // The plain original Viper resolves last among the viper checks.
  assert.equal(deviceImage(null, "Viper"), CDN + "razer-viper.webp");
  // Viper Ultimate has no render of its own; must not borrow the plain Viper's.
  assert.equal(deviceImage(null, "Viper Ultimate"), CDN + "unknown-device.png");
});

test("Endgame Gear XM2 8K and XM2w resolve to their own renders", () => {
  assert.equal(deviceImage(null, "XM2 8K"), CDN + "endgame-gear-xm2-8k.png");
  assert.equal(deviceImage(null, "XM2w 4K"), CDN + "endgame-gear-xm2w.png");
  // XM2w must not be caught by the OP1 render.
  assert.equal(deviceImage(null, "Endgame Gear XM2w 4K"), CDN + "endgame-gear-xm2w.png");
});

test("WLMouse Beast X / Beast Mini / Beast X Pro have no render and fall back to unknown", () => {
  assert.equal(deviceImage(null, "WLMouse Beast X"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "WLMouse Beast Mini"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "WLMouse Beast X Pro"), CDN + "unknown-device.png");
  // Sword X keeps its render.
  assert.equal(deviceImage(null, "WLMouse Sword X"), CDN + "wlmouse-sword-x.png");
});

test("VGN Dragonfly F2 Master+, Lamzu Maya X, ATK F1 V2, Orbital and moddo resolve", () => {
  assert.equal(deviceImage(null, "Dragonfly F2 Master+"), CDN + "vgn-dragonfly-f2.png");
  assert.equal(deviceImage(null, "Lamzu Maya X"), CDN + "lamzu-maya-x.png");
  assert.equal(deviceImage(null, "ATK F1 V2 Ultra Max"), CDN + "atk-f1-v2-ultra-max.png");
  // Orbital has no product render yet; it resolves to the generic placeholder.
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
  assert.equal(deviceImage(null, "Attack Shark X3"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "Endgame Gear OP1w 4K v2"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "VGN Dragonfly R1 Pro"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "Razer Viper 8KHz"), CDN + "unknown-device.png");
});

test("a mouse behind a shared WLMouse receiver resolves by name", () => {
  // 0xa882 is the 1K receiver's own id; the model comes from the driver's name.
  const receiver = { vendorId: 0x36a7, productId: 0xa882 } as HIDDevice;
  assert.equal(deviceImage(receiver, "WLmouse Beast Max"), CDN + "wlmouse-beast-max.png");
  assert.equal(deviceImage(receiver, "WLmouse Beast G"), CDN + "wlmouse-beast-g.png");
  assert.equal(deviceImage(receiver, "WLmouse Beast Mini"), CDN + "unknown-device.png");
});

test("K-snake X11 resolves by name regardless of transport", () => {
  assert.equal(deviceImage(null, "K-snake X11"), CDN + "ksnake-x11.png");
});

test("Attack Shark X11 does not inherit K-snake artwork", () => {
  assert.equal(deviceImage(null, "Attack Shark X11"), CDN + "unknown-device.png");
  assert.equal(deviceImage(null, "Attack Shark X11 SE"), CDN + "unknown-device.png");
});

test("the MCHOSE A7 V3 family gets its own render, not the V2's", () => {
  assert.equal(deviceImage(null, "MCHOSE A7 V3"), CDN + "mchose-a7-v3.png");
  assert.equal(deviceImage(null, "MCHOSE A7 V2"), CDN + "mchose-a7-v2.png");

  // The V3 receivers are shared with the K5, R7 and A5 V3, so a device
  // behind one with no matching name falls to the placeholder rather than
  // guessing it's an A7.
  const mchose = (productId: number): HIDDevice => ({ vendorId: 0x3837, productId } as HIDDevice);
  assert.equal(deviceImage(mchose(0x1014)), CDN + "unknown-device.png");
  assert.equal(deviceImage(mchose(0x1018)), CDN + "unknown-device.png");
});

test("an A7 V3 name is not swallowed by the A7 V2 fallback", () => {
  assert.equal(deviceImage(null, "MCHOSE A7 V3 Ultra+"), CDN + "mchose-a7-v3.png");
  assert.equal(deviceImage(null, "MCHOSE A7 V2 Ultra+"), CDN + "mchose-a7-v2.png");
});

test("Ninjutso Sora V2/V3 and TEN family resolve by name", () => {
  assert.equal(deviceImage(null, "Ninjutso Sora V2"), CDN + "ninjutso-sora-v2.png");
  assert.equal(deviceImage(null, "Ninjutso Sora V3"), CDN + "ninjutso-sora-v3.png");
  assert.equal(deviceImage(null, "Ninjutso TEN / TEN AIR"), CDN + "ninjutso-ten.png");
});

test("Incott G23V2Pro and Keychron M6 resolve by name", () => {
  assert.equal(deviceImage(null, "Esports G23V2Pro"), CDN + "incott-g23-v2-pro.png");
  assert.equal(deviceImage(null, "Keychron M6"), CDN + "keychron-m6.png");
});
