// A `navigator.hid` implementation backed by OpenMouse Bridge's loopback
// socket, so browsers without WebHID — Firefox, Safari — can drive a mouse
// through the same control panel Chrome uses.
//
// Nothing below knows anything about any vendor's protocol. It implements the
// WebHID surface the `@openmouse/protocol` drivers are written against (see
// @openmouse/protocol/drivers/webhid), and Bridge's `/v1/hid` socket provides
// the native side. The drivers, the registry's `isSupported()` auto-detection,
// and every card in the control panel then work unchanged: they never learn
// they are not in Chrome. This is the same trick Desktop's `TauriHidDevice`
// and Bridge's own `native-hid` adapter play, except those two report no
// collections and so have to bypass the driver registry and keep a hand-written
// brand table; Bridge parses the report descriptor for this socket, so the
// registry auto-detects here exactly as it does over real WebHID.
//
// Reachability, by browser: Chrome and Firefox treat http/ws to a loopback
// address as a potentially trustworthy origin, so an https page may open this
// socket. Safari does not, and blocks it as mixed content — Safari needs
// Bridge to serve the app itself over loopback, which is a separate change.

import { SUPPORTED_HID_FILTERS } from "@openmouse/protocol/drivers/vendors";
import { describeHidDevice, markHidActivity } from "./hid-diagnostics.ts";


const BRIDGE_SOCKET_URL = "ws://127.0.0.1:17846/v1/hid";
/** Bridge is either running on this machine or it is not; do not sit waiting. */
const CONNECT_TIMEOUT_MS = 1_500;
/** Generous: a native open walks every interface of the device. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Bridge does not push hot-plug events; the client re-enumerates instead. */
const POLL_INTERVAL_MS = 2_000;

type BridgeLogLevel = "debug" | "info" | "warn";

