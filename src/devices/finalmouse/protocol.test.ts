import assert from "node:assert/strict";
import test from "node:test";
import { FinalmouseHidClient } from "./hid.ts";
import {
  buildFinalmouseReport,
  decodeFinalmouseReport,
  finalmouseBatteryPercent,
  FINALMOUSE_REPORT,
} from "@openmouse/protocol/finalmouse";

function input(command: number, payload: number[]): Uint8Array {
  return new Uint8Array([2 + payload.length, command, payload.length, ...payload]);
}

test("Finalmouse writes use xpanel report framing without duplicating the WebHID report ID", () => {
  const report = buildFinalmouseReport(17, new Uint8Array([0x40, 0x1f]));
  assert.equal(report.length, 63);
  assert.deepEqual([...report.slice(0, 6)], [4, 0x91, 2, 0x40, 0x1f, 0]);
});

test("Finalmouse status reports decode settings, signed RSSI, and terminated firmware strings", () => {
  assert.deepEqual(decodeFinalmouseReport(FINALMOUSE_REPORT.mainInput, input(3, [0x40, 0x06])), { dpi: 1600 });
  assert.deepEqual(decodeFinalmouseReport(FINALMOUSE_REPORT.mainInput, input(4, [0x40, 0x1f])), { pollingRateHz: 8000 });
  assert.deepEqual(decodeFinalmouseReport(FINALMOUSE_REPORT.mainInput, input(13, [0xc9])), { rssiDbm: -55 });
  assert.deepEqual(decodeFinalmouseReport(FINALMOUSE_REPORT.mainInput, input(18, [1])), { motionSync: true });
  assert.deepEqual(decodeFinalmouseReport(FINALMOUSE_REPORT.mainInput, input(21, [2])), { liftOffDistanceMm: 2 });
  assert.deepEqual(decodeFinalmouseReport(FINALMOUSE_REPORT.mainInput, input(24, [15])), { tournamentScrollTimeoutMs: 1500 });
  assert.deepEqual(decodeFinalmouseReport(FINALMOUSE_REPORT.mainInput, input(12, [49, 46, 50, 46, 51, 0])), { mouseFirmware: "1.2.3" });
});

test("Finalmouse battery conversion preserves xpanel calibration points", () => {
  assert.equal(finalmouseBatteryPercent(3000), 0);
  assert.equal(finalmouseBatteryPercent(3880), 50);
  assert.equal(finalmouseBatteryPercent(4276), 88);
  assert.equal(finalmouseBatteryPercent(4380), 100);
});

test("Finalmouse selects only the ULX vendor control collection", () => {
  const control = {
    vendorId: 0x361d,
    productId: 0x0100,
    collections: [{ usagePage: 0xff00, usage: 1 }],
  } as HIDDevice;
  const ordinaryMouse = {
    ...control,
    collections: [{ usagePage: 1, usage: 2 }],
  } as HIDDevice;
  assert.equal(FinalmouseHidClient.isSupported(control), true);
  assert.equal(FinalmouseHidClient.isSupported(ordinaryMouse), false);
  assert.equal(new FinalmouseHidClient(control).displayName(), "Finalmouse UltralightX");
});

test("Finalmouse settings use the main control report and little-endian values", async () => {
  const writes: Array<{ reportId: number; bytes: number[] }> = [];
  let opened = false;
  const device = {
    vendorId: 0x361d,
    productId: 0x0100,
    productName: "Finalmouse ULX",
    collections: [{ usagePage: 0xff00, usage: 1 }],
    get opened() { return opened; },
    async open() { opened = true; },
    async close() { opened = false; },
    addEventListener() {},
    removeEventListener() {},
    async sendReport(reportId: number, data: BufferSource) {
      const bytes = data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      writes.push({ reportId, bytes: [...bytes.slice(0, 5)] });
    },
  } as unknown as HIDDevice;
  const client = new FinalmouseHidClient(device);

  await client.setDpi(1600);
  await client.setPollingRate(8000);
  await client.setMotionSync(true);

  assert.deepEqual(writes, [
    { reportId: FINALMOUSE_REPORT.main, bytes: [4, 0x90, 2, 0x40, 0x06] },
    { reportId: FINALMOUSE_REPORT.main, bytes: [4, 0x91, 2, 0x40, 0x1f] },
    { reportId: FINALMOUSE_REPORT.main, bytes: [3, 0x92, 1, 1, 0] },
  ]);
});
