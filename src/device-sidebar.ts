import { createSupportedClient, deviceBrand, listLogicalDevices } from "./device-clients";
import { EGG_WE_DISPLAY_NAME, isEggWeClient } from "@openmouse/protocol/drivers/endgame/egg-we-control";
import { FinalmouseHidClient } from "@openmouse/protocol/drivers/finalmouse/hid";
import { escapeHtml } from "./ui/dom";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";

export function renderDeviceSidebar(
  devices: HIDDevice[],
  deviceStatuses: ReadonlyMap<HIDDevice, MouseStatus>,
  activeDevice: HIDDevice | null,
): void {
  const list = document.querySelector<HTMLElement>("#sidebar-device-list");
  if (!list) return;
  const supportedDevices = listLogicalDevices(devices);
  if (supportedDevices.length === 0) {
    list.innerHTML = "";
    return;
  }

  const entries = supportedDevices.map((device, index) => {
    const client = createSupportedClient(device)!;
    const status = deviceStatuses.get(device);
    const selected = device === activeDevice;
    const name = status?.name
      ?? status?.ui?.defaultDisplayName
      ?? (isEggWeClient(client)
        ? EGG_WE_DISPLAY_NAME
        : client instanceof FinalmouseHidClient
          ? client.displayName()
          : (device.productName ?? `${deviceBrand(client)} mouse`));
    const detail = status
      ? `${status.brand} · ${status.connectionType ?? "Connected"}`
      : `${deviceBrand(client)} · Available`;
    return { index, name, detail, selected };
  });
  list.innerHTML = entries.map((entry) => `<button type="button" class="device-row${entry.selected ? " is-selected" : ""}" data-device-index="${entry.index}" aria-current="${entry.selected}">
    <span class="device-dot${entry.selected ? "" : " is-idle"}"></span>
    <span class="device-row-copy">
      <strong>${escapeHtml(entry.name)}</strong>
      <small>${escapeHtml(entry.detail)}</small>
    </span>
  </button>`).join("");
}
