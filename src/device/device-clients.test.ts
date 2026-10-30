import assert from "node:assert/strict";
import test from "node:test";

import { describeHidDevice } from "./hid-diagnostics.ts";
import { createKeyboardClient, createMouseClient, createSupportedClient, listLogicalDevices, logicalDeviceGroups, prepareAutoConnectClient } from "./device-clients.ts";

function supportedWebHidDevice(options: {
  vendorId?: number;
  productId?: number;
  productName?: string;
} = {}): HIDDevice {
  return {
    productName: options.productName ?? "Example Mouse",
    vendorId: options.vendorId ?? 0x3710,
    productId: options.productId ?? 0x1234,
    collections: [{
      usagePage: 0xff00,
      usage: 1,
      inputReports: [{ reportId: 0x08 }],
      outputReports: [{ reportId: 0x08 }],
      featureReports: [],
    }],
    opened: false,
  } as unknown as HIDDevice;
}

function bridgeDevice(key: string, productName = "Razer Viper Ultimate"): HIDDevice {
  return {
    productName,
    vendorId: 0x1532,
    productId: 0x007b,
    key,
    openMouseTransport: "bridge",
    collections: [],
    opened: false,
  } as unknown as HIDDevice;
}

test("HID diagnostics include device IDs and report collections", () => {
  const device = {
    productName: "Example Mouse",
    vendorId: 0x1234,
    productId: 0xabcd,
    collections: [{
      usagePage: 0xff00,
      usage: 1,
      featureReports: [{ reportId: 7 }],
    }],
  } as unknown as HIDDevice;

  assert.equal(
    describeHidDevice(device),
    "Example Mouse (VID 0x1234 PID 0xabcd; usage 0xff00:1 feat[0x7])",
  );
});

test("native Bridge exposes Razer transports without widening WebHID", async () => {
  const products = [
    { productName: "Razer Viper Ultimate", productId: 0x007b },
    { productName: "Razer DeathAdder V3 HyperSpeed", productId: 0x00c5 },
    { productName: "Razer Viper V4 Pro", productId: 0x00e5 },
  ];

  for (const product of products) {
    const browserDevice = {
      ...product,
      vendorId: 0x1532,
      collections: [],
      opened: false,
    } as unknown as HIDDevice;
    const bridgeDevice = {
      ...browserDevice,
      openMouseTransport: "bridge",
    } as unknown as HIDDevice;

    assert.equal(await createSupportedClient(browserDevice), null);
    assert.notEqual(await createSupportedClient(bridgeDevice), null);
  }
});

test("WebHID top-level collections of one mouse collapse to a single card", async () => {
  const devices = [
    supportedWebHidDevice(),
    supportedWebHidDevice(),
    supportedWebHidDevice(),
  ];

  assert.equal((await logicalDeviceGroups(devices)).length, 1);
  assert.equal((await listLogicalDevices(devices)).length, 1);
});

test("identical WebHID mice with distinct product names stay separate cards", async () => {
  const devices = [
    supportedWebHidDevice({ productName: "Mouse One" }),
    supportedWebHidDevice({ productName: "Mouse Two" }),
  ];

  const groups = await logicalDeviceGroups(devices);
  assert.equal(groups.length, 2);
  assert.equal((await listLogicalDevices(devices)).length, 2);
});

test("Bridge devices keep their native per-physical-device identity", async () => {
  // Bridge already groups report paths on its side; two identical receivers
  // are still distinct physical devices and must not be merged again.
  const devices = [bridgeDevice("hid-1"), bridgeDevice("hid-2")];

  assert.equal((await logicalDeviceGroups(devices)).length, 2);
  assert.equal((await listLogicalDevices(devices)).length, 2);
});

function answeringBridgeRazer(key: string, answers: boolean, usages = [[0x01, 0x02]]): HIDDevice {
  let reply = new Uint8Array(90);
  const device = {
    ...bridgeDevice(key, "Razer Basilisk V3 Pro 35K"),
    productId: 0x00cc,
    collections: usages.map(([usagePage, usage]) => ({
      usagePage, usage, inputReports: [], outputReports: [], featureReports: [], children: [],
    })),
    opened: false,
    async open() { this.opened = true; },
    async close() { this.opened = false; },
    async sendFeatureReport(reportId: number, data: Uint8Array) {
      assert.equal(reportId, 0);
      assert.equal(data[6], 0x00);
      assert.equal(data[7], 0x81, "automatic selection must only probe firmware");
      if (!answers) throw new Error("HidD_SetFeature: Incorrect function");
      reply = new Uint8Array(data);
      reply[0] = 0x02;
    },
    async receiveFeatureReport() { return new DataView(reply.buffer); },
  };
  return device as unknown as HIDDevice;
}

test("automatic Bridge selection rejects a dead Razer sibling without closing the working interface", async (t) => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout } });
  t.after(() => Reflect.deleteProperty(globalThis, "window"));
  const working = answeringBridgeRazer("working", true);
  await working.open();
  const sibling = answeringBridgeRazer("sibling", false, [[0x01, 0x80], [0x0c, 0x01]]);
  const candidate = await createSupportedClient(sibling);
  assert.ok(candidate);

  assert.equal(await prepareAutoConnectClient(candidate), null);
  assert.equal(sibling.opened, false);
  assert.equal(working.opened, true);
});

test("automatic Bridge selection keeps answering Razer interfaces regardless of collection shape", async (t) => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout } });
  t.after(() => Reflect.deleteProperty(globalThis, "window"));
  for (const usages of [[[0x01, 0x02]], [[0x0c, 0x01]], []]) {
    const device = answeringBridgeRazer("working", true, usages);
    const candidate = await createSupportedClient(device);
    assert.ok(candidate);
    const prepared = await prepareAutoConnectClient(candidate);
    assert.ok(prepared);
    assert.equal(prepared.device, device);
    assert.equal(device.opened, true);
    await prepared.close();
  }
});

test("automatic selection leaves specialized Razer and WebHID clients on their existing paths", async () => {
  for (const device of [
    { ...bridgeDevice("v4"), productId: 0x00e5 },
    supportedWebHidDevice(),
  ]) {
    const client = await createSupportedClient(device as HIDDevice);
    assert.ok(client);
    assert.equal(await prepareAutoConnectClient(client), client);
  }
});

test("a shared Logitech receiver routes keyboard-first with the mouse registry intact", async () => {
  const receiver = {
    productName: "LIGHTSPEED receiver",
    vendorId: 0x046d,
    productId: 0xc539,
    collections: [{ usagePage: 0xff00, usage: 2, inputReports: [], outputReports: [], featureReports: [], children: [] }],
    opened: false,
  } as unknown as HIDDevice;
  // The keyboard matcher claims every receiver interface by VID/PID + HID++
  // collection, so sidebar/connect ordering stays keyboard-first for issue #1282.
  assert.ok(createKeyboardClient(receiver));
  assert.equal(await createSupportedClient(receiver), null);
  // A mouse-only pairing has no keyboard behind the receiver: the activation
  // fallback in activateKeyboardClientNow uses this to reconnect it as a mouse.
  const mouse = await createMouseClient(receiver);
  assert.ok(mouse);
  assert.equal(mouse.device, receiver);
});
