import assert from "node:assert/strict";
import test from "node:test";

import { RAZER_READ, encodeRazerRequest, razerSetDpiCommand, razerSetLegacyPollingCommand } from "@openmouse/protocol/razer";
import {
  VIPER_DPI_READ,
  VIPER_PRODUCT_ID,
  VIPER_TRANSACTION_ID,
  RazerViperHidClient,
} from "./viper-hid.ts";

test("Viper requests use the legacy 0xFF transaction id", () => {
  const packet = encodeRazerRequest(RAZER_READ.firmware, VIPER_TRANSACTION_ID);

  assert.equal(packet[1], 0xff);
  assert.equal(packet[6], 0x00);
  assert.equal(packet[7], 0x81);
});

test("Viper DPI read uses the no-store byte openrazer pairs with writes", () => {
  const packet = encodeRazerRequest(VIPER_DPI_READ, VIPER_TRANSACTION_ID);

  assert.equal(packet[6], 0x04);
  assert.equal(packet[7], 0x85);
  assert.equal(packet[8], 0x00);
});

test("Viper DPI write carries the storage byte and reads back through no-store", () => {
  const write = encodeRazerRequest(razerSetDpiCommand(1600, 800), VIPER_TRANSACTION_ID);
  const read = encodeRazerRequest(VIPER_DPI_READ, VIPER_TRANSACTION_ID);

  assert.deepEqual([...write.slice(8, 15)], [0x01, 0x06, 0x40, 0x03, 0x20, 0x00, 0x00]);
  assert.equal(read[8], 0x00);
});

test("Viper polling writes the legacy divisor of 1000", () => {
  const packet = encodeRazerRequest(razerSetLegacyPollingCommand(500), VIPER_TRANSACTION_ID);

  assert.equal(packet[1], 0xff);
  assert.deepEqual([packet[6], packet[7], packet[8]], [0x00, 0x05, 2]);
});

test("Viper accepts only its own PID on a single Generic Desktop Mouse collection", () => {
  const control = {
    vendorId: 0x1532,
    productId: VIPER_PRODUCT_ID,
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

  assert.equal(RazerViperHidClient.isSupported(control), true);
  assert.equal(RazerViperHidClient.isSupported(wrongPid), false);
  assert.equal(RazerViperHidClient.isSupported(extraCollection), false);
});
