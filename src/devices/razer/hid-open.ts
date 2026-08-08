const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

const MACOS_INPUT_MONITORING_HINT =
  "On macOS the browser is refused access to mouse-class HID interfaces unless it"
  + " has Input Monitoring permission. Enable it in System Settings → Privacy &"
  + " Security → Input Monitoring, then quit and reopen the browser.";

/**
 * Opens a Razer control interface, and turns the browser's bare "Failed to open
 * the device." on macOS into an actionable message.
 *
 * Razer's configuration channel lives on a Generic Desktop Mouse collection,
 * which macOS reserves for its own input stack: without the Input Monitoring
 * TCC permission the browser's `IOHIDDeviceOpen` call fails with
 * `kIOReturnNotPermitted`, which WebHID surfaces as a generic NotAllowedError.
 * Nothing in the app can grant that — it is a system permission on the browser
 * itself — so the hint is the whole fix.
 */
export async function openRazerDevice(device: HIDDevice): Promise<void> {
  if (device.opened) return;
  try {
    await device.open();
  } catch (error) {
    if (IS_MAC && error instanceof Error) {
      throw new Error(`${error.message} ${MACOS_INPUT_MONITORING_HINT}`);
    }
    throw error;
  }
}
