import assert from "node:assert/strict";
import test from "node:test";

import { RAZER_READ, encodeRazerRequest, razerSetDpiCommand, razerSetLegacyPollingCommand } from "./protocol.ts";
import {
  VIPER_MINI_DPI_READ,
  VIPER_MINI_PRODUCT_ID,
  VIPER_MINI_TRANSACTION_ID,
  RazerViperMiniHidClient,
} from "./viper-mini-hid.ts";

test("Viper Mini requests use the legacy 0xFF transaction id", () => {
  const packet = encodeRazerRequest(RAZER_READ.firmware, VIPER_MINI_TRANSACTION_ID);

  assert.equal(packet[1], 0xff);
  assert.equal(packet[6], 0x00);
  assert.equal(packet[7], 0x81);
});

test("Viper Mini DPI read uses the no-store byte openrazer pairs with writes", () => {
  const packet = encodeRazerRequest(VIPER_MINI_DPI_READ, VIPER_MINI_TRANSACTION_ID);

  assert.equal(packet[6], 0x04);
  assert.equal(packet[7], 0x85);
  assert.equal(packet[8], 0x00);
});

test("Viper Mini DPI write carries the storage byte and reads back through no-store", () => {
  const write = encodeRazerRequest(razerSetDpiCommand(1600, 800), VIPER_MINI_TRANSACTION_ID);
  const read = encodeRazerRequest(VIPER_MINI_DPI_READ, VIPER_MINI_TRANSACTION_ID);

  assert.deepEqual([...write.slice(8, 15)], [0x01, 0x06, 0x40, 0x03, 0x20, 0x00, 0x00]);
  assert.equal(read[8], 0x00);
});

test("Viper Mini polling writes the legacy divisor of 1000", () => {
  const packet = encodeRazerRequest(razerSetLegacyPollingCommand(500), VIPER_MINI_TRANSACTION_ID);

  assert.equal(packet[1], 0xff);
  assert.deepEqual([packet[6], packet[7], packet[8]], [0x00, 0x05, 2]);
});

test("Viper Mini accepts only its own PID on a single Generic Desktop Mouse collection", () => {
  const control = {
    vendorId: 0x1532,
    productId: VIPER_MINI_PRODUCT_ID,
    collections: [{ usagePage: 0x01, usage: 0x02, featureReports: [], children: [] }],
  } as unknown as HIDDevice;
  const wrongPid = { ...control, productId: 0x00c0 } as unknown as HIDDevice;
  const extraCollection = {
    ...control,
    collections: [
      { usagePage: 0x01, usage: 0x02, featureReports: [], children: [] },
      { usagePage: 0x01, usage: 0x06, featureReports: [], children: [] },
    ],
  } as unknown as HIDDevice;

  assert.equal(RazerViperMiniHidClient.isSupported(control), true);
  assert.equal(RazerViperMiniHidClient.isSupported(wrongPid), false);
  assert.equal(RazerViperMiniHidClient.isSupported(extraCollection), false);
});
