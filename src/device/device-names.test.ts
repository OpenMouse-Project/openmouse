import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { rememberDeviceName, rememberedDeviceName, resetDeviceNamesForTests } from "./device-names.ts";

/** A `localStorage` stand-in that survives `resetDeviceNamesForTests`, like a reload. */
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  },
});

beforeEach(() => {
  stored.clear();
  resetDeviceNamesForTests();
});

function bridgeDevice(key: string, productName: string): HIDDevice {
  return { openMouseTransport: "bridge", key, vendorId: 0x3554, productId: 0xf5f7, productName } as unknown as HIDDevice;
}

function webHidDevice(productName: string): HIDDevice {
  return { vendorId: 0x046d, productId: 0xc54d, productName } as unknown as HIDDevice;
}

test("a mouse's name outlives a reload", () => {
  const dongle = bridgeDevice("hid-3554f5f7-1a2b3c4d", "SCYROX 8K Dongle");
  rememberDeviceName(dongle, "Scyrox V8");
  resetDeviceNamesForTests();
  assert.equal(rememberedDeviceName(dongle), "Scyrox V8");

  const receiver = webHidDevice("USB Receiver");
  rememberDeviceName(receiver, " PRO X SUPERLIGHT 2c ");
  resetDeviceNamesForTests();
  assert.equal(rememberedDeviceName(receiver), "PRO X SUPERLIGHT 2c");
});

test("names stay with their own device", () => {
  rememberDeviceName(bridgeDevice("hid-3554f5f7-1a2b3c4d", "SCYROX 8K Dongle"), "Scyrox V8");
  assert.equal(rememberedDeviceName(bridgeDevice("hid-046dc54d-99887766", "USB Receiver")), null);
});

test("an older Bridge's per-session keys are never trusted", () => {
  // `hid-2` can be a different device after the next reload.
  const device = bridgeDevice("hid-2", "SCYROX 8K Dongle");
  rememberDeviceName(device, "Scyrox V8");
  assert.equal(rememberedDeviceName(device), null);
  assert.equal(stored.size, 0);
});

test("an empty name is not remembered, and a corrupt store starts over", () => {
  const device = webHidDevice("USB Receiver");
  rememberDeviceName(device, "  ");
  assert.equal(rememberedDeviceName(device), null);

  stored.set("openmouse.device-names", "{not json");
  resetDeviceNamesForTests();
  assert.equal(rememberedDeviceName(device), null);
  rememberDeviceName(device, "G Pro");
  assert.equal(rememberedDeviceName(device), "G Pro");
});

test("only the most recent names are kept", () => {
  for (let index = 0; index < 70; index += 1) {
    rememberDeviceName(webHidDevice(`Receiver ${index}`), `Mouse ${index}`);
  }
  assert.equal(rememberedDeviceName(webHidDevice("Receiver 0")), null);
  assert.equal(rememberedDeviceName(webHidDevice("Receiver 69")), "Mouse 69");
});
