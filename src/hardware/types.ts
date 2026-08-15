/**
 * Transport-agnostic HID types.
 *
 * We deliberately do NOT invent a parallel type hierarchy. `webhid.d.ts`
 * already declares the exact shape every driver in this repo is written
 * against (HIDDevice, HIDCollectionInfo, HIDReportInfo, ...). Those are
 * ambient/global interfaces, so any object that structurally matches them
 * — whether it wraps a real `navigator.hid` device or proxies to the Rust
 * side over Tauri IPC — satisfies driver code unmodified.
 *
 * This file just gives those ambient shapes module-local names so the
 * rest of `hardware/` can import them like normal types.
 */

export type HidTransportDevice = HIDDevice;
export type HidCollectionInfo = HIDCollectionInfo;
export type HidReportInfo = HIDReportInfo;
export type HidReportItem = HIDReportItem;
export type HidInputReportEvent = HIDInputReportEvent;
export type HidConnectionEvent = HIDConnectionEvent;
export type HidFilter = HIDDeviceFilter;

/**
 * Transport-agnostic stand-in for `navigator.hid`. `bridge.ts` picks one
 * implementation at module load and every call site in the app imports
 * `hid` from `bridge.ts` instead of touching `navigator.hid` directly.
 */
export type HidTransport = HID;

export type HidTransportKind = "web" | "native";
