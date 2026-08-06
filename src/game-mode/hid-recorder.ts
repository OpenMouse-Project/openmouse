import { bytesToBase64 } from "./base64";
import type { RecipeStep } from "./types";

/**
 * Temporarily monkey-patches the real, already-open HIDDevice's four
 * transport methods so the ALREADY-INITIALIZED vendor client (the one the
 * rest of the page is using — not a freshly constructed one, which could be
 * missing cached state a driver's readStatus() populated) can be called
 * exactly as normal while every call is transcribed. Restored via stop().
 *
 * This is what lets the native companion app replay setPollingRate() later
 * with zero new per-vendor protocol code: real elapsed time between calls
 * (Razer's post-write settle delay, wireless reconfigure gaps, etc.) falls
 * out of the recording for free instead of needing to be hand-encoded.
 *
 * ponytail: capture does not try to infer *why* a busy-poll loop stopped
 * (which bytes the vendor's own JS compared to decide "not busy anymore").
 * It just records that a read happened and replays the same read, at the
 * same recorded delay, without a pass/fail condition — faithful to exactly
 * what the browser did during capture, and enough to apply the rate
 * correctly, but it won't adapt if one specific unit's confirmation timing
 * varies call to call. Add real expectMask/expectValue capture if that
 * turns out to matter for a specific vendor in practice.
 */
export function recordHidTranscript(device: HIDDevice): { steps(): RecipeStep[]; stop(): void } {
  const steps: RecipeStep[] = [];
  let lastAt = performance.now();

  const markDelay = () => {
    const now = performance.now();
    const gap = Math.round(now - lastAt);
    lastAt = now;
    if (gap > 4) steps.push({ kind: "delay", delayMs: gap });
  };

  const originalSendReport = device.sendReport.bind(device);
  const originalSendFeatureReport = device.sendFeatureReport.bind(device);
  const originalReceiveFeatureReport = device.receiveFeatureReport.bind(device);
  const originalAddEventListener = device.addEventListener.bind(device);

  device.sendReport = async (reportId, data) => {
    markDelay();
    steps.push({ kind: "write", reportKind: "output", reportId, payload: bytesToBase64(toBytes(data)) });
    const result = await originalSendReport(reportId, data);
    lastAt = performance.now();
    return result;
  };

  device.sendFeatureReport = async (reportId, data) => {
    markDelay();
    steps.push({ kind: "write", reportKind: "feature", reportId, payload: bytesToBase64(toBytes(data)) });
    const result = await originalSendFeatureReport(reportId, data);
    lastAt = performance.now();
    return result;
  };

  device.receiveFeatureReport = async (reportId) => {
    markDelay();
    const result = await originalReceiveFeatureReport(reportId);
    steps.push({ kind: "readExpect", reportKind: "feature", reportId, fromInputReport: false, timeoutMs: 500, pollIntervalMs: 1 });
    lastAt = performance.now();
    return result;
  };

  device.addEventListener = ((type: "inputreport", listener: (event: HIDInputReportEvent) => void) => {
    const wrapped = (event: HIDInputReportEvent) => {
      markDelay();
      steps.push({ kind: "readExpect", reportKind: "output", reportId: event.reportId, fromInputReport: true, timeoutMs: 500, pollIntervalMs: 20 });
      lastAt = performance.now();
      listener(event);
    };
    return originalAddEventListener(type, wrapped);
  }) as typeof device.addEventListener;

  return {
    steps: () => steps,
    stop: () => {
      device.sendReport = originalSendReport;
      device.sendFeatureReport = originalSendFeatureReport;
      device.receiveFeatureReport = originalReceiveFeatureReport;
      device.addEventListener = originalAddEventListener;
    },
  };
}

function toBytes(data: BufferSource): Uint8Array {
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
