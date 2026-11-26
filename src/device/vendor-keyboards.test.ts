import assert from "node:assert/strict";
import test from "node:test";
import { createKeyboardClient, createSupportedClient, listLogicalDevices } from "./device-clients.ts";
import { HID_FILTERS } from "./hid-filters.ts";
import { availableKeyboardWorkspaceTabs } from "../features/devices/workspace-tabs.ts";

function device(vendorId: number, productId: number, usagePage: number, usage: number): HIDDevice {
  return { vendorId, productId, productName: "Keyboard", opened: false,
    collections: [{ usagePage, usage, inputReports: [], outputReports: [], featureReports: [], children: [] }],
  } as unknown as HIDDevice;
}

for (const [brand, vendorId, productId, usagePage, usage] of [
  ["razer", 0x1532, 0x02a6, 0x0001, 0x0002],
  ["logitech", 0x046d, 0xc352, 0xff00, 0x0002],
  ["steelseries", 0x1038, 0x1628, 0xffc0, 0x0001],
] as const) {
  test(`${brand} command collection routes to a keyboard rather than a mouse`, async () => {
    const config = device(vendorId, productId, usagePage, usage);
    const boot = device(vendorId, productId, 0x0001, 0x0006);
    assert.equal(createKeyboardClient(config)?.family, brand);
    assert.equal(await createSupportedClient(config), null);
    assert.equal(createKeyboardClient(boot), null);
    assert.deepEqual(await listLogicalDevices([boot, config]), [config]);
    assert.ok(HID_FILTERS.some(filter => filter.vendorId === vendorId && filter.productId === productId
      && filter.usagePage === usagePage && filter.usage === usage));
    assert.ok(availableKeyboardWorkspaceTabs(brand).includes("overview"));
  });
}

test("Razer and Logitech mice cannot acquire keyboard controls from a shared HID collection", () => {
  assert.equal(createKeyboardClient(device(0x1532, 0x00c1, 0x0001, 0x0002)), null);
  assert.equal(createKeyboardClient(device(0x046d, 0xc094, 0xff00, 0x0002)), null);
});
