// Hardware-test reporting model.
//
// The Hardware Test page runs a verification suite against the connected
// mouse; its results are the evidence a maintainer uses to move a
// "test-needed" (likely) model on the Supported Devices page to "supported".
//
// The checks follow the project's hardware-verification process as defined in
// `mouse-protocol/docs/*-testing.md` and `CONTRIBUTING.md` ("Evidence and
// hardware verification"):
//
//   - Control interface — the driver's config collection answered: the model
//     name, connection type and firmware read back at all proves the
//     transaction id and the interface (Razer checklist).
//   - Flash / EEPROM read-back — every field the driver decodes from device
//     flash is present and in range.
//   - Wireless link — for a 2.4 GHz device the receiver/mouse connection is
//     exercised, including the online/pairing telemetry where the driver
//     exposes it (ATK receiver 0x03/0x06 telemetry).
//   - Flash write round-trip — a build setting is written, read back, then
//     restored (CONTRIBUTING: "verify writes by reading the value back").
//
// This module is the pure, testable part: device-info extraction from the
// snapshot, the automatic (driver read-back) checks, the overall verdict, and
// the Discord embed that the Share Report button posts through the existing
// `/api/feedback` relay.
import type { ControlSnapshot } from "./device/types";
import { formatHz } from "./ui/polling-stats.ts";
import type { SupportedDevicesCrosscheck } from "./supported-devices-crosscheck.ts";

export type HardwareTestStatus = "pass" | "fail" | "skip";

export interface HardwareTestResult {
  /** Stable machine key, e.g. "connection", "interface", "flashWrite". */
  key: string;
  label: string;
  status: HardwareTestStatus;
  detail: string | null;
}

export interface HardwareDeviceInfo {
  present: boolean;
  brand: string | null;
  name: string | null;
  vendorId: number | null;
  productId: number | null;
  productName: string | null;
  transport: "webhid" | "bridge" | null;
  connectionType: string | null;
  pollingRateHz: number | null;
  supportedPollingRates: readonly number[] | null;
  dpi: number | null;
  dpiStages: readonly number[] | null;
  activeDpiStage: number | null;
  batteryPercent: number | null;
  batteryState: string | null;
  firmware: string[] | null;
  liftOffDistance: string | null;
  driverFamily: string | null;
  deviceMode: string | null;
  /**
   * Usage-page / usage summary of the HID collections the browser exposes for
   * the connected device, gathered at run time by the page. Null when the
   * transport (Bridge) does not expose a WebHID descriptor.
   */
  collectionsSummary?: string | null;
  /** Live signal strength out of 100, when the driver reports link quality. */
  signalStrength?: number | null;
  /** Receiver online telemetry (ATK receiver): null when not exposed. */
  receiverOnline?: boolean | null;
  /** RF identifier from the receiver telemetry, when exposed. */
  receiverRfId?: string | null;
  /** True while the receiver is inside a pairing session. */
  pairingInProgress?: boolean;
}

export interface HardwareTestReport {
  device: HardwareDeviceInfo;
  results: HardwareTestResult[];
  verdict: "pass" | "fail" | "incomplete";
  durationMs: number;
  runAt: string;
  build: string;
  /**
   * What the supported-devices page (openmouse.app/supported) lists for this
   * device and whether this run's verdict qualifies it to move to "Supported".
   * Populated by the page at suite end; null before the suite runs.
   */
  supportedPage?: SupportedDevicesCrosscheck | null;
}

/** Tests that need the user to physically operate the mouse. */
export const INTERACTIVE_TEST_KEYS: ReadonlySet<string> = new Set(["sampling"]);

/**
 * Checks that are answered from the driver read-back and give granular detail,
 * but whose gate is the composite `flashRead` check (the flash/EEPROM
 * read-back). They stay in the report as evidence but do not individually gate
 * the certification verdict.
 */
