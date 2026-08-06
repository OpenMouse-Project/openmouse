# Finalmouse UltralightX hardware testing

This driver targets the Finalmouse UltralightX control dongle (`361D:0100`) and
ports the report framing used by xpanel and verified in
[FinalmousePollingRateSwitcher](https://github.com/xBambooz/FinalmousePollingRateSwitcher).

1. Connect the ULX through its wireless dongle and turn the mouse on.
2. Close xpanel and stop any Finalmouse polling service before connecting so
   another process does not hold the HID interface.
3. Confirm DPI, polling rate, battery, LOD, Motion Sync, firmware, and RSSI are
   read correctly.
4. Stage and flash one setting at a time, reconnect, and confirm it persisted.
5. Test dongle LED and tournament-scroll modes last.

Do not test firmware flashing. OpenMouse intentionally does not expose it.
