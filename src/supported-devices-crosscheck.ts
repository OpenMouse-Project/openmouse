// Crosschecks the device under test against the supported-devices page
// (src/supported-devices-data.ts, mirrored from openmouse.app/supported).
//
// Gives the shared hardware-test report the page-side context the certification
// flow needs: is the device listed, under what status, and does a passing run
// qualify it to move to "Supported"?
import { SUPPORTED_DEVICES, type SupportedDevicesStatus } from "./supported-devices-data.ts";
import type { HardwareDeviceInfo } from "./hardware-test-report.ts";

export type ReportVerdict = "pass" | "fail" | "incomplete";

export interface SupportedDevicesCrosscheck {
  /** True when the device matches a row on the supported-devices page. */
  listed: boolean;
  /** The page status of the matched row (label in human terms). */
  status: SupportedDevicesStatus | null;
  /** Human label for the page status (e.g. "Test Needed"). */
  label: string | null;
  /** How the row was found: by product id, by brand+model name, or not found. */
  matchedBy: "pid" | "name" | null;
  /** The page model text of the matched row (e.g. "F1 Ultimate"). */
  pageModel: string | null;
  /** One-line sentence for the terminal, the report card, and the Discord embed. */
  detail: string;
}

const STATUS_LABEL: Record<SupportedDevicesStatus, string> = {
  supported: "Supported",
  pr: "PR pending",
  quickwin: "Quick Win",
  likely: "Test Needed",
  driver: "Driver Needed",
  unknown: "Unknown",
  bridge: "Needs Bridge",
  pending: "Requested",
};

/** Status precedence used to pick a row when several match the same device. */
const STATUS_ORDER: Record<SupportedDevicesStatus, number> = {
  supported: 0,
  pr: 1,
  quickwin: 2,
  likely: 3,
  driver: 4,
  unknown: 5,
  bridge: 6,
  pending: 7,
};

/** Lowercase alphanumerics only, so "F1 Ultimate" matches "f1ultimate". */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Looks the connected device up in the supported-devices table and phrases the
 * page-side outcome for the report. PID matches are preferred (they are the
 * page's most precise key) with the brand used to break ties; when the table
 * does not pin PIDs for the model, a brand+model name match is the fallback.
 */
export function crosscheckSupportedDevices(
  device: HardwareDeviceInfo,
  verdict: ReportVerdict,
): SupportedDevicesCrosscheck {
  const notListed = (detail: string): SupportedDevicesCrosscheck => ({
    listed: false,
    status: null,
    label: null,
    matchedBy: null,
    pageModel: null,
    detail,
  });

  if (!device.present) return notListed("no device connected — supported-devices crosscheck skipped");

  const byPid =
    device.productId === null
      ? []
      : SUPPORTED_DEVICES.filter((entry) => entry.pids?.includes(device.productId ?? -1));
  const brandMatches = (entry: { brand: string }): boolean =>
    device.brand !== null && normalize(entry.brand) === normalize(device.brand);

  let match: { brand: string; model: string; status: SupportedDevicesStatus } | null = null;
  let matchedBy: "pid" | "name" | null = null;

  if (byPid.length > 0) {
    matchedBy = "pid";
    // Prefer rows whose brand matches the connected device; otherwise take the
    // most upstream status among the PID rows (a PID shared across models, as
    // with Incott, reports the best-known status).
    const ranked = byPid.sort(
      (left, right) =>
        Number(brandMatches(right)) - Number(brandMatches(left))
        || STATUS_ORDER[left.status] - STATUS_ORDER[right.status],
    );
    match = ranked[0] ?? null;
  }

  if (!match && device.brand !== null && device.name !== null) {
    const brandNorm = normalize(device.brand);
    const nameNorm = normalize(device.name);
    const byName = SUPPORTED_DEVICES.filter((entry) => {
      if (normalize(entry.brand) !== brandNorm) return false;
      const modelNorm = normalize(entry.model);
      return modelNorm === nameNorm || modelNorm.includes(nameNorm) || nameNorm.includes(modelNorm);
    });
    if (byName.length > 0) {
      matchedBy = "name";
      // The exact normalized model beats a partial one; then the most specific
      // (longest) model text; then the best status.
      const ranked = byName.sort(
        (left, right) =>
          Number(normalize(right.model) === nameNorm) - Number(normalize(left.model) === nameNorm)
          || normalize(right.model).length - normalize(left.model).length
          || STATUS_ORDER[left.status] - STATUS_ORDER[right.status],
      );
      match = ranked[0] ?? null;
    }
  }

  if (!match) return notListed("not listed on the supported-devices page");

  const label = STATUS_LABEL[match.status];
  const model = match.model;
  let detail: string;
  if (match.status === "supported") {
    detail = `already listed as Supported on the supported-devices page — no update needed.`;
  } else if (verdict === "pass") {
    detail = `listed as ${label} on the supported-devices page — this passing verification supports moving it to Supported.`;
  } else {
    detail = `listed as ${label} on the supported-devices page — this run did not pass, keep the status as-is.`;
  }

  return { listed: true, status: match.status, label, matchedBy, pageModel: model, detail };
}