import assert from "node:assert/strict";
import test from "node:test";

import { brandChecks } from "./hardware-brand-checks.ts";
import type { HardwareDeviceInfo } from "./hardware-test-report.ts";

export function infoFor(partial: Partial<HardwareDeviceInfo>): HardwareDeviceInfo {
  return {
    present: true,
    brand: "Acme",
    name: "MaxPoint One",
    vendorId: 0x1234,
    productId: 0x5678,
    productName: "MaxPoint One",
    transport: "webhid",
    connectionType: "Wireless",
    pollingRateHz: 1000,
    supportedPollingRates: [1000],
    dpi: 1600,
    dpiStages: null,
    activeDpiStage: null,
    batteryPercent: 62,
    batteryState: "Discharging",
    firmware: ["v1.2.3"],
    liftOffDistance: "Low",
    driverFamily: "atk",
    deviceMode: "Onboard",
    ...partial,
  };
}

function keys(results: ReturnType<typeof brandChecks>): string[] {
  return results.map((result) => result.key);
}

test("no brand checks without a connected device", () => {
  assert.deepEqual(brandChecks(infoFor({ present: false })), []);
});

test("ATK wireless requires healthy receiver telemetry", () => {
  const online = brandChecks(
    infoFor({ brand: "ATK", receiverOnline: true, receiverRfId: "A0B1", pairingInProgress: false }),
  );
  const healthy = online.find((result) => result.key === "brandReceiverTelemetry");
  assert.equal(healthy?.status, "pass");
  assert.match(healthy?.detail ?? "", /online/);

  const offline = brandChecks(infoFor({ brand: "ATK", receiverOnline: false, receiverRfId: "A0B1" }));
  assert.equal(offline.find((result) => result.key === "brandReceiverTelemetry")?.status, "fail");

  const noTelemetry = brandChecks(infoFor({ brand: "VXE", receiverOnline: null, receiverRfId: null }));
  assert.equal(noTelemetry.find((result) => result.key === "brandReceiverTelemetry")?.status, "fail");

  const pairing = brandChecks(
    infoFor({ brand: "VGN", receiverOnline: false, receiverRfId: "A0B1", pairingInProgress: true }),
  );
  assert.equal(pairing.find((result) => result.key === "brandReceiverTelemetry")?.status, "fail");
});

test("ATK receiver telemetry is skipped on a wired connection", () => {
  const results = brandChecks(infoFor({ brand: "ATK", connectionType: "Wired", receiverOnline: null }));
  assert.equal(results.find((result) => result.key === "brandReceiverTelemetry")?.status, "skip");
});

test("wireless-battery brands require a battery read on the wireless link", () => {
  const razerOk = brandChecks(infoFor({ brand: "Razer", batteryPercent: 63 }));
  assert.equal(razerOk.find((result) => result.key === "brandWirelessBattery")?.status, "pass");

  const razerMissing = brandChecks(infoFor({ brand: "Razer", batteryPercent: null }));
  assert.equal(razerMissing.find((result) => result.key === "brandWirelessBattery")?.status, "fail");

  const logiMissing = brandChecks(infoFor({ brand: "Logitech", batteryPercent: null }));
  assert.equal(logiMissing.find((result) => result.key === "brandWirelessBattery")?.status, "fail");
});

test("wireless-battery check is skipped when the device is wired", () => {
  const results = brandChecks(infoFor({ brand: "Razer", connectionType: "Wired", batteryPercent: null }));
  assert.equal(results.find((result) => result.key === "brandWirelessBattery")?.status, "skip");
});

test("Incott is exempt from the wireless-battery rule", () => {
  // incott-testing.md: the real battery arrives in an unsolicited input report
  // only after the mouse is used — battery null is legitimate.
  const results = brandChecks(infoFor({ brand: "Incott", batteryPercent: null, driverFamily: "incott" }));
  assert.ok(!keys(results).includes("brandWirelessBattery"));
  assert.equal(results.find((result) => result.key === "brandDeviceIdentity")?.status, "pass");
});

test("Incott identity must come from a device reply", () => {
  const weak = brandChecks(infoFor({ brand: "Incott", driverFamily: null, firmware: null }));
  assert.equal(weak.find((result) => result.key === "brandDeviceIdentity")?.status, "fail");
});

test("brands without a profile produce no brand checks", () => {
  assert.deepEqual(brandChecks(infoFor({ brand: "VAXEE", connectionType: "Wired" })), []);
});