import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  HidCollectionInfo,
  HidFilter,
  HidTransport,
  HidTransportDevice,
} from "./types";

/**
 * Desktop transport. Mirrors `navigator.hid` by proxying to Rust commands
 * registered in `src-tauri/src/hid/commands.rs`, which talk to real hardware
 * through the `hidapi` crate. See that module for the wire format.
 *
 * Every device this hands back implements the same `HIDDevice` shape a real
 * WebHID device does (open/close/sendReport/receiveFeatureReport/collections/
 * "inputreport" events), so driver code in egg-we-hid.ts, pulsar-hid.ts,
 * logitech-hidpp.ts, wlmouse-hid.ts, and egg-op1-hid.ts needs no changes to
 * run against it.
 */

interface NativeDeviceSummary {
  path: string;
  vendorId: number;
  productId: number;
  productName: string;
}

interface NativeOpenResult {
  collections: HidCollectionInfo[];
}

interface NativeInputReportPayload {
  path: string;
  reportId: number;
  data: number[];
}

function toByteArray(data: BufferSource): number[] {
  const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return Array.from(view);
}

/** path -> live device instance, so incoming Tauri events can be demuxed to the right one. */
const openDevices = new Map<string, NativeHidDevice>();

let inputReportListenerReady: Promise<void> | null = null;

function ensureInputReportListener(): Promise<void> {
  if (!inputReportListenerReady) {
    inputReportListenerReady = listen<NativeInputReportPayload>("hid://input-report", (event) => {
      const device = openDevices.get(event.payload.path);
      if (!device) return;
      const bytes = new Uint8Array(event.payload.data);
      const reportEvent = new CustomEvent("inputreport", {
        detail: {
          device,
          reportId: event.payload.reportId,
          data: new DataView(bytes.buffer),
        },
      }) as unknown as HIDInputReportEvent;
      device.dispatchEvent(reportEvent);
    }).then(() => undefined);
  }
  return inputReportListenerReady;
}

class NativeHidDevice extends EventTarget implements HidTransportDevice {
  opened = false;
  collections: readonly HidCollectionInfo[] = [];

  constructor(
    readonly path: string,
    readonly vendorId: number,
    readonly productId: number,
    readonly productName: string,
  ) {
    super();
  }

  // Overload so this satisfies both EventTarget's base signature (required
  // because we `extends EventTarget`) and HIDDevice's narrower "inputreport"
  // signature (required because we `implements HidTransportDevice`).
  addEventListener(type: "inputreport", listener: (event: HIDInputReportEvent) => void): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- implementation signature only, see overloads above
  addEventListener(type: string, listener: any, options?: any): void {
    super.addEventListener(type, listener, options);
  }

  removeEventListener(type: "inputreport", listener: (event: HIDInputReportEvent) => void): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- implementation signature only, see overloads above
  removeEventListener(type: string, listener: any, options?: any): void {
    super.removeEventListener(type, listener, options);
  }

  async open(): Promise<void> {
    if (this.opened) return;
    await ensureInputReportListener();
    const result = await invoke<NativeOpenResult>("hid_open", { path: this.path });
    this.collections = result.collections;
    this.opened = true;
    openDevices.set(this.path, this);
    await invoke("hid_watch_input_reports", { path: this.path });
  }

  async close(): Promise<void> {
    if (!this.opened) return;
    openDevices.delete(this.path);
    this.opened = false;
    await invoke("hid_close", { path: this.path });
  }

  async sendReport(reportId: number, data: BufferSource): Promise<void> {
    await invoke("hid_send_report", { path: this.path, reportId, data: toByteArray(data) });
  }

  async sendFeatureReport(reportId: number, data: BufferSource): Promise<void> {
    await invoke("hid_send_feature_report", { path: this.path, reportId, data: toByteArray(data) });
  }

  async receiveFeatureReport(reportId: number): Promise<DataView> {
    const bytes = await invoke<number[]>("hid_receive_feature_report", {
      path: this.path,
      reportId,
    });
    return new DataView(new Uint8Array(bytes).buffer);
  }
}

class NativeHidTransport extends EventTarget implements HidTransport {
  private async listSummaries(filters: HidFilter[]): Promise<NativeDeviceSummary[]> {
    return invoke<NativeDeviceSummary[]>("hid_list_devices", { filters });
  }

  private toDevices(summaries: NativeDeviceSummary[]): HidTransportDevice[] {
    return summaries.map((summary) => {
      const existing = openDevices.get(summary.path);
      if (existing) return existing;
      return new NativeHidDevice(summary.path, summary.vendorId, summary.productId, summary.productName);
    });
  }

  async getDevices(): Promise<HidTransportDevice[]> {
    return this.toDevices(await this.listSummaries([]));
  }

  /**
   * WebHID's requestDevice() shows a browser permission picker. Native HID
   * access has no such per-device consent step (the OS may still show its
   * own prompt the first time we open a device, e.g. macOS Input Monitoring)
   * — so this just returns everything currently matching `filters`.
   */
  async requestDevice(options: { filters: HidFilter[] }): Promise<HidTransportDevice[]> {
    return this.toDevices(await this.listSummaries(options.filters));
  }

  // Native HID has no OS-level connect/disconnect events wired up yet.
  // Polling via getDevices() covers the current UI's needs; if hot-plug
  // notifications become necessary, add a Rust-side watcher that emits
  // "hid://connect" / "hid://disconnect" and forward them here.
  addEventListener(): void {}
  removeEventListener(): void {}
}

export const nativeHidTransport: HidTransport = new NativeHidTransport();
