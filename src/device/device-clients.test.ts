import assert from "node:assert/strict";
import test from "node:test";

import { describeHidDevice } from "./hid-diagnostics.ts";
import { forgetMouseReceiver, rememberMouseReceiver } from "./mouse-receivers.ts";
import { clientSupportScore, createKeyboardClient, createMouseClient, createSupportedClient, isSharedReceiver, listingClient, listLogicalDevices, logicalDeviceGroups, pickLogicalDevice, prepareAutoConnectClient, siblingMouseClient } from "./device-clients.ts";

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

test("a connected mouse is listed as a mouse despite its receiver's keyboard claim", async () => {
  const receiver = {
    productName: "USB Receiver",
    vendorId: 0x046d,
    productId: 0xc54d,
    collections: [
      { usagePage: 0xff00, usage: 1, inputReports: [], outputReports: [], featureReports: [], children: [] },
      { usagePage: 0xff00, usage: 2, inputReports: [], outputReports: [], featureReports: [], children: [] },
    ],
    opened: false,
  } as unknown as HIDDevice;

  // Nothing has read the receiver's pairing slots, so the keyboard claim still
  // owns the listing (#1282).
  assert.ok(createKeyboardClient(receiver));
  assert.equal(await listingClient(receiver, null), null);

  // A mouse client has opened this receiver and found a sensor behind it; the
  // listing must show that mouse, not a "USB Receiver · Keyboard" card (#1362).
  const mouse = await createMouseClient(receiver);
  assert.ok(mouse);
  assert.equal(await listingClient(receiver, mouse), mouse);

  // Another device's live client does not reclassify this receiver.
  const other = await createMouseClient(supportedWebHidDevice());
  assert.ok(other);
  assert.equal(await listingClient(receiver, other), null);
});

test("a receiver that answered as a mouse stays a mouse until it fails as one", async () => {
  const receiverInterface = (usage: number) => ({
    productName: "USB Receiver",
    vendorId: 0x046d,
    productId: 0xc54d,
    collections: [{ usagePage: 0xff00, usage, inputReports: [], outputReports: [], featureReports: [], children: [] }],
    opened: false,
  } as unknown as HIDDevice);
  const shortInterface = receiverInterface(1);
  const longInterface = receiverInterface(2);
  assert.equal(await createSupportedClient(longInterface), null);
  assert.equal(await clientSupportScore(longInterface), 900);
  assert.equal(await isSharedReceiver(longInterface, [shortInterface, longInterface]), true);

  // Activation read a mouse on the long interface: that interface now lists
  // and connects as the mouse, with no live client needed, and represents the
  // receiver. Both interfaces share page 0xff00, so the record must name the
  // usage too, or they would tie.
  rememberMouseReceiver(longInterface);
  try {
    const mouse = await createSupportedClient(longInterface);
    assert.ok(mouse);
    assert.equal(mouse.device, longInterface);
    assert.notEqual(await listingClient(longInterface, null), null);
    assert.ok(await clientSupportScore(longInterface) > 20_000);
    assert.equal(await clientSupportScore(shortInterface), 0);
    const [group] = await logicalDeviceGroups([shortInterface, longInterface]);
    assert.equal(await pickLogicalDevice(group), longInterface);

    // A different receiver model keeps the keyboard-first guess.
    const otherReceiver = { ...longInterface, productId: 0xc539 } as unknown as HIDDevice;
    assert.equal(await createSupportedClient(otherReceiver), null);

    // Bridge keys each receiver by its own session key: a second receiver of
    // the same model over Bridge is not the one that was read.
    const bridgeReceiver = (key: string) => ({ ...longInterface, openMouseTransport: "bridge", key } as unknown as HIDDevice);
    rememberMouseReceiver(bridgeReceiver("046d:c54d:A"));
    assert.equal(await clientSupportScore(bridgeReceiver("046d:c54d:B")), 900);
    assert.ok(await clientSupportScore(bridgeReceiver("046d:c54d:A")) > 20_000);
    forgetMouseReceiver(bridgeReceiver("046d:c54d:A"));
  } finally {
    forgetMouseReceiver(longInterface);
  }

  // A failed mouse activation forgets it, so a newly paired keyboard is found again.
  assert.equal(await createSupportedClient(longInterface), null);
});

test("a Keychron Link-KM lists its mouse interface once that interface answered", async () => {
  const linkInterface = (usagePage: number, usage: number, reports: { input: number; output: number } | null) => ({
    productName: "Keychron Link-KM Type C",
    vendorId: 0x3434,
    productId: 0xd029,
    collections: [{
      usagePage,
      usage,
      inputReports: reports ? [{ reportId: reports.input }] : [],
      outputReports: reports ? [{ reportId: reports.output }] : [],
      featureReports: [],
      children: [],
    }],
    opened: false,
  } as unknown as HIDDevice);
  // VIA raw HID, which the VIA keyboard driver claims, and the M6 command interface.
  const via = linkInterface(0xff60, 0x61, null);
  const m6 = linkInterface(0xffc1, 0x01, { input: 0xb4, output: 0xb3 });
  const devices = [via, m6];
  const [group] = await logicalDeviceGroups(devices);
  assert.equal(group.length, 2);

  // Unread, the VIA claim outranks the mouse interface (#1282 ordering).
  assert.ok(createKeyboardClient(via));
  assert.equal(await pickLogicalDevice(group), via);
  assert.equal(await isSharedReceiver(m6, devices), true);
  // A failed VIA read falls back to the receiver's mouse interface.
  const fallback = await siblingMouseClient(via, devices);
  assert.ok(fallback);
  assert.equal(fallback.device, m6);

  rememberMouseReceiver(m6);
  try {
    // The listing and reconnect pick the M6 interface; VIA keeps its claim on
    // its own interface but no longer represents the receiver.
    assert.equal(await pickLogicalDevice(group), m6);
    assert.equal(await clientSupportScore(via), 0);
    assert.ok(await createSupportedClient(m6));
  } finally {
    forgetMouseReceiver(m6);
  }
  assert.equal(await pickLogicalDevice(group), via);
});
