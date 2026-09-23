import assert from "node:assert/strict";
import test from "node:test";

import { describeHidDevice } from "./hid-diagnostics.ts";
import { createSupportedClient, listLogicalDevices, logicalDeviceGroups } from "./device-clients.ts";

/** A WebHID-style device whose collections pass the Pulsar control shape. */
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

test("native Bridge exposes Razer transports without widening WebHID", () => {
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

    assert.equal(createSupportedClient(browserDevice), null);
    assert.notEqual(createSupportedClient(bridgeDevice), null);
  }
});

test("WebHID top-level collections of one mouse collapse to a single card", () => {
  const devices = [
    supportedWebHidDevice(),
    supportedWebHidDevice(),
    supportedWebHidDevice(),
  ];

  assert.equal(logicalDeviceGroups(devices).length, 1);
  assert.equal(listLogicalDevices(devices).length, 1);
});

test("identical WebHID mice with distinct product names stay separate cards", () => {
  const devices = [
    supportedWebHidDevice({ productName: "Mouse One" }),
    supportedWebHidDevice({ productName: "Mouse Two" }),
  ];

  const groups = logicalDeviceGroups(devices);
  assert.equal(groups.length, 2);
  assert.equal(listLogicalDevices(devices).length, 2);
});

test("Bridge devices keep their native per-physical-device identity", () => {
  // Bridge already groups report paths on its side; two identical receivers
  // are still distinct physical devices and must not be merged again.
  const devices = [bridgeDevice("hid-1"), bridgeDevice("hid-2")];

  assert.equal(logicalDeviceGroups(devices).length, 2);
  assert.equal(listLogicalDevices(devices).length, 2);
});