function bridgeLog(
  level: BridgeLogLevel,
  label: string,
  options: { detail?: Record<string, unknown> | string; transient?: boolean } = {},
): void {
  const detail = typeof options.detail === "string"
    ? options.detail
    : options.detail === undefined ? undefined : JSON.stringify(options.detail);
  const prefix = `[OpenMouse Bridge] ${label}`;
  if (level === "warn") console.warn(prefix, options.detail ?? "");
  else if (level === "info") console.info(prefix, options.detail ?? "");
  else console.debug(prefix, options.detail ?? "");
  if (level !== "debug") {
    markHidActivity(`Bridge ${label}`, {
      failed: level === "warn",
      transient: options.transient,
      detail,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The socket, reduced to what this module needs, so tests can supply a fake. */
export interface BridgeTransport {
  send(frame: string): void;
  close(): void;
  onMessage: ((frame: string) => void) | null;
  onClose: (() => void) | null;
}

interface DeviceSummary {
  key: string;
  vendorId: number;
  productId: number;
  productName: string;
  collections: HIDCollectionInfo[];
}

interface Reply {
  id: number;
  ok: boolean;
  error?: string;
  devices?: DeviceSummary[];
  data?: number[];
}

type Command =
  | { type: "list"; vendorIds: number[] }
  | { type: "open"; device: string }
  | { type: "close"; device: string }
  | { type: "listen"; device: string }
  | { type: "unlisten"; device: string }
  | { type: "sendReport"; device: string; reportId: number; data: number[] }
  | { type: "sendFeatureReport"; device: string; reportId: number; data: number[] }
  | { type: "receiveFeatureReport"; device: string; reportId: number };

class BridgeInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;

  constructor(device: HIDDevice, reportId: number, data: DataView) {
    super("inputreport");
    this.device = device;
    this.reportId = reportId;
    this.data = data;
  }
}

class BridgeConnectionEvent extends Event {
  readonly device: HIDDevice;

  constructor(type: "connect" | "disconnect", device: HIDDevice) {
    super(type);
    this.device = device;
  }
}

function toBytes(data: BufferSource): number[] {
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return [...bytes];
}

/** Top-level collections only, matching how a browser applies a filter. */
function matchesFilter(device: HIDDevice, filter: HIDDeviceFilter): boolean {
  if (filter.vendorId !== undefined && filter.vendorId !== device.vendorId) return false;
  if (filter.productId !== undefined && filter.productId !== device.productId) return false;
  if (filter.usagePage === undefined && filter.usage === undefined) return true;
  return device.collections.some((collection) =>
    (filter.usagePage === undefined || collection.usagePage === filter.usagePage)
    && (filter.usage === undefined || collection.usage === filter.usage));
}

function vendorIdsFor(filters: HIDDeviceFilter[]): number[] {
  const ids = new Set<number>();
  for (const filter of filters) {
    // A filter with no vendor id would mean "every HID device on the machine".
    // Bridge is asked for the vendors OpenMouse has drivers for instead, so a
    // page never learns about the user's keyboard or security key.
    if (filter.vendorId !== undefined) ids.add(filter.vendorId);
  }
  return [...ids];
}

// Listeners are kept in a set rather than by extending EventTarget: WebHID
// declares a narrower listener type than EventTarget's, which no override can
// satisfy under strict mode. Both other HID adapters in this project (Desktop's
// TauriHidDevice, Bridge's native-hid) landed on the same shape.
class BridgeHidDevice implements HIDDevice {
  readonly key: string;
  readonly openMouseTransport = "bridge";
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  collections: readonly HIDCollectionInfo[];
  opened = false;

  #client: BridgeClient;
  #listeners = new Set<(event: HIDInputReportEvent) => void>();

  constructor(client: BridgeClient, summary: DeviceSummary) {
    this.#client = client;
    this.key = summary.key;
    this.vendorId = summary.vendorId;
    this.productId = summary.productId;
    this.productName = summary.productName;
    this.collections = summary.collections;
  }

  async open(): Promise<void> {
    if (this.opened) return;
    try {
      await this.#client.request({ type: "open", device: this.key });
      this.opened = true;
      bridgeLog("info", "device opened", { detail: describeHidDevice(this) });
    } catch (error) {
      bridgeLog("warn", "device open failed", {
        detail: `${describeHidDevice(this)}: ${errorMessage(error)}`,
      });
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.opened) return;
    this.opened = false;
    try {
      await this.#client.request({ type: "close", device: this.key });
      bridgeLog("info", "device closed", { detail: describeHidDevice(this) });
    } catch (error) {
      bridgeLog("warn", "device close failed", {
        detail: `${describeHidDevice(this)}: ${errorMessage(error)}`,
      });
      throw error;
    }
  }

  async sendReport(reportId: number, data: BufferSource): Promise<void> {
    await this.#client.request({ type: "sendReport", device: this.key, reportId, data: toBytes(data) });
  }

  async sendFeatureReport(reportId: number, data: BufferSource): Promise<void> {
    await this.#client.request({ type: "sendFeatureReport", device: this.key, reportId, data: toBytes(data) });
  }

  async receiveFeatureReport(reportId: number): Promise<DataView> {
    const reply = await this.#client.request({ type: "receiveFeatureReport", device: this.key, reportId });
    return new DataView(Uint8Array.from(reply.data ?? []).buffer);
  }

  addEventListener(type: "inputreport", listener: (event: HIDInputReportEvent) => void): void {
    if (type !== "inputreport") return;
    const first = this.#listeners.size === 0;
    this.#listeners.add(listener);
    if (first) void this.#client.request({ type: "listen", device: this.key }).catch(() => undefined);
  }

  removeEventListener(type: "inputreport", listener: (event: HIDInputReportEvent) => void): void {
    if (type !== "inputreport") return;
    this.#listeners.delete(listener);
    if (this.#listeners.size === 0) {
      void this.#client.request({ type: "unlisten", device: this.key }).catch(() => undefined);
    }
  }

  /** Called by the client when Bridge forwards a report for this device. */
  deliver(reportId: number, data: number[]): void {
    const event = new BridgeInputReportEvent(this, reportId, new DataView(Uint8Array.from(data).buffer));
    for (const listener of this.#listeners) listener(event);
  }

  /** Bridge went away: the handle is dead, whatever the page still holds. */
  markClosed(): void {
    this.opened = false;
  }
}

class BridgeClient {
  #transport: BridgeTransport;
  #nextId = 1;
  #pending = new Map<number, {
    resolve: (reply: Reply) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    command: Command["type"];
    device?: string;
    started: number;
  }>();
  #devices = new Map<string, BridgeHidDevice>();
  #closed = false;
  #lastScanSignature: string | null = null;
  onDisconnect: (() => void) | null = null;

  constructor(transport: BridgeTransport) {
    this.#transport = transport;
    transport.onMessage = (frame) => this.#receive(frame);
    transport.onClose = () => this.#fail(new Error("OpenMouse Bridge disconnected."));
  }

  get devices(): Map<string, BridgeHidDevice> {
    return this.#devices;
  }

  request(command: Command): Promise<Reply> {
    if (this.#closed) {
      const error = new Error("OpenMouse Bridge disconnected.");
      bridgeLog("warn", "request rejected", { detail: { command: command.type, error: error.message } });
      return Promise.reject(error);
    }
    const id = this.#nextId++;
    const started = performance.now();
    const device = "device" in command ? command.device : undefined;
    if (command.type !== "list") {
      bridgeLog("debug", "request sent", { detail: { id, command: command.type, device } });
    }
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        const error = new Error(`OpenMouse Bridge did not answer ${command.type} in time.`);
        bridgeLog("warn", "request timed out", {
          detail: { id, command: command.type, device, elapsedMs: Math.round(performance.now() - started) },
        });
        reject(error);
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer, command: command.type, device, started });
      try {
        this.#transport.send(JSON.stringify({ id, ...command }));
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        bridgeLog("warn", "request send failed", {
          detail: { id, command: command.type, device, error: errorMessage(error) },
        });
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Reuses the existing device object for a key so open state and listeners survive a re-enumeration. */
  reconcile(summaries: DeviceSummary[]): { devices: BridgeHidDevice[]; added: BridgeHidDevice[]; removed: BridgeHidDevice[] } {
    const seen = new Set(summaries.map((summary) => summary.key));
    const removed: BridgeHidDevice[] = [];
    for (const [key, device] of this.#devices) {
      if (seen.has(key)) continue;
      device.markClosed();
      this.#devices.delete(key);
      removed.push(device);
    }

    const added: BridgeHidDevice[] = [];
    const devices = summaries.map((summary) => {
      const existing = this.#devices.get(summary.key);
      if (existing) {
        existing.collections = summary.collections;
        return existing;
      }
      const device = new BridgeHidDevice(this, summary);
      this.#devices.set(summary.key, device);
      added.push(device);
      return device;
    });

    if (added.length || removed.length) {
      bridgeLog("info", "device inventory changed", {
        detail: {
          added: added.map(describeHidDevice),
          removed: removed.map(describeHidDevice),
          total: devices.length,
        },
      });
    }
    return { devices, added, removed };
  }

  #receive(frame: string): void {
    let message: Reply & { type?: string; device?: string; reportId?: number };
    try {
      message = JSON.parse(frame) as typeof message;
    } catch (error) {
      bridgeLog("warn", "invalid response", { detail: errorMessage(error) });
      return;
    }

    if (message.type === "inputreport") {
      this.#devices.get(message.device ?? "")?.deliver(message.reportId ?? 0, message.data ?? []);
      return;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) {
      bridgeLog("warn", "unexpected response", { detail: { id: message.id } });
      return;
    }
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    const detail = {
      id: message.id,
      command: pending.command,
      device: pending.device,
      elapsedMs: Math.round(performance.now() - pending.started),
      deviceCount: message.devices?.length,
    };
    if (message.ok) {
      if (pending.command === "list") {
        const devices = message.devices?.map((device) =>
          `${device.productName} (VID 0x${device.vendorId.toString(16)} PID 0x${device.productId.toString(16)}; ${device.key})`) ?? [];
        const signature = JSON.stringify(devices);
        const inventoryChanged = signature !== this.#lastScanSignature;
        this.#lastScanSignature = signature;
        if (inventoryChanged) {
          bridgeLog("info", "device scan completed", {
            detail: { ...detail, devices },
            transient: true,
          });
        }
      } else {
        bridgeLog("debug", "request completed", { detail });
      }
      pending.resolve(message);
    } else {
      const error = new Error(message.error ?? "OpenMouse Bridge rejected the request.");
      bridgeLog("warn", "request failed", { detail: { ...detail, error: error.message } });
      pending.reject(error);
    }
  }

  #fail(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    bridgeLog("warn", "connection lost", {
      detail: { error: error.message, pendingRequests: this.#pending.size, knownDevices: this.#devices.size },
    });
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const device of this.#devices.values()) device.markClosed();
    this.onDisconnect?.();
  }
}

