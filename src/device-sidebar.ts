import { createSupportedClient, deviceBrand, listLogicalDevices } from "./device-clients";
import { EGG_WE_DISPLAY_NAME, isEggWeClient } from "./devices/endgame/egg-we-control";
import { escapeHtml } from "./dom";
import type { MouseStatus } from "./devices/mouse-types";

export function renderDeviceSidebar(
  devices: HIDDevice[],
  deviceStatuses: ReadonlyMap<HIDDevice, MouseStatus>,
  activeDevice: HIDDevice | null,
): void {
  const list = document.querySelector<HTMLElement>("#sidebar-device-list");
  if (!list) return;
  const supportedDevices = listLogicalDevices(devices);
  if (supportedDevices.length === 0) {
    list.innerHTML = `<div class="device-select"><span class="device-dot is-idle"></span><span><strong>No device connected</strong><small>Choose a supported device</small></span></div>`;
    return;
  }
  list.innerHTML = supportedDevices.map((device, index) => {
    const client = createSupportedClient(device)!;
    const status = deviceStatuses.get(device);
    const selected = device === activeDevice;
    const name = status?.name
      ?? status?.ui?.defaultDisplayName
      ?? (isEggWeClient(client) ? EGG_WE_DISPLAY_NAME : (device.productName ?? `${deviceBrand(client)} mouse`));
    const detail = status
      ? `${status.brand} · ${status.connectionType ?? "Connected"}`
      : `${deviceBrand(client)} · Available`;
    return `<button class="device-select${selected ? " is-selected" : ""}" type="button" data-device-index="${index}" aria-pressed="${selected}">
      <span class="device-dot${selected ? "" : " is-idle"}"></span>
      <span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></span>
    </button>`;
  }).join("");
}
