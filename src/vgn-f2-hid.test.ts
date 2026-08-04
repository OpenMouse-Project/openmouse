import assert from "node:assert/strict";
import test from "node:test";

import { VgnF2HidClient } from "./vgn-f2-hid.ts";

function device(productId: number, reportId = 0x08, reportCount = 16): HIDDevice {
  return {
    vendorId: 0x3554,
    productId,
    productName: "Dragonfly F2 Master+",
    collections: [{
      usagePage: 0xff02,
      usage: 2,
      children: [],
      featureReports: [],
      inputReports: [{ reportId, items: [{ reportCount, reportSize: 8 }] }],
      outputReports: [{ reportId, items: [{ reportCount, reportSize: 8 }] }],
    }],
  } as unknown as HIDDevice;
}

test("support is limited to the captured F2 Master+ transports and report shape", () => {
  // Arrange
  const receiver = device(0xfb56);
  const wired = device(0xfb57);
  const wrongPid = device(0xf58a);
  const wrongReport = device(0xfb56, 0x09, 48);

  // Act / Assert
  assert.equal(VgnF2HidClient.isSupported(receiver), true);
  assert.equal(VgnF2HidClient.isSupported(wired), true);
  assert.equal(VgnF2HidClient.isSupported(wrongPid), false);
  assert.equal(VgnF2HidClient.isSupported(wrongReport), false);
});

test("transport metadata distinguishes receiver from cable", () => {
  // Arrange / Act
  const receiver = new VgnF2HidClient(device(0xfb56));
  const wired = new VgnF2HidClient(device(0xfb57));

  // Assert
  assert.equal(receiver.isWirelessPath(), true);
  assert.equal(wired.isWirelessPath(), false);
});