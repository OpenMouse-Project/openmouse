import { SUPPORTED_DEVICES, type SupportedDevicesStatus } from "./supported-devices-data.ts";
import type { HardwareDeviceInfo } from "./hardware-test-report.ts";

export type ReportVerdict = "pass" | "fail" | "incomplete";

export interface SupportedDevicesCrosscheck {
  listed: boolean;
  status: SupportedDevicesStatus | null;
  label: string | null;
  matchedBy: "pid" | "name" | null;
  pageModel: string | null;
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

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

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
    // Prefer an exact model name before brand/status. Shared PIDs can map to
    // multiple Noir Gear models, so name avoids inheriting a sibling's status.
    const ranked = byPid.sort(
      (left, right) =>
        Number(normalize(right.model) === normalize(device.name ?? ""))
        - Number(normalize(left.model) === normalize(device.name ?? ""))
        || Number(brandMatches(right)) - Number(brandMatches(left))
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
