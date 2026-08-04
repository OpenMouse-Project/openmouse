# Razer hardware test checklist

Test in Chrome or Edge over HTTPS. Quit Razer Synapse first — it holds the
control interface open and reads then time out.

Supported identifiers:

- `1532:00c0` — Viper V3 Pro, wired
- `1532:00c1` — Viper V3 Pro, HyperSpeed receiver

Razer does not declare its control channel in the HID descriptor, so no
interface advertises a feature report. The exchange still works because WebHID
does not check report IDs against the descriptor. The interface that answers is
the one whose **only** collection is Generic Desktop Mouse (`usagePage 0x01`,
`usage 0x02`).

The mouse presents four interfaces on each connection. The vendor filter
narrows the picker to one of them when wired, and to two on the receiver, where
a second interface carries a mouse collection alongside others. Both are named
`Razer Viper V3 Pro` and cannot be told apart in the picker, so on the receiver
the first choice may be the interface that never answers. It is then skipped in
the device list; add the device again and choose the other entry.

The cable and the receiver are separate devices with separate product IDs, so
each needs its own browser permission. Granting one does not grant the other,
and switching between them the first time means adding the device again.

This driver is read-only. It sends no write command, and the settings grid stays
hidden through `settingsReady`.

1. Connect the mouse over the cable and confirm the model, wired state, battery,
   charging state, DPI, and polling rate are correct.
2. Repeat on the receiver. Battery should read a plausible level, charging
   should read false, and the polling rate should match Synapse.
3. Confirm the reported polling rate tracks a change made in Synapse on both
   connections, including an 8000 Hz setting on the receiver.
4. Leave the panel open for a few minutes and confirm the background refresh
   keeps reporting without stalling or throwing.
5. Record the device identifier, firmware version, and any failing read in the
   issue or pull request.

## Verified against firmware 1.12

| Read | Class / ID | Notes |
| --- | --- | --- |
| Firmware | `0x00` / `0x81` | |
| Serial | `0x00` / `0x82` | ASCII, null terminated |
| Battery | `0x07` / `0x80` | level out of 255 |
| Charging | `0x07` / `0x84` | |
| DPI | `0x04` / `0x85` | big-endian X and Y |
| DPI stages | `0x04` / `0x86` | seven-byte records; decoded but not yet shown |
| Polling, legacy | `0x00` / `0x85` | divisor of 1000; **wired only** |
| Polling, extended | `0x00` / `0xc0` | divisor of 8000; **receiver only** |

Transaction ID `0x1f` answered every command on both connections.

## Unresolved

- Wired reports polling only through the legacy command, which cannot express
  rates above 1000 Hz. The command the wired connection uses for HyperPolling
  rates has not been found, so `supportedPollingRates` is left unset rather than
  advertising a range that has not been confirmed.
- No write command has been verified. DPI, polling rate, and lift-off distance
  writes are out of scope until each is confirmed against hardware.
- The 35000 DPI ceiling comes from the published sensor specification, not from
  the mouse. The stages read only proves the 400–6400 ladder. Nothing consumes
  the ceiling while the settings grid is hidden, but confirm it before the first
  write lands.
