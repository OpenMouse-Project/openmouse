# Orbital hardware test checklist

Test in Chrome or Edge over HTTPS. Select only the Orbital configuration
collection (`usagePage 0xff0a`, `usage 1`) when the browser lists multiple HID
interfaces.

Supported identifiers:

- `1915:080c` — Ghost / Pathfinder V2
- `1915:080b` — V2 receiver
- `1915:0747` — Pathfinder V1
- `1915:0746` — V1 receiver

1. Connect the device and confirm the displayed model, wired/wireless state,
   battery, active profile, DPI, and polling rate are correct.
2. Change one setting at a time: DPI, polling rate, lift-off distance, Motion
   Sync, angle snapping, ripple control, debounce, and sleep timeout.
3. Reload after each write and confirm the value persisted on the mouse.
4. Record the device identifier, protocol version, and any failing setting in
   the issue or pull request. Do not use factory reset during initial testing.
