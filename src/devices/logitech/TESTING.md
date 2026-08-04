# Logitech hardware test checklist

Test in Chrome or Edge over HTTPS. Close Logitech G HUB and Logitech Gaming
Software first — they hold the same vendor interface open and the mouse will
stop answering. Select the vendor collection (`usagePage 0xff00`, `usage
0x0001`), not the plain pointer collection.

Supported identifiers:

- `046d:c54d`, `046d:c547` — Lightspeed receivers
- `046d:c539` — HERO-era Lightspeed receiver
- `046d:c0a8` — PRO X 2 Superstrike (USB)
- `046d:c07e` — G402 / G402 Hyperion Fury (wired)

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

Persistent polling-rate and DPI-stage changes need a CRC-checked rewrite of the
1024-byte profile sector and are intentionally not implemented. Record the
device identifier, protocol version, and any failing setting in the issue or
pull request. Do not use factory reset during initial testing.