export const INFORMATIONAL_TEST_KEYS: ReadonlySet<string> = new Set([
  "driver",
  "dpi",
  "pollingRead",
  "battery",
  "firmware",
  "liftOff",
  "dpiStages",
]);

/** Tests that must all pass for a model to be certified as supported. */
export const ESSENTIAL_TEST_KEYS: ReadonlySet<string> = new Set([
  "connection",
  "interface",
  "identity",
  "link",
  "flashRead",
  "flashWrite",
  ...INTERACTIVE_TEST_KEYS,
]);

export function formatHexId(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Extracts everything the suite needs to know about the connected device. */
export function deviceInfoFromSnapshot(snapshot: ControlSnapshot): HardwareDeviceInfo {
  const status = snapshot.status;
  const selected = snapshot.devices.find((device) => device.selected);
  const receiver = status?.atkReceiver;
  // Settings fields count only when the driver read them from the mouse. A
  // driver whose settings read failed (settingsReady: false) or that has no
  // read-back (valuesVerified: false) still fills them with defaults, so drop
  // them here and the read-back checks fail instead of passing on those.
  const settings = (status?.ui?.valuesVerified ?? status?.ui?.settingsReady !== false) ? status : null;
  return {
    present: status !== null,
    brand: status?.brand ?? null,
    name: status?.name ?? null,
    vendorId: selected?.vendorId ?? null,
    productId: selected?.productId ?? null,
    productName: selected?.name ?? null,
    transport: selected?.transport ?? null,
    connectionType: status?.connectionType ?? null,
    pollingRateHz: settings?.pollingRateHz ?? null,
    supportedPollingRates: status?.supportedPollingRates ?? null,
    dpi: settings?.dpi ?? null,
    dpiStages: settings?.dpiStages ?? null,
    activeDpiStage: settings?.activeDpiStage ?? null,
    batteryPercent: status?.batteryPercent ?? null,
    batteryState: status?.batteryState ?? null,
    firmware: status && status.firmware.length > 0 ? status.firmware : null,
    liftOffDistance: settings?.liftOffDistance ?? null,
    driverFamily: status?.ui?.family ?? null,
    deviceMode: status?.deviceMode ?? null,
    collectionsSummary: null,
    signalStrength: status?.signalStrength ?? null,
    receiverOnline: receiver != null ? receiver.online : null,
    receiverRfId: receiver?.rfId ?? null,
    pairingInProgress: receiver != null ? receiver.pairingStatus === 1 : false,
  };
}

const NO_DEVICE_DEFERRED: ReadonlyArray<[string, string]> = [
  ["interface", "Control interface"],
  ["identity", "Device identity"],
  ["driver", "Driver identification"],
  ["dpi", "DPI read-back"],
  ["pollingRead", "Polling rate read-back"],
  ["battery", "Battery read-back"],
  ["firmware", "Firmware read-back"],
  ["liftOff", "Lift-off read-back"],
  ["link", "Wireless link (receiver)"],
  ["flashRead", "Flash / EEPROM read-back"],
];

const LOD_VALUES = new Set(["Low", "Medium", "High"]);

/** The checks that are answered purely from the driver read-back. */
export function automaticChecks(info: HardwareDeviceInfo): HardwareTestResult[] {
  if (!info.present) {
    return [
      { key: "connection", label: "Device connected", status: "fail", detail: "No supported mouse is connected." },
      ...NO_DEVICE_DEFERRED.map(([key, label]) => ({ key, label, status: "skip" as const, detail: null as string | null })),
    ];
  }

  const results: HardwareTestResult[] = [];

  results.push({
    key: "connection",
    label: "Device connected",
    status: "pass",
    detail: info.transport === "bridge" ? "Connected through OpenMouse Bridge" : "Connected through WebHID",
  });

  // Control interface: a status read that produced the model name, connection
  // type and firmware proves the control collection and transaction id work.
  const interfaceOk = info.name !== null || info.brand !== null;
  results.push({
    key: "interface",
    label: "Control interface",
    status: interfaceOk ? "pass" : "fail",
    detail: interfaceOk
      ? info.collectionsSummary ?? "status read succeeded through the driver's control collection"
      : "No status read — the control interface did not answer.",
  });

  // Device identity: the mouse answered the identity query and reports firmware.
  const identityOk = info.name !== null;
  results.push({
    key: "identity",
    label: "Device identity",
    status: identityOk ? "pass" : "fail",
    detail: identityOk ? `${info.brand ?? ""} ${info.name}`.trim() : "The device did not answer the identity query.",
  });

  const driver = info.driverFamily ? `${info.brand ?? ""} ${info.driverFamily}`.trim() : (info.brand ?? null);
  results.push({
    key: "driver",
    label: "Driver identification",
    status: driver ? "pass" : "fail",
    detail: driver ?? "No driver produced a status read.",
  });

  const dpiOk = info.dpi !== null && info.dpi > 0 && info.dpi <= 30000;
  results.push({
    key: "dpi",
    label: "DPI read-back",
    status: dpiOk ? "pass" : "fail",
    detail: dpiOk ? `${info.dpi!.toLocaleString()} DPI` : info.dpi === null ? "The sensor DPI was not read from the device." : "Reported DPI is out of range.",
  });

  const rate = info.pollingRateHz;
  const supported = info.supportedPollingRates;
  if (rate !== null && rate > 0) {
    const inSet = !supported || supported.length === 0 || supported.includes(rate);
    results.push({
      key: "pollingRead",
      label: "Polling rate read-back",
      status: inSet ? "pass" : "fail",
      detail: inSet
        ? `${rate} Hz`
        : `${rate} Hz is not in the supported set (${supported.join(", ")} Hz).`,
    });
  } else {
    results.push({
      key: "pollingRead",
      label: "Polling rate read-back",
      status: "fail",
      detail: "The polling rate was not read from the device.",
    });
  }

  if (info.batteryPercent === null) {
    results.push({ key: "battery", label: "Battery read-back", status: "skip", detail: "Not reported by this device." });
  } else {
    const ok = info.batteryPercent >= 0 && info.batteryPercent <= 100;
    results.push({
      key: "battery",
      label: "Battery read-back",
      status: ok ? "pass" : "fail",
      detail: ok ? `${info.batteryPercent}%` : `Unreasonable value: ${info.batteryPercent}%.`,
    });
  }

  if (!info.firmware) {
    results.push({ key: "firmware", label: "Firmware read-back", status: "skip", detail: "Not reported by this device." });
  } else {
    results.push({ key: "firmware", label: "Firmware read-back", status: "pass", detail: info.firmware.join(", ") });
  }

  if (!info.liftOffDistance) {
    results.push({ key: "liftOff", label: "Lift-off read-back", status: "skip", detail: "Not reported by this device." });
  } else {
    results.push({ key: "liftOff", label: "Lift-off read-back", status: "pass", detail: info.liftOffDistance });
  }

  if (info.dpiStages && info.dpiStages.length > 0) {
    const allValid = info.dpiStages.every((value) => value > 0 && value <= 30000);
    results.push({
      key: "dpiStages",
      label: "DPI stages read-back",
      status: allValid ? "pass" : "fail",
      detail: allValid ? `${info.dpiStages.map((value) => value.toLocaleString()).join(", ")} DPI` : "A DPI stage is out of range.",
    });
  }

  // Wireless link — the "mouse receiving connection" test. Wired devices skip
  // it; for wireless ones the status read itself crossed the RF link, and
  // where the driver exposes receiver telemetry the link must be online.
  if (info.connectionType !== "Wireless") {
    results.push({ key: "link", label: "Wireless link (receiver)", status: "skip", detail: null });
  } else if (info.receiverOnline === null) {
    results.push({
      key: "link",
      label: "Wireless link (receiver)",
      status: "pass",
      detail: `driver read the wireless connection over the RF link${info.signalStrength != null ? ` · signal ${info.signalStrength}%` : ""}`,
    });
  } else if (info.receiverOnline === true && !info.pairingInProgress) {
    results.push({
      key: "link",
      label: "Wireless link (receiver)",
      status: "pass",
      detail: `mouse online on the receiver${info.receiverRfId ? ` (RF ${info.receiverRfId})` : ""}${info.signalStrength != null ? ` · signal ${info.signalStrength}%` : ""}`,
    });
  } else if (info.pairingInProgress) {
    results.push({
      key: "link",
      label: "Wireless link (receiver)",
      status: "fail",
      detail: "receiver is mid-pairing — not a settled wireless connection.",
    });
  } else {
    results.push({
      key: "link",
      label: "Wireless link (receiver)",
      status: "fail",
      detail: "the receiver reports the mouse offline — the wireless connection is not working.",
    });
  }

  // Flash / EEPROM read-back: every field decoded from device flash is in range.
  const flashFields: string[] = [];
  if (dpiOk) flashFields.push("dpi");
  if (rate !== null && rate > 0) flashFields.push("polling");
  if (info.liftOffDistance != null && LOD_VALUES.has(info.liftOffDistance)) flashFields.push("lift-off");
  if (info.batteryPercent !== null && info.batteryPercent >= 0 && info.batteryPercent <= 100) flashFields.push("battery");
  if (info.dpiStages && info.dpiStages.length > 0) flashFields.push("dpi stages");
  const lodOk = info.liftOffDistance === null || LOD_VALUES.has(info.liftOffDistance);
  const batteryOk = info.batteryPercent === null || (info.batteryPercent >= 0 && info.batteryPercent <= 100);
  const stagesOk = !info.dpiStages || info.dpiStages.length === 0 || info.dpiStages.every((value) => value > 0 && value <= 30000);
  const flashOk = dpiOk && rate !== null && rate > 0 && lodOk && batteryOk && stagesOk;
  results.push({
    key: "flashRead",
    label: "Flash / EEPROM read-back",
    status: flashOk ? "pass" : "fail",
    detail: flashOk
      ? `decoded fields are in range (${flashFields.join(", ") || "no fields"})`
      : "a decoded flash field is missing or out of range.",
  });

  return results;
}

export function verdictFor(run: { results: HardwareTestResult[]; incomplete: boolean }): HardwareTestReport["verdict"] {
  if (run.incomplete) return "incomplete";
  if (run.results.some((result) => result.status === "fail")) return "fail";
  const required = run.results.filter(
    (result) => ESSENTIAL_TEST_KEYS.has(result.key) && result.status !== "skip",
  );
  return required.length > 0 && required.every((result) => result.status === "pass") ? "pass" : "fail";
}

/**
 * Picks a benign alternate DPI value to round-trip through the flash write
 * path. Prefers a close value (800/1600 or a doubling/halving of the current
 * value) so the pointer-speed change stays unobtrusive; falls back to the
 * smallest available value. Returns null when there is nothing to write.
 */
export function pickFlashDpiTarget(current: number | null, options: readonly number[]): number | null {
  if (current === null || options.length === 0) return null;
  const candidates = [800, 1600, 2400, 3200, current * 2, Math.round(current / 2)];
  for (const candidate of candidates) {
    if (candidate !== current && candidate > 0 && candidate <= 30000 && options.includes(candidate)) return candidate;
  }
  const alternate = options.find((option) => option !== current);
  return alternate ?? null;
}

/**
 * Picks a benign alternate polling rate to round-trip through the flash write
 * path. Prefers doubling or halving the current rate (a "close" step on the
 * standard reporting-rate ladder), falling back to the smallest available
 * value. Returns null when there is nothing to write.
 */
export function pickFlashPollRateTarget(current: number | null, options: readonly number[]): number | null {
  if (current === null || options.length === 0) return null;
  const candidates = [current * 2, Math.round(current / 2), 125, 250, 500, 1000, 2000, 4000, 8000];
  for (const candidate of candidates) {
    if (candidate !== current && candidate > 0 && options.includes(candidate)) return candidate;
  }
  const alternate = options.find((option) => option !== current);
  return alternate ?? null;
}

/**
 * Picks the least obtrusive alternate lift-off level. Medium is the middle of
 * the physical range, so it is preferred whenever the device is not already on
 * it; a Medium device falls back to Low.
 */
export function pickFlashLiftOffTarget(
  current: "Low" | "Medium" | "High" | null,
): "Low" | "Medium" | "High" | null {
  if (current === null) return null;
  return current === "Medium" ? "Low" : "Medium";
}

/** One setting's write → read-back → restore leg of the flash round-trip. */
export interface FlashSettingRoundTrip {
  /** Human label of the setting, e.g. "DPI", "Poll rate" or "Lift-off". */
  setting: string;
  current: string;
  target: string;
  status: HardwareTestStatus;
  detail: string;
}

interface FlashWriteResultArgs {
  skipped?: boolean;
  skippedReason?: string;
  /** The per-setting round-trip legs; the check passes only when every leg
      that ran (non-skip) came back clean. */
  roundTrips?: FlashSettingRoundTrip[];
}

/** The flash write round-trip outcome, as a scored check result. */
export function flashWriteResult(args: FlashWriteResultArgs): HardwareTestResult {
  const { skipped, skippedReason, roundTrips = [] } = args;
  if (skipped) {
    return { key: "flashWrite", label: "Flash write round-trip", status: "skip", detail: skippedReason ?? null };
  }
  const attempted = roundTrips.filter((leg) => leg.status !== "skip");
  if (attempted.length === 0) {
    return {
      key: "flashWrite",
      label: "Flash write round-trip",
      status: "skip",
      detail: "no writable settings on this device.",
    };
  }
  const failures = attempted.filter((leg) => leg.status === "fail");
  if (failures.length > 0) {
    return {
      key: "flashWrite",
      label: "Flash write round-trip",
      status: "fail",
      detail: failures.map((leg) => `${leg.setting}: ${leg.detail}`).join(" · "),
    };
  }
  return {
    key: "flashWrite",
    label: "Flash write round-trip",
    status: "pass",
    detail: roundTrips
      .map((leg) => (leg.status === "skip" ? `${leg.setting} skipped` : leg.detail))
      .join(" · "),
  };
}

/**
 * Scores the interactive polling-rate sample for the report. A sample passes
 * when the measured average is at or above 85% of the reported rate. Dropout /
 * rate mismatch and insufficient movement are both inconclusive: they are
 * shown in the report as evidence but never fail the certification verdict,
 * because browser event coalescing can under-sample a healthy mouse.
 */
export function pollingSampleResult(sample: {
  events: number;
  avgHz: number;
  peakHz: number;
  stability: number;
  reportedHz: number | null;
}): HardwareTestResult {
  const reported = sample.reportedHz ?? 1000;
  if (sample.events < 40) {
    return {
      key: "sampling",
      label: "Polling rate sampling",
      status: "skip",
      detail: "Not enough movement captured (needed ≥ 40 samples) — inconclusive.",
    };
  }
  if (sample.avgHz >= reported * 0.85) {
    return {
      key: "sampling",
      label: "Polling rate sampling",
      status: "pass",
      detail: `avg ${formatHz(sample.avgHz)} Hz · peak ${formatHz(sample.peakHz)} Hz · stability ${sample.stability.toFixed(0)}% · ${sample.events} samples`,
    };
  }
  return {
    key: "sampling",
    label: "Polling rate sampling",
    status: "skip",
    detail: `avg ${formatHz(sample.avgHz)} Hz vs reported ${reported} Hz — dropout or rate mismatch detected, so the sample is not counted as a failure.`,
  };
}