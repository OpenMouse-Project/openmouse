import type { HidFilter, HidTransport, HidTransportDevice } from "./types";

/**
 * Thin wrapper around `navigator.hid`.
 *
 * This is the only file in the app that should reference `navigator.hid`
 * directly (aside from the ambient type declarations in `webhid.d.ts`).
 * Everything else imports `hid` from `bridge.ts`.
 *
 * Chrome/Edge desktop are the only environments where `navigator.hid`
 * exists at all — it's unimplemented in Firefox/Safari and blocked in most
 * embedded webviews (including Tauri's own webview, which is exactly why
 * `native.ts` exists). Calls here throw a clear, consistent error instead
 * of leaving callers to chase `undefined` through optional chains.
 */
class WebHidTransport extends EventTarget implements HidTransport {
  private get native(): HID | undefined {
    return typeof navigator !== "undefined" ? navigator.hid : undefined;
  }

  private require(): HID {
    const hid = this.native;
    if (!hid) {
      throw new Error(
        "WebHID is unavailable in this browser. Use Chrome or Edge on desktop, " +
          "or run the OpenMouse desktop app.",
      );
    }
    return hid;
  }

  async getDevices(): Promise<HidTransportDevice[]> {
    return (await this.native?.getDevices()) ?? [];
  }

  async requestDevice(options: { filters: HidFilter[] }): Promise<HidTransportDevice[]> {
    return this.require().requestDevice(options);
  }

  // Overload so this satisfies both EventTarget's base signature (required
  // because we `extends EventTarget`) and HID's narrower "connect"/
  // "disconnect" signature (required because we `implements HidTransport`).
  addEventListener(
    type: "connect" | "disconnect",
    listener: (event: HIDConnectionEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- implementation signature only, see overloads above
  addEventListener(type: string, listener: any, options?: any): void {
    this.native?.addEventListener(type as "connect" | "disconnect", listener, options);
  }

  removeEventListener(
    type: "connect" | "disconnect",
    listener: (event: HIDConnectionEvent) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- implementation signature only, see overloads above
  removeEventListener(type: string, listener: any, options?: any): void {
    this.native?.removeEventListener(type as "connect" | "disconnect", listener, options);
  }
}

export const webHidTransport: HidTransport = new WebHidTransport();
