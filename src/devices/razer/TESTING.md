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

DPI and polling rate can be written. Every other control is withheld: for most
of them no command has been confirmed, and for lift-off the command is confirmed
but has nowhere to render yet — see below.

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
6. On the receiver, confirm the lift-off card shows a **Single / Asymmetric**
   switch. On Single, the three-stop control should match what the vendor
   software reports, and each stop should be distinguishable by lifting the
   mouse. On Asymmetric, lift-off and landing take 2–26 and 1–25; set 26/25 and
   2/1 and confirm the difference is obvious.
7. Confirm switching back to Single restores the three-stop behaviour — the
   mouse has no mode flag, so this only works because writing a tracking level
   is what leaves asymmetric mode.
8. Set a landing above the lift-off and confirm it is capped rather than
   rejected, and that no sensor processing card appears.
9. On the **cable**, confirm the lift-off card is absent rather than broken.
   Class `0x0b` has never been exercised over USB, and the driver hides the
   control instead of failing the whole status read if it is unsupported.
10. Leave the panel open for a few minutes and confirm the background refresh
    keeps reporting without stalling or throwing. The mode probe is a write and
    must run **once** — if the lift-off pair drifts while the panel idles, the
    probe is being repeated and that is a bug.
11. Record the device identifier, firmware version, and any failing setting in
    the issue or pull request.

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

**Found and confirmed on hardware.** The earlier note in this file — that
`0x0b`/`0x85` byte[2] is the asymmetric toggle, `01` symmetric / `02` asymmetric
— was wrong. Byte[2] is the symmetric tracking level.

| | Class / ID | dataSize | Payload |
| --- | --- | --- | --- |
| Read all | `0x0b` / `0x85` | `0x05` | `echo, 00, tracking, liftOff-1, landing-1` |
| Write pair | `0x0b` / `0x05` | `0x0a` | `00, 04, liftOff-1, landing-1, 00 × 6` |
| Write setting | `0x0b` / `0x0b` | `0x04` | `00, 04, setting, value` |
| | | | `setting 01` — tracking level `00`/`01`/`02` |
| | | | `setting 04` — asymmetric unlock, value `01` |

Both asymmetric levels are stored **one below** the number Synapse displays.
Tracking is `0`=Low, `1`=Medium, `2`=High.

`0x0b` / `0x03` (`dataSize 0x03`, args `00 04 01`) also exists and is accepted,
but every value `00`–`03` was tried and it changes nothing readable. The vendor
software sends it before each `0x0b`/`0x0b`, so it looks like a select or begin
step that the mouse does not actually require. Do not spend time on it.

### The mode is last-write-wins, and there is no mode bit

Nothing readable reports which mode is active — two 47-command captures
differing only by the checkbox were byte-identical, and a sweep of classes
`0x00`–`0x0b` across ids `0x80`–`0xff` found nothing. There is no flag to clear
either: `0x0b`/`0x0b` with setting `04` value `00` is accepted and does nothing.

The mouse honours whichever store was written last:

| Written | Result |
| --- | --- |
| setting `01` (tracking level) | symmetric — the pair write is then refused `0x03` |
| setting `04` value `01`, then the pair | asymmetric — the pair drives the sensor |

**So the driver never needs to detect or toggle a mode.** It writes whichever
control the user touched. `razerSetTrackingDistanceCommand` covers the first
row; `setLiftOff` sends the unlock and then the pair for the second.

A side effect worth knowing: because the pair write is refused in symmetric mode
and accepted in asymmetric mode, its status is an accurate report of the current
mode. `RazerHidClient.probeAsymmetric` uses this, re-sending the values the
mirror already holds so the probe disturbs nothing — a refusal cannot switch the
mode, and an acceptance re-selects the mode the mouse was already in.

**It is still a write.** Call it once per connection, never on a background
refresh. It returns null rather than guessing when the mirror holds an inverted
pair, which the firmware permits and one session actually produced.

Verified on hardware by repeating the probe, which is self-checking: if a probe
changed the mode, the next one would report the other answer. Nine consecutive
probes in asymmetric mode returned `0x02`, three in symmetric mode returned
`0x03`, and the read-back was unchanged throughout. A refused probe cannot
switch the mouse to asymmetric, and an accepted one re-selects what it already
was.

