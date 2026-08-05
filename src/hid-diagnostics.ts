export function describeHidDevice(device: HIDDevice): string {
  const name = device.productName || "unknown";
  const ids = `VID 0x${device.vendorId.toString(16)} PID 0x${device.productId.toString(16)}`;
  const collections = device.collections.map((collection) => {
    const features = collection.featureReports.map((report) => `0x${report.reportId.toString(16)}`).join(",") || "none";
    return `usage 0x${collection.usagePage.toString(16)}:${collection.usage.toString(16)} feat[${features}]`;
  }).join(" | ") || "no collections";
  return `${name} (${ids}; ${collections})`;
}

export interface HidTrafficEntry {
  dir: "OUT" | "SET" | "GET" | "IN";
  reportId: number;
  bytes: Uint8Array;
  ms: number;
  at: number;
  error: string | null;
  device: HIDDevice;
}

export interface HidMark {
  label: string;
  failed: boolean;
  transient: boolean;
  at: number;
}

export type HidLogEntry = HidTrafficEntry | HidMark;

export const isMark = (entry: HidLogEntry): entry is HidMark => "label" in entry;

const MAX_ENTRIES = 2000;
const entries: HidLogEntry[] = [];
let capturing = false;

function toBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return new Uint8Array();
}

function record(
  device: HIDDevice,
  dir: HidTrafficEntry["dir"],
  reportId: number,
  data: unknown,
  started: number,
  error?: unknown,
): void {
  if (entries.length >= MAX_ENTRIES) entries.shift();
  entries.push({
    dir,
    reportId,
    bytes: data ? toBytes(data) : new Uint8Array(),
    ms: Math.round(performance.now() - started),
    at: started,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    device,
  });
}

export function startHidCapture(): void {
  const ctor = (globalThis as { HIDDevice?: { prototype: HIDDevice } }).HIDDevice;
  if (capturing || !ctor) return;
  capturing = true;

  const proto = ctor.prototype;
  const rawOpen = proto.open;
  const rawSend = proto.sendReport;
  const rawSetFeature = proto.sendFeatureReport;
  const rawGetFeature = proto.receiveFeatureReport;
  const watched = new WeakSet<HIDDevice>();

  proto.open = async function (this: HIDDevice) {
    const result = await rawOpen.call(this);
    if (!watched.has(this)) {
      watched.add(this);
      this.addEventListener("inputreport", (event) => {
        record(this, "IN", event.reportId, event.data, performance.now());
      });
    }
    return result;
  };

  proto.sendReport = async function (this: HIDDevice, reportId: number, data: BufferSource) {
    const started = performance.now();
    try {
      const result = await rawSend.call(this, reportId, data);
      record(this, "OUT", reportId, data, started);
      return result;
    } catch (error) {
      record(this, "OUT", reportId, data, started, error);
      throw error;
    }
  };

  proto.sendFeatureReport = async function (this: HIDDevice, reportId: number, data: BufferSource) {
    const started = performance.now();
    try {
      const result = await rawSetFeature.call(this, reportId, data);
      record(this, "SET", reportId, data, started);
      return result;
    } catch (error) {
      record(this, "SET", reportId, data, started, error);
      throw error;
    }
  };

  proto.receiveFeatureReport = async function (this: HIDDevice, reportId: number) {
    const started = performance.now();
    try {
      const view = await rawGetFeature.call(this, reportId);
      record(this, "GET", reportId, view, started);
      return view;
    } catch (error) {
      record(this, "GET", reportId, null, started, error);
      throw error;
    }
  };
}

function dropTrailingTransient(): void {
  let index = entries.length - 1;
  while (index >= 0 && !isMark(entries[index])) {
    if ((entries[index] as HidTrafficEntry).error) return;
    index -= 1;
  }
  if (index < 0) return;
  const mark = entries[index] as HidMark;
  if (mark.transient && !mark.failed) entries.splice(index);
}

export function markHidActivity(label: string, options: { failed?: boolean; transient?: boolean } = {}): void {
  const { failed = false, transient = false } = options;
  if (transient) dropTrailingTransient();
  if (entries.length >= MAX_ENTRIES) entries.shift();
  entries.push({ label, failed, transient, at: performance.now() });
}

export function hidTraffic(device?: HIDDevice | null): HidLogEntry[] {
  if (!device) return [...entries];
  return entries.filter((entry) => isMark(entry)
    || entry.device === device
    || (entry.device.vendorId === device.vendorId && entry.device.productId === device.productId));
}

