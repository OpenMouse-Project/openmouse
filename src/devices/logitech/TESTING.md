# Logitech hardware test checklist

Test in Chrome or Edge over HTTPS. Close Logitech G HUB, Logitech Gaming
Software and Logi Options+ first — they hold the same vendor interface open and
the mouse will stop answering. Select the vendor collection, not the plain
pointer collection: `usagePage 0xff00` / `usage 0x0001` over USB, or
`usagePage 0xff43` over Bluetooth.

On macOS the browser also needs Input Monitoring permission (System Settings →
Privacy & Security → Input Monitoring). Without it macOS refuses to open a mouse
HID device and every request times out.

Supported identifiers:

- `046d:c54d`, `046d:c547` — Lightspeed receivers
- `046d:c539` — HERO-era Lightspeed receiver
- `046d:c0a8` — PRO X 2 Superstrike (USB)
- `046d:c07e` — G402 / G402 Hyperion Fury (wired)
- `046d:b036` — Pebble M350s (Bluetooth)

## Receiver-attached and Superstrike devices

1. Confirm the model, battery, connection type, DPI, polling rate, and
   lift-off distance are read correctly.
2. Change one setting at a time and confirm each write, then reload and confirm
   it persisted.

## G402 (direct-connect, HID++ device index `0xFF`)

The G402 is addressed as the mouse itself rather than a receiver slot, and it
exposes only the legacy feature set: Adjustable DPI `0x2201` and Report Rate
`0x8060`. It has no lift-off, gaming-surface, battery, or hall-effect controls,
so those cards stay hidden.

1. Confirm the sidebar and title show the mouse, and that the connection reads
   **Wired**.
2. Confirm the firmware list and the HID++ device details section populate.
3. Confirm the DPI presets offer 400 / 800 / 1600 / 3200 and that the reported
   DPI matches what Logitech Gaming Software shows.
4. Stage a DPI change and flash it. The driver writes `0x2201` function 3 as a
   short request and re-reads the value; a mismatch is reported as an error
   rather than being assumed to have worked.
5. Confirm the sensor card (lift-off distance) is hidden — the G402 has no
   `0x2202` feature to drive it.
6. Confirm the polling-rate buttons show the active rate but are **disabled**,
   with the note explaining the rate lives in the onboard profile.
7. Confirm the mouse stays in onboard mode: its own DPI-stage buttons must keep
   working after OpenMouse writes a DPI value. The driver deliberately does not
   switch the G402 into host-control mode.
8. Reload the page and confirm the DPI written in step 4 is still reported.

## Pebble M350s (Bluetooth, HID++ device index `0xFF`)

**Not yet confirmed on hardware.** The transport was derived from the mouse's
HID report descriptor; the feature set it answers with still needs recording.

Over Bluetooth HID++ moves to `usagePage 0xff43` and only the long report
(`0x11`) exists, so every request goes out long. Being an office mouse the
Pebble is expected to expose no DPI (`0x2201` / `0x2202`) and no report rate
(`0x8060` / `0x8061`), only device name, firmware and Battery Level Status
(`0x1000`).

1. Confirm the sidebar and title show **Pebble M350s** and the connection reads
   **Wireless / Bluetooth**.
2. Confirm the battery percentage matches what Logi Options+ reports. `0x1000`
   returns a coarse level, so expect a value like 90 / 50 / 20 rather than a
   continuous reading.
3. Confirm the firmware list and the HID++ device details section populate.
4. Confirm the DPI, polling-rate and sensor cards are all **hidden** and the
   live status line reads the battery only. A card that appears empty means a
   feature was found but returned nothing.
5. Record the feature indexes the mouse actually answers with. If it does report
   `0x2201` or `0x8060`, the corresponding card should appear on its own and the
   others stay hidden.

Persistent polling-rate and DPI-stage changes need a CRC-checked rewrite of the
1024-byte profile sector and are intentionally not implemented. Record the
device identifier, protocol version, and any failing setting in the issue or
pull request. Do not use factory reset during initial testing.
