import assert from "node:assert/strict";
import test from "node:test";

import { WLMouseHidClient } from "./hid.ts";
import { VENDOR_ID } from "../vendors.ts";

const globals = globalThis as { window?: { setTimeout: typeof setTimeout } };
globals.window ??= { setTimeout };

function fakeDevice(offset: number, sleepingReplies = 0) {
  const sent: Uint8Array[] = [];
  const device = {
    vendorId: VENDOR_ID.wlmouse,
    productId: 0xa863,
    productName: "Huan",
    opened: true,
    collections: [],
    open: async () => {},
    close: async () => {},
    sendFeatureReport: async (_id: number, data: Uint8Array) => void sent.push(new Uint8Array(data)),
    receiveFeatureReport: async () => {
      const request = sent[sent.length - 1];
      const reply = new Uint8Array(64);
      if (sent.length <= sleepingReplies) {
        reply[offset] = 0xa0;
        return new DataView(reply.buffer);
      }
      const payload = request[4] === 0x01 && request[5] === 0x81
        ? [0x01, 0x01, 0x06, 0x40, 0x06, 0x40]
        : [0x01, 0x01];
      reply[offset] = 0xa1;
      reply[3 + offset] = payload.length;
      reply[4 + offset] = request[4];
      reply[5 + offset] = request[5];
      reply.set(payload, 6 + offset);
      return new DataView(reply.buffer);
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return { device: device as unknown as HIDDevice, sent };
}

for (const offset of [0, 1]) {
  test(`a reply shifted by ${offset} byte(s) is decoded`, async () => {
    const status = await new WLMouseHidClient(fakeDevice(offset).device).readStatus();
    assert.equal(status.dpi, 1600);
  });
}

test("a sleeping mouse gets the command re-sent", async () => {
  const { device, sent } = fakeDevice(1, 2);
  await new WLMouseHidClient(device).readStatus();
  assert.ok(sent.length > 3, `expected re-sends while asleep, saw ${sent.length}`);
});
