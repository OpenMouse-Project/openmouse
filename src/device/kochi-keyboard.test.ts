import assert from "node:assert/strict";
import test from "node:test";
import { KochiKeyboardClient } from "./kochi-keyboard.ts";
import { createKeyboardClient, createSupportedClient, listLogicalDevices } from "./device-clients.ts";
import { HID_FILTERS } from "./hid-filters.ts";

function device(usagePage = 0xffa0, usage = 1): HIDDevice {
  return { vendorId: 0x1ca2, productId: 0x0901, productName: "KOCHI68 Keyboard", opened: false,
    collections: [{ usagePage, usage, inputReports: [], outputReports: [], featureReports: [], children: [] }],
  } as unknown as HIDDevice;
}

test("HB68 is discovered as a keyboard and only its command collection is offered", () => {
  const config = device(); const boot = device(1, 6); const stream = device(0xffa0, 2);
  assert.ok(createKeyboardClient(config) instanceof KochiKeyboardClient);
  assert.equal(createSupportedClient(config), null);
  assert.equal(createKeyboardClient(boot), null);
  assert.equal(createKeyboardClient(stream), null);
  assert.deepEqual(listLogicalDevices([boot, stream, config]), [config]);
  assert.ok(HID_FILTERS.some(f => f.vendorId === 0x1ca2 && f.productId === 0x0901 && f.usagePage === 0xffa0 && f.usage === 1));
});

test("HB68 rejects unrelated workspace commands and invalid modes before USB access", async () => {
  const client = new KochiKeyboardClient(device());
  await assert.rejects(client.command({ kind: "sleep", value: 30 }), /Windows\/Mac mode only/);
  await assert.rejects(client.command({ kind: "save", scope: "all" }), /Windows\/Mac mode only/);
  await assert.rejects(client.command({ kind: "system", value: 2 }), RangeError);
  assert.equal("readTrigger" in client, false);
  assert.equal("setPollingRate" in client, false);
});
