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
    list.innerHTML = `<div class="device-dropdown is-empty"><span class="device-dot is-idle"></span><span class="device-dropdown-copy"><select id="sidebar-device-select" aria-label="Connected device" disabled><option>No device connected</option></select><small id="sidebar-device-detail">Choose a supported device</small></span></div>`;
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
  const selectedEntry = entries.find((entry) => entry.selected);
  const options = [
    ...(selectedEntry ? [] : [`<option value="" selected>Select a device</option>`]),
    ...entries.map((entry) => `<option value="${entry.index}"${entry.selected ? " selected" : ""}>${escapeHtml(entry.name)}</option>`),
  ].join("");
  list.innerHTML = `<div class="device-dropdown${selectedEntry ? " is-selected" : ""}">
    <span class="device-dot${selectedEntry ? "" : " is-idle"}"></span>
    <span class="device-dropdown-copy">
      <select id="sidebar-device-select" aria-label="Connected device">${options}</select>
      <small id="sidebar-device-detail">${escapeHtml(selectedEntry?.detail ?? `${entries.length} authorized ${entries.length === 1 ? "device" : "devices"}`)}</small>
    </span>
  </div>`;
}
