// Brand-specific hardware verification checks.
//
// The generic suite (`hardware-test-report.ts`) runs on every connected model;
// these checks add the per-brand invariants the `mouse-protocol`
// `docs/*-testing.md` checklists rely on for moving a "test-needed" model to
// "supported". Every rule here is grounded in a documented behavior of the
// brand's driver — see the doc references inline.
import type { HardwareDeviceInfo, HardwareTestResult } from "./hardware-test-report";

/**
 * Brands whose wireless products (receiver or 2.4 GHz connection) report a live
 * battery level through the settings channel. Grounded in:
 *   - `atk-testing.md` — ATK battery response `5f 01` reporting 95%;
 *   - `razer-testing.md` — receivers report battery while the mouse is linked;
 *   - `logitech-testing.md` — confirm battery percentage and charging state on
 *     the wireless connection;
 *   - `moddo-testing.md` — "battery (wireless)" in the checklist.
 * Incott is deliberately excluded: `incott-testing.md` documents that the real
 * battery level only arrives in an unsolicited input report after the mouse is
 * used, so a freshly connected Incott may legitimately report battery `null`.
 */
const WIRELESS_BATTERY_BRANDS = new Set([
  "ATK",
  "VXE",
  "VGN",
  "Razer",
  "SteelSeries",
  "Glorious",
  "MCHOSE",
  "Logitech",
  "Endgame Gear",
  "Corsair",
  "Pulsar",
  "Lamzu",
  "moddoMOUSE",
  "WALLHACK",
  "Attack Shark",
  "IPI",
]);

/**
 * Brands whose driver exposes receiver/pairing telemetry on the wireless
 * connection (`atkReceiver`). `atk-testing.md` describes the VXE R1 SE+ and ATK
 * receiver telemetry being read over the wireless link; an offline receiver
 * ("a sleeping wireless mouse may not answer") is not a settled connection.
 */
const RECEIVER_TELEMETRY_BRANDS = new Set(["ATK", "VXE", "VGN"]);

/**
 * Brands whose identity is derived from a device reply rather than the USB
 * descriptor — a shared family of receivers must be identified by querying the
 * mouse itself. `incott-testing.md`: a shared transceiver that does not answer
 * fails before using the fallback codec.
 */
const DEVICE_IDENTITY_BRANDS = new Set(["Incott"]);

/** Per-brand checks the generic suite does not cover. */
export function brandChecks(info: HardwareDeviceInfo): HardwareTestResult[] {
  if (!info.present) return [];

  const results: HardwareTestResult[] = [];
  const wireless = info.connectionType === "Wireless";
  const brand = info.brand ?? "";

  if (RECEIVER_TELEMETRY_BRANDS.has(brand)) {
    if (!wireless) {
      results.push({ key: "brandReceiverTelemetry", label: `${brand} receiver telemetry`, status: "skip", detail: null });
    } else if (info.receiverOnline === null || info.receiverRfId == null || info.receiverRfId === "") {
      results.push({
        key: "brandReceiverTelemetry",
        label: `${brand} receiver telemetry`,
        status: "fail",
        detail: "wireless connection without receiver online/RF telemetry — the receiver link was not confirmed.",
      });
    } else if (info.pairingInProgress) {
      results.push({
        key: "brandReceiverTelemetry",
        label: `${brand} receiver telemetry`,
        status: "fail",
        detail: "receiver is inside a pairing session — not a settled wireless connection.",
      });
    } else if (info.receiverOnline === true) {
      results.push({
        key: "brandReceiverTelemetry",
        label: `${brand} receiver telemetry`,
        status: "pass",
        detail: `mouse online on RF ${info.receiverRfId}`,
      });
    } else {
      results.push({
        key: "brandReceiverTelemetry",
        label: `${brand} receiver telemetry`,
        status: "fail",
        detail: "the receiver reports the mouse offline.",
      });
    }
  }

  if (WIRELESS_BATTERY_BRANDS.has(brand)) {
    if (!wireless) {
      results.push({ key: "brandWirelessBattery", label: `${brand} wireless battery`, status: "skip", detail: null });
    } else if (info.batteryPercent === null) {
      results.push({
        key: "brandWirelessBattery",
        label: `${brand} wireless battery`,
        status: "fail",
        detail: "this brand reports battery on the wireless link — none was read.",
      });
    } else {
      results.push({
        key: "brandWirelessBattery",
        label: `${brand} wireless battery`,
        status: "pass",
        detail: `${info.batteryPercent}%`,
      });
    }
  }

  if (DEVICE_IDENTITY_BRANDS.has(brand)) {
    if (info.driverFamily !== null && info.firmware !== null) {
      results.push({
        key: "brandDeviceIdentity",
        label: `${brand} device identity`,
        status: "pass",
        detail: `model identified from the device reply (${info.driverFamily}, FW ${info.firmware.join(", ")})`,
      });
    } else {
      results.push({
        key: "brandDeviceIdentity",
        label: `${brand} device identity`,
        status: "fail",
        detail: "the model was not identified from a device reply — a fallback codec may be in use.",
      });
    }
  }

  return results;
}