class BridgeHid implements HID {
  #client: BridgeClient;
  #poll: ReturnType<typeof setInterval> | null = null;
  #listing: Promise<HIDDevice[]> | null = null;
  // Like WebHID, devices already present when the page first enumerates are
  // not "connected" events; emitting them made the app activate each one in
  // turn after reconnectAuthorizedDevice picked the remembered mouse.
  #enumerated = false;
  #listeners: Record<"connect" | "disconnect", Set<(event: HIDConnectionEvent) => void>> = {
    connect: new Set(),
    disconnect: new Set(),
  };

  constructor(transport: BridgeTransport, onExternalDisconnect?: () => void) {
    this.#client = new BridgeClient(transport);
    this.#client.onDisconnect = () => {
      if (this.#poll !== null) clearInterval(this.#poll);
      this.#poll = null;
      for (const device of this.#client.devices.values()) this.#emit("disconnect", device);
      this.#client.devices.clear();
      onExternalDisconnect?.();
    };
  }

  /**
   * Every mouse OpenMouse has a driver for, whether or not the page asked
   * before. WebHID would return only devices the user has granted through the
   * browser's picker; Bridge has no such per-site grant, and does not need one
   * — the user installed a companion application for this site specifically,
   * and Bridge only accepts sockets from its own origin allowlist. The
   * practical effect is that a supported mouse is simply there on page load,
   * with no picker to click through.
   */
  async getDevices(): Promise<HIDDevice[]> {
    if (this.#listing) return this.#listing;
    const listing = this.#listDevices();
    this.#listing = listing;
    try {
      return await listing;
    } finally {
      if (this.#listing === listing) this.#listing = null;
    }
  }

  async #listDevices(): Promise<HIDDevice[]> {
    const reply = await this.#client.request({ type: "list", vendorIds: vendorIdsFor(SUPPORTED_HID_FILTERS) });
    const { devices, added, removed } = this.#client.reconcile(reply.devices ?? []);
    if (this.#enumerated) {
      for (const device of added) this.#emit("connect", device);
      for (const device of removed) this.#emit("disconnect", device);
    }
    this.#enumerated = true;
    this.#startPolling();
    return devices;
  }

  async requestDevice(options: { filters: HIDDeviceFilter[] }): Promise<HIDDevice[]> {
    const reply = await this.#client.request({ type: "list", vendorIds: vendorIdsFor(options.filters) });
    const { devices } = this.#client.reconcile(reply.devices ?? []);
    this.#enumerated = true;
    this.#startPolling();
    return devices.filter((device) => options.filters.some((filter) => matchesFilter(device, filter)));
  }

  addEventListener(type: "connect" | "disconnect", listener: (event: HIDConnectionEvent) => void): void {
    this.#listeners[type]?.add(listener);
  }

  removeEventListener(type: "connect" | "disconnect", listener: (event: HIDConnectionEvent) => void): void {
    this.#listeners[type]?.delete(listener);
  }

  #emit(type: "connect" | "disconnect", device: HIDDevice): void {
    const event = new BridgeConnectionEvent(type, device);
    for (const listener of this.#listeners[type]) listener(event);
  }

  /** Bridge sends no hot-plug events, so connect/disconnect come from re-enumerating. */
  #startPolling(): void {
    if (this.#poll !== null) return;
    this.#poll = setInterval(() => {
      void this.getDevices().catch(() => undefined);
    }, POLL_INTERVAL_MS);
  }
}

