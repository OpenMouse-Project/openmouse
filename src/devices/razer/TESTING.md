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

DPI and polling rate can be written. Every other control is withheld because no
command for it has been confirmed.

1. Connect the mouse over the cable and confirm the model, wired state, battery,
   charging state, DPI, and polling rate are correct.
2. Repeat on the receiver. Battery should read a plausible level, charging
   should read false, and the polling rate should match Synapse.
3. Confirm the reported polling rate tracks a change made in Synapse on both
   connections, including an 8000 Hz setting on the receiver.
4. Change the DPI and confirm the pointer speed changes with it, then reload and
   confirm the new value persisted.
5. Change the polling rate on each connection and confirm it persists. The cable
   offers 125/500/1000 and the receiver adds 2000/4000/8000; no other rate
   should appear.
6. Confirm no lift-off distance buttons and no sensor processing card appear.
7. Leave the panel open for a few minutes and confirm the background refresh
   keeps reporting without stalling or throwing.
8. Record the device identifier, firmware version, and any failing setting in the
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

Each write clears the high bit of the matching read.

| Write | Class / ID | Notes |
| --- | --- | --- |
| DPI | `0x04` / `0x05` | storage byte, then big-endian X and Y |
| Polling, legacy | `0x00` / `0x05` | divisor of 1000; **wired only** |
| Polling, extended | `0x00` / `0x40` | leading `0x00`, then divisor of 8000 |

Transaction ID `0x1f` answered every command on both connections. Writes were
confirmed by effect, not only by read-back: a DPI change altered pointer speed,
and a 500 Hz write measured 499 Hz through `pointerrawupdate`.

The cable is limited to 1000 Hz on this model, which is also the ceiling the
legacy encoding can express, so no HyperPolling command is missing there.

## Confirmed but not exposed

| Setting | Read | Write | Encoding |
| --- | --- | --- | --- |
| Idle sleep | `0x07` / `0x83` | `0x07` / `0x03` | seconds, big-endian; 60–900 |
| Low battery | `0x07` / `0x81` | `0x07` / `0x01` | level out of 255, so 77 is 30% |

Both round-trip on hardware and agree with the vendor software. Neither is wired
to the interface: the sleep and debounce controls are filled per brand rather
than per capability, so exposing them means changing how the shell picks those
controls rather than adding a driver method.

Note the low-battery threshold shares the battery level's 0–255 scale. Reading
it as a percentage gives the wrong number.

## Lift-off distance

Not found. Class `0x0b` answers at `0x80`, `0x85`, `0x8b`, `0x8e`, `0x90`–`0x92`,
`0x94`, `0x95` and `0xa4`, and class `0x04` holds only DPI commands, but none
carries the values the vendor software shows. `0x0b`/`0x85` tracks the
asymmetric cut-off toggle in its third byte: `01` symmetric, `02` asymmetric.

The vendor software exposes lift-off as a continuous slider, and asymmetric mode
splits it into separate lift-off and landing values where landing cannot exceed
lift-off. That does not fit the three-value `liftOffDistance` field, so this
needs a richer type before it can be exposed even once the command is found.

## Unresolved

- No lift-off distance command has been found, so no lift-off control is
  offered and `supportedLiftOffDistances` stays empty.
- No sensor processing commands (motion sync, angle snapping, ripple control)
  have been found, so that card stays hidden. The vendor software does not
  expose them for this model either, so they are more likely absent from the
  mouse than missing from this driver.
- The 35000 DPI ceiling comes from the published sensor specification, not from
  the mouse; the stages read only proves the 400–6400 ladder. A write past the
  real ceiling fails its read-back and reports a mismatch rather than silently
  misreporting, but the ceiling itself is still unconfirmed.
- DPI step granularity is assumed to be 50. Values off that grid are rejected
  before they reach the mouse, so a finer or coarser real step would only mean
  the control offers the wrong choices.
- The DPI stage table (`0x04`/`0x06`) is decoded and tested but never written.
  A wrong length there is the one realistic way to corrupt stored settings.