Synapse presents these as two controls behind one checkbox. With **Enable
Asymmetric Cut-off** off it shows a single three-stop slider, TRACKING DISTANCE;
with it on, two 26-step sliders, LIFT-OFF (2–26) and LANDING (1–25). The two
stores are independent — switching modes preserves both.

**The write does not mirror the read.** It carries a constant `04` in its second
argument and no echo byte, so it is offset by one from the read's layout. Three
attempts that assumed a mirror were each answered `0x03`, and each still
disturbed the stored values — **a non-ok status on this command is not a
no-op.** The working format was transcribed from a capture of the vendor
software's own packet, not inferred.

**Read-back is not sufficient proof here.** Writes that the mouse rejected still
changed what `0x0b`/`0x85` reported, so the read-back agreed while the sensor
did not move. The format above was accepted with status `0x02` and confirmed by
lifting the mouse: 2/1 versus 26/25 is an unmistakable difference.

The firmware also stores an inverted pair without complaint — lift-off 2 with
landing 26 round-tripped, which Synapse cannot express. `razerSetLiftOffCommand`
rejects `landing >= liftOff` before the packet is sent, because nothing
downstream will catch it.

### Why the unlock is not optional

Measured with byte-identical pair-write packets and only the mode changed:

| Mode | Status | Mirror at `0x0b`/`0x85` | Sensor |
| --- | --- | --- | --- |
| Asymmetric | `0x02` ok | moved | moved, correct direction |
| Symmetric | `0x03` failure | moved anyway | **did not move** |

The sensor half was confirmed by making the two stores disagree: tracking set to
High, the pair left at its minimum of 2/1, symmetric — the cutoff stayed high.

**A rejected write still moves the mirror**, which is the trap. Omit the unlock
and `setLiftOff` throws, the panel shows an error, and the next background
refresh reads back *exactly the pair the user asked for* — new numbers on screen
over a sensor holding the old ones. Whatever renders this pair must not treat a
successful read as confirmation that a write landed.

`setLiftOff` therefore sends `razerEnableAsymmetricLiftOffCommand` before every
pair write, and builds the pair command first so an out-of-range value costs no
device traffic and cannot switch the mode over a write that never happens.

### What the client exposes

`readLiftOff`, `setLiftOff` and `setTrackingDistance` are implemented and
hardware-verified; nothing in the interface calls them yet.

`readLiftOff` returns null rather than throwing when the command is not
answered. Class `0x0b` has only ever been exercised on the receiver, and a
status read that throws takes the whole panel down instead of one control.

`setLiftOff` caps landing at `liftOff - 1` instead of rejecting the pair,
because lowering lift-off past an already-set landing is ordinary use of two
controls and the vendor software caps its own slider the same way. It returns
what the mouse ended up holding. The read-back afterwards compares only the
pair — tracking was never part of the write.

`setLiftOffDistance` writes byte[2] and is named for the shell's driver contract
rather than the vendor's wording — the vendor calls it the tracking distance.
All three stops were confirmed distinguishable at the sensor, so
`MouseStatus.liftOffDistance` carries them with no type change.

The asymmetric pair goes in `MouseStatus.asymmetricLiftOff`, a new optional
field only drivers that have verified it populate. Everywhere else it stays
undefined and the mode switch does not appear, so no other driver changes.

`supportedLiftOffDistances` is empty when class `0x0b` does not answer, which
hides the whole sensor card — the correct behaviour on a transport that has
never been tested against this command.

## Unresolved

- **Nothing readable reports which lift-off mode is active**, and no longer
  needs to — the mouse is last-write-wins and the driver writes the mode it
  wants. Recorded so the search is not repeated: two 47-command captures
  differing only by the checkbox were byte-identical apart from known noise, and
  a sweep of every class `0x00`–`0x0b` across ids `0x80`–`0xff` found nothing.
- Whether class `0x0b` answers at all over the cable (PID `0x00c0`). Everything
  above is the receiver. `readLiftOff` degrades to null for this reason.
- Classes `0x0c`–`0x0f` have never been swept. **`0x0c`/`0x80` drops the USB
  connection** — two independent sweeps died on exactly that command — so a
  sweep of that region has to start at `0x81`.
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