/** The WebHID shim over a transport. Exported for tests; use `installBridgeHid` in the app. */
export function bridgeHid(transport: BridgeTransport, onDisconnect?: () => void): HID {
  return new BridgeHid(transport, onDisconnect);
}

// Whether `navigator.hid` is currently the Bridge shim (as opposed to the
// browser's own WebHID, or nothing at all). Tracked separately from the
// getDevices()/status polling below so a UI component — the Home page's
// Bridge card — can show "connected" the instant the socket opens and
// "disconnected" the instant Bridge's process goes away, without polling
// bridgeStatus() itself just to answer "is it there".
let bridgeHidActive = false;
const bridgeHidActiveListeners = new Set<(active: boolean) => void>();

function setBridgeHidActive(active: boolean): void {
  if (bridgeHidActive === active) return;
  bridgeHidActive = active;
  for (const listener of bridgeHidActiveListeners) listener(active);
}

export function isBridgeHidActive(): boolean {
  return bridgeHidActive;
}

/** Returns an unsubscribe function. Immediately calls `listener` with the current state. */
export function subscribeBridgeHidActive(listener: (active: boolean) => void): () => void {
  bridgeHidActiveListeners.add(listener);
  listener(bridgeHidActive);
  return () => bridgeHidActiveListeners.delete(listener);
}

