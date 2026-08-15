import type { HidTransport, HidTransportKind } from "./types";
import { webHidTransport } from "./webHID";
import { nativeHidTransport } from "./native";

/**
 * True when running inside the Tauri desktop shell. `__TAURI_INTERNALS__` is
 * injected by Tauri's webview preload script and is not present in a regular
 * browser tab, which is what makes this safe to branch on.
 */
export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const hidTransportKind: HidTransportKind = isDesktopApp() ? "native" : "web";

/**
 * The single entry point for HID access in this app. Every file that used to
 * call `navigator.hid` directly should import this instead — the objects it
 * hands back satisfy the same `HIDDevice`/`HID` shapes either way, so no
 * other driver or UI code needs to know which transport is active.
 */
export const hid: HidTransport = hidTransportKind === "native" ? nativeHidTransport : webHidTransport;
