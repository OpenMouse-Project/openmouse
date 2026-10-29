import assert from "node:assert/strict";
import test from "node:test";
import type { KeyboardStatus } from "@openmouse/keyboard-protocol/drivers";
import { LogitechKeyboardClient } from "./logitech-keyboard.ts";

const device = {
  vendorId: 0x046d, productId: 0xc351, productName: "PRO X 60", opened: false,
  collections: [{ usagePage: 0xff00, usage: 1, children: [], inputReports: [], outputReports: [], featureReports: [] }],
} as unknown as HIDDevice;

function driverOf(client: LogitechKeyboardClient): Record<string, unknown> {
  // The test replaces the in-process driver, not an untrusted device response.
  const withDriver = client as unknown as { client: Record<string, unknown> };
  return withDriver.client;
}

function status(): KeyboardStatus {
  return {
    brand: "Logitech", name: "PRO X 60", firmwareVersion: "1.2", serial: "ABC",
    logitech: {
      productId: 0xc351, receiverProductId: null, unitId: null, serial: "ABC", transport: ["USB"],
      modelIds: [], firmware: "1.2", battery: { percent: 75, level: null, status: null },
      pollingRateHz: 1000, supportedPollingRates: [125, 1000],
      brightness: { min: 0, max: 100, value: 50, steps: 101, illumination: true },
      analog: { rapidTrigger: true, keyPriority: false, capabilities: null },
      lighting: {
        zones: [1, 2], rgbZones: [{ index: 0, location: 1, effects: [{ index: 0, id: 0x04, period: 5000 }] }],
        legacyZones: [], legacyEffectReadback: false,
      },
      controls: null, wireless: false, verified: false,
    },
  } as KeyboardStatus;
}

test("Logitech adapter accepts keyboard HID++ only, never mouse product IDs", () => {
  assert.equal(LogitechKeyboardClient.isSupported(device), true);
  assert.equal(LogitechKeyboardClient.isSupported({ ...device, productId: 0xc08b } as HIDDevice), false);
  assert.equal(LogitechKeyboardClient.isSupported({ ...device, vendorId: 0x1532 } as HIDDevice), false);
});

test("Initial refresh exposes actual Logitech status and identity without extra read", async () => {
  const client = new LogitechKeyboardClient(device);
  const current = status();
  let reads = 0;
  driverOf(client).readStatus = async () => { reads += 1; return current; };
  assert.deepEqual(await client.readIdentity(), {
    brand: "Logitech", name: "PRO X 60", firmwareVersion: "1.2", serial: "ABC",
    boardId: null, capabilities: null, appVersion: null, pcbVersion: null,
  });
  assert.deepEqual(await client.readPolling(), { currentHz: 1000, supportedHz: [125, 1000] });
  assert.equal((await client.command({ kind: "refresh" })).vendorStatus, current);
  assert.equal(reads, 1);
  assert.equal((await client.command({ kind: "logitechRefresh" })).vendorStatus, current);
  assert.equal(reads, 2);
});

test("Status-gated writes use the protocol's verified methods then reread status", async () => {
  const client = new LogitechKeyboardClient(device);
  const calls: unknown[][] = [];
  const inner = driverOf(client);
  inner.readStatus = async () => status();
  for (const method of ["setPollingRate", "setBrightness", "setAnalogRapidTrigger", "setAnalogKeyPriority", "setRgbEffect", "setSolidColor"]) {
    inner[method] = async (...args: unknown[]) => { calls.push([method, ...args]); return true; };
  }
  for (const command of [
    { kind: "logitechPolling", hz: 1000 }, { kind: "logitechBrightness", value: 40 },
    { kind: "logitechRapidTrigger", enabled: false }, { kind: "logitechKeyPriority", enabled: true },
    { kind: "logitechRgbEffect", mode: "Wave" }, { kind: "logitechSolidColor", red: 2, green: 3, blue: 4 },
  ] as const) {
    assert.ok((await client.command(command)).vendorStatus?.logitech);
  }
  assert.deepEqual(calls, [
    ["setPollingRate", 1000], ["setBrightness", 40], ["setAnalogRapidTrigger", false],
    ["setAnalogKeyPriority", true], ["setRgbEffect", "Wave"], ["setSolidColor", 2, 3, 4],
  ]);
});

test("Unadvertised RGB modes and unavailable analog state never write", async () => {
  const client = new LogitechKeyboardClient(device);
  const current = status();
  if (!current.logitech?.analog) throw new Error("Test fixture has no analog state.");
  current.logitech.analog.rapidTrigger = null;
  const inner = driverOf(client);
  inner.readStatus = async () => current;
  inner.setAnalogRapidTrigger = async () => { throw new Error("Unexpected analog write"); };
  inner.setRgbEffect = async () => { throw new Error("Unexpected RGB write"); };
  await assert.rejects(client.command({ kind: "logitechRapidTrigger", enabled: true }), /not available/);
  await assert.rejects(client.command({ kind: "logitechRgbEffect", mode: "Cycling" }), /not advertised/);
});