async function openSocket(url: string): Promise<BridgeTransport | null> {
  const started = performance.now();
  bridgeLog("info", "connecting", { detail: { url }, transient: true });
  return await new Promise<BridgeTransport | null>((resolve) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      bridgeLog("warn", "connection could not start", {
        detail: { url, error: errorMessage(error) },
      });
      resolve(null);
      return;
    }

    let opened = false;
    let resolved = false;
    let failureLogged = false;
    const transport: BridgeTransport = {
      send: (frame) => socket.send(frame),
      close: () => socket.close(),
      onMessage: null,
      onClose: null,
    };
    const timer = setTimeout(() => {
      failureLogged = true;
      bridgeLog("warn", "connection timed out", {
        detail: { url, elapsedMs: Math.round(performance.now() - started) },
      });
      socket.close();
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      opened = true;
      clearTimeout(timer);
      bridgeLog("info", "connected", {
        detail: { url, elapsedMs: Math.round(performance.now() - started) },
      });
      if (!resolved) {
        resolved = true;
        resolve(transport);
      }
    });
    socket.addEventListener("message", (event: MessageEvent<string>) => transport.onMessage?.(event.data));
    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      if (opened) {
        bridgeLog("info", "socket closed", { detail: { code: event.code, reason: event.reason || undefined } });
        transport.onClose?.();
      } else if (!failureLogged) {
        bridgeLog("warn", "connection closed before opening", {
          detail: { code: event.code, reason: event.reason || undefined },
        });
      }
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      failureLogged = true;
      bridgeLog("warn", "socket error", { detail: { phase: opened ? "connected" : "connecting" } });
      if (!opened && !resolved) {
        resolved = true;
        resolve(null);
      }
    });
  });
}

/**
 * Installs Bridge as `navigator.hid` when the browser has no WebHID of its own.
 *
 * Resolves to whether the page can reach HID at all, so a caller can keep using
 * it as its "is this browser supported" answer. Pass `force` to prefer Bridge
 * even where WebHID exists — Chrome's WebHID hides collections it considers
 * protected, and a device that needs one of those is reachable natively but not
 * through the browser.
 */
export async function installBridgeHid(options: { force?: boolean } = {}): Promise<boolean> {
  if (navigator.hid && !options.force) return true;
  const transport = await openSocket(BRIDGE_SOCKET_URL);
  if (!transport) {
    setBridgeHidActive(false);
    return Boolean(navigator.hid);
  }
  Object.defineProperty(navigator, "hid", {
    value: bridgeHid(transport, () => setBridgeHidActive(false)),
    configurable: true,
  });
  setBridgeHidActive(true);
  return true;
}
