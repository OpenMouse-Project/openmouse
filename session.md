# Session: Attack Shark X8 SE Support Fix

## Date
2026-08-19

## Problem
Attack Shark X8 SE was listed as "supported" but not working — DPI, polling rate, and battery were all returning zero/null.

## USB Dump Analysis (`mousedata.pcapng`)

Parsed 80,502 USB packets from the pcapng capture (linkType 249 — USBPcap).

### Device Enumeration
- **X8 SE**: VID `0x1d57`, PID `0xfa60` — bus 2, device 11
- 4 HID interfaces:
  - IF 0: Boot Keyboard, EP `0x81` (67-byte report desc)
  - IF 1: Boot Mouse, EP `0x82` (73-byte report desc) — 27,471 packets, 7-byte reports (`buttons + X/Y delta`)
  - IF 2: Non-boot HID, EP `0x83` (206-byte report desc) — 54 packets, always `03 02 40 01 64`
  - IF 3: Boot Keyboard, EP `0x84` (27-byte report desc)

### Key Finding
**No HID feature report exchanges** in the entire capture. The driver never successfully communicated with the device via feature reports.

## Root Cause

The `detectFamily()` function in `attackshark/hid.ts` was routing all VID `0x1d57` devices to the `"1d57"` family (R1/X11 protocol). But the X8 SE uses the **GearHub protocol** (`25a7` family) despite sharing the same VID.

The 0x1d57 family uses:
- Feature report `0x06` for polling rate
- Feature report `0xa0` for DPI read
- Battery signature `[0x03, 0x55, 0x40, 0x01]`

The X8 SE uses the 0x25a7 GearHub protocol:
- Feature report `0x00` (64-byte MU class commands)
- Command `0x80` for firmware revision
- Command `0xD4` for DPI slots
- Command `0x04` for polling rate

## Fixes Applied

### 1. `mouse-protocol/src/drivers/attackshark/hid.ts`

**`detectFamily()`** — Added vendor control collection check for VID `0x1d57`:

```typescript
if (device.vendorId === VID_1D57) {
  // Some 0x1d57 mice (X8 SE, X11) use the GearHub protocol despite
  // sharing the R1 VID.  Distinguish by checking for a vendor-specific
  // collection (usagePage 0xffff) which the GearHub interface exposes.
  if (device.collections.some(hasVendorControl)) return "25a7";
  return device.collections.some(hasFeatureReports) ? "1d57" : null;
}
```

**`getDpiOptions()`** — Added DPI presets for `25a7` family:

```typescript
if (this.family === "25a7") {
  return [400, 800, 1200, 1600, 2400, 3200, 6400, 12000, 26000];
}
```

### 2. `openmouse/src/supported-mice.ts`

Fixed X8 SE note:
```
- "0x25a7 GearHub protocol — DPI, polling, firmware"
+ "0x1d57 VID, GearHub protocol — DPI, polling, firmware"
```

### 3. Built & Deployed

- Built `mouse-protocol` (`npm run build`)
- Copied dist to `openmouse/node_modules/@openmouse/protocol/dist/`
- All 463 protocol tests pass

## Detection Logic (after fix)

| VID | Collection check | Family | Protocol |
|-----|-----------------|--------|----------|
| `0x1d57` | `hasVendorControl` (usagePage 0xffff) | `"25a7"` | GearHub (64-byte feature reports) |
| `0x1d57` | `hasFeatureReports` (any) | `"1d57"` | R1/X11 (report 0x06/0xa0) |
| `0x25a7` | `hasVendorControl` | `"25a7"` | GearHub |
| `0x373e` | `hasVendorControl` (not Lamzu) | `"373e"` | Lamzu OEM |
