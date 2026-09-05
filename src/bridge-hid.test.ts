import assert from "node:assert/strict";
import { test } from "node:test";

import { bridgeHid, type BridgeTransport } from "./bridge-hid.ts";

interface Fake {
  transport: BridgeTransport;
  sent: Record<string, unknown>[];
  reply: (frame: Record<string, unknown>) => void;
}

function fakeTransport(): Fake {
  const sent: Record<string, unknown>[] = [];
  const transport: BridgeTransport = {
    send: (frame) => void sent.push(JSON.parse(frame) as Record<string, unknown>),
    close: () => undefined,
    onMessage: null,
    onClose: null,
  };
  return {
    transport,
    sent,
    reply: (frame) => transport.onMessage?.(JSON.stringify(frame)),
  };
}

const MOUSE = {
  key: "3554:f58c:1",
  vendorId: 0x3554,
  productId: 0xf58c,
  productName: "Pulsar X2",
  collections: [{ usagePage: 0xff00, usage: 1, inputReports: [{ reportId: 8, items: [] }], outputReports: [], featureReports: [], children: [] }],
};

test("drives a device end to end over the socket", async () => {
  const fake = fakeTransport();
  const hid = bridgeHid(fake.transport);

  const listing = hid.getDevices();
  assert.equal(fake.sent[0].type, "list");
  assert.ok(Array.isArray(fake.sent[0].vendorIds) && (fake.sent[0].vendorIds as number[]).length > 0);
  fake.reply({ id: fake.sent[0].id, ok: true, devices: [MOUSE] });

  const [device] = await listing;
  assert.equal(device.productName, "Pulsar X2");
  assert.equal(device.collections[0].inputReports[0].reportId, 8);
  assert.equal(device.opened, false);

  const opening = device.open();
  assert.deepEqual({ ...fake.sent[1] }, { id: fake.sent[1].id, type: "open", device: MOUSE.key });
  fake.reply({ id: fake.sent[1].id, ok: true });
  await opening;
  assert.equal(device.opened, true);

  const sending = device.sendReport(8, new Uint8Array([1, 2, 3]));
  assert.equal(fake.sent[2].type, "sendReport");
  assert.equal(fake.sent[2].reportId, 8);
  assert.deepEqual(fake.sent[2].data, [1, 2, 3]);
  fake.reply({ id: fake.sent[2].id, ok: true });
  await sending;

  const reports: number[][] = [];
  device.addEventListener("inputreport", (event) => {
    reports.push([event.reportId, event.data.byteLength, event.data.getUint8(0)]);
  });
  fake.reply({ type: "inputreport", device: MOUSE.key, reportId: 8, data: [42, 7] });
  assert.deepEqual(reports, [[8, 2, 42]]);

  const feature = device.receiveFeatureReport(5);
  fake.reply({ id: fake.sent[3].id, ok: true, data: [9, 9] });
  assert.equal((await feature).getUint8(1), 9);

  // Stops the enumeration poll, which would otherwise hold the test open.
  fake.transport.onClose?.();
});

test("a rejected request surfaces the reason Bridge gave", async () => {
  const fake = fakeTransport();
  const hid = bridgeHid(fake.transport);

  const listing = hid.getDevices();
  fake.reply({ id: fake.sent[0].id, ok: false, error: "no interface answered" });

  await assert.rejects(listing, /no interface answered/);
  fake.transport.onClose?.();
});

test("re-enumeration keeps device identity and reports hot-plug both ways", async () => {
  const fake = fakeTransport();
  const hid = bridgeHid(fake.transport);
  const events: string[] = [];
  hid.addEventListener("connect", (event) => void events.push(`connect:${event.device.productName}`));
  hid.addEventListener("disconnect", (event) => void events.push(`disconnect:${event.device.productName}`));

  const first = hid.getDevices();
  fake.reply({ id: fake.sent[0].id, ok: true, devices: [MOUSE] });
  const [device] = await first;

  const second = hid.getDevices();
  fake.reply({ id: fake.sent[1].id, ok: true, devices: [MOUSE] });
  const [again] = await second;
  assert.equal(again, device, "the same physical device must stay the same object");

  const third = hid.getDevices();
  fake.reply({ id: fake.sent[2].id, ok: true, devices: [] });
  assert.deepEqual(await third, []);

  assert.deepEqual(events, ["connect:Pulsar X2", "disconnect:Pulsar X2"]);
  fake.transport.onClose?.();
});

test("a dropped socket closes every device and rejects what was in flight", async () => {
  const fake = fakeTransport();
  const hid = bridgeHid(fake.transport);

  const listing = hid.getDevices();
  fake.reply({ id: fake.sent[0].id, ok: true, devices: [MOUSE] });
  const [device] = await listing;
  const opening = device.open();
  fake.reply({ id: fake.sent[1].id, ok: true });
  await opening;

  const pending = device.receiveFeatureReport(5);
  fake.transport.onClose?.();

  await assert.rejects(pending, /disconnected/);
  assert.equal(device.opened, false);
});
