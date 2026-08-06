# Logitech onboard profiles (HID++ 0x8100)

Reference notes for implementing onboard profile support. Everything here is
recorded with its provenance so it can be re-derived rather than trusted.

**Status: protocol recovered, unverified on hardware.** All eight profile format
layouts and the checksum algorithm are documented below, read out of Logitech's
native code. Nothing here has been confirmed against a real device. See
[What is still unknown](#what-is-still-unknown) and
[Verifying before writing](#verifying-before-writing).

## Provenance

Recovered from Logitech's Onboard Memory Manager 2.6.1749, a .NET/C# WPF app
whose metadata is unobfuscated. It embeds its protocol library as a resource,
`OnboardMemoryManager.embeddeddlls.logi_nethidppio.dll` (3.8 MB, mixed-mode
C++/CLI), which contains the profile model.

The `logidec/` tool in this repo extracts and decompiles both. Reverse
engineering for interoperability, as libratbag and Solaar do.

Names, enums and struct layouts below are quoted from that library. Anything
marked *inferred* is reasoning from behaviour, not a direct quote.

## Two persistence models

Logitech mice expose settings through two unrelated mechanisms, and confusing
them explains most "my setting reset itself" reports:

| | Onboard profiles (0x8100) | Device-level features |
|---|---|---|
| Storage | profile flash | firmware NVM |
| Examples | DPI, LOD, report rate, buttons, lighting | gaming surface, LightForce (0x8090) |
| Survives power cycle | yes | yes |
| Survives host-mode writes | **no** — reloaded from flash | unaffected |

OpenMouse currently writes DPI, LOD and report rate in **host mode**, which is
volatile: the values live in device RAM only, and are lost on power cycle or as
soon as anything switches the mouse back to onboard mode (G HUB starting, for
instance). Persisting them means writing profile flash, which is what this
document is groundwork for.

Notably, neither gaming surface nor LightForce appears in the component list
below — confirming from the vendor's own model that they are device-level, not
profile state.

## Feature 0x8100 enums

Quoted from `logi.hidppio.Feature8100`. Values are enum ordinals starting at 0.

### ONBOARD_MODE

```
0  ONBOARD_MODE_INVALID
1  ONBOARD          device runs from profile flash
2  HOST             software drives settings live
```

Matches what the driver already sends: `ensureHostControl` writes `0x02`.

### MEMORY_MODEL

```
0  MEMORY_MODEL_INVALID
1  MEMORY_MODEL_PROTOSS_HYJAL
```

### PROFILE_FORMAT

```
0  PROFILE_FORMAT_INVALID
1  PROFILE_FORMAT_PROTOSS_HYJAL
2  PROFILE_FORMAT_LOGAN
3  PROFILE_FORMAT_HEAT
4  PROFILE_FORMAT_HARPY
5  PROFILE_FORMAT_HOST_LAYER
6  PROFILE_FORMAT_BAYMAX
```

A device reports its format via `getOnboardProfilesInfo` (function `0x00`).
Layout differs per format, so this value selects which offsets apply.

### SECTOR_COUNT_RULE

```
0  LEGACY
1  RESTRICTED
2  SECTOR_COUNT_RULE_INVALID
```

### FUNCTION_OPCODES

Button assignment opcodes:

```
0  NO_ACTION                          9  SELECT_PREVIOUS_PROFILE
1  TILT_LEFT                         10  CYCLE_PROFILES
2  TILT_RIGHT                        11  G_SHIFT
3  SELECT_NEXT_DPI                   12  BATTERY_LIFE_INDICATOR
4  SELECT_PREVIOUS_DPI               13  ENABLED_PROFILE_SPECIFIC_NUMBER
5  CYCLE_DPIS                        14  TOGGLE_PERFORMANCE_MODE
6  DEFAULT_DPI                       15  HOST_BUTTON
7  DPI_SHIFT                         16  SCROLL_DOWN
8  SELECT_NEXT_PROFILE               17  SCROLL_UP
```

## Profile directory

Sector `0x0000` holds the directory. Each entry (`OnboardProfileDirectoryEntry`)
is **4 bytes**, verified on hardware:

```
00 01 00 ff    sector 0x0001, flag 0x00
00 02 00 ff    sector 0x0002, flag 0x00
00 03 01 ff    sector 0x0003, flag 0x01   <- the active profile
00 04 00 ff
00 05 00 ff
ff ff ff ff    end of list
```

- bytes 0–1: sector, big-endian
- byte 2: flag — `0x01` on the profile that `getCurrentProfile` reports, so it
  reads as "active" rather than the `enabled` the field name suggests
- byte 3: reserved, `0xff`

Terminated by an all-`0xff` entry.

## Sector size

`getOnboardProfilesInfo` reports **255**, and that is a true length, not a max
offset: the format-7 layout ends with `lighting_flag` at `0xfc`, leaving
`0xfd`–`0xfe` for the checksum. 0-254 inclusive.

`memoryRead` returns 16 bytes per call and **rejects any read that would run
past the end of the sector** with `INVALID_ARGUMENT`, so the final chunk cannot
start at `0xf0`. Read the tail from `length - 16` instead and accept the
one-byte overlap with the previous chunk.

## Component model

A profile is not a fixed struct. `profile_memory_manager` holds a set of
*components*, each owning a region of the profile buffer:

- component index table at `+32`, indexed by `component_id`
- vector of `shared_ptr<profile_component>` at `+8`
- `get_component<T>(manager, id)` looks up the index, then `__RTDynamicCast`s
- absent components return index `-1` → `"Component does not exist in this ..."`

Every accessor takes the raw buffer as an argument:

```c
get_report_rate(report_rate_component* self, vector<unsigned char>* buffer)
```

so each component resolves its own offset into the buffer at runtime. This is
why the offsets are not constants anywhere in the binary.

### ComponentId

```
0   report_rate            12  power_off_timeout
1   dpi_v1                 13  logo_power_save
2   color                  14  side_power_save
3   power_mode             15  cluster_0_active
4   angle_snapping         16  cluster_0_passive
5   button_functions       17  cluster_1_active
6   g_shift_function       18  cluster_1_passive
7   profile_name           19  lighting_flag
8   logo                   20  report_rate_wireless
9   side                   21  report_rate_wired
10  write_counter          22  dpi_v6
11  power_save_timeout     23  dpi_delta
                           24  MAX_ID
```

### Component accessors

What each component exposes, from the library's method table:

| Component | Accessors |
|---|---|
| `report_rate` | `get/set_report_rate` |
| `report_rate_wired` | `get/set_report_rate_wired` |
| `report_rate_wireless` | `get/set_report_rate_wireless` |
| `dpi_v1` | `get/set_dpi_table`, `get/set_default_resolution`, `get/set_g_shift_resolution` |
| `dpi_v6` | `get/set_dpi_table`, `get/set_default_index`, `get/set_g_shift_index` |
| `profile_name` | `get/set_utf8_profile_name` |
| `angle_snapping` | `get/set_angle_snapping` |
| `button_fn` | `get/set_buttons` |
| `color` | `get/set_color` |
| `power_mode` | `get_power_mode` |
| `bunny_hopping` | `get/set_bunny_hopping_timeout` |
| `analog_button` | `get/set_actuation_point`, `get/set_rapid_trigger_sensitivity`, `get/set_rapid_trigger_enable`, `get/set_haptic_level` |
| `lighting_x8070` / `x8071` | `get/set_effect_data` |
| `lighting_flags` | `get/set_lighting_flags` |
| `write_counter` | flash write counter |
| `power_save_timeout` / `power_off_timeout` | timeouts |

**Profile names are stored on the device** — `profile_name` is a real component
with `get/set_utf8_profile_name`. Despite the name, the bytes on hardware are
**UTF-16LE**: a profile named `myp` reads `6d 00 79 00 70 00` at `0xa0`, padded
with `0x00` (or `0xff` when never set).

## DPI stage record

`Feature8100.AdvancedDpi`, the per-stage record used by `dpi_v6`:

```c
ushort dpi_x;   // 2 bytes
ushort dpi_y;   // 2 bytes
byte   lod;     // 1 byte
```

Five bytes per stage: `XX XX YY YY LL`.

### LOD encoding

`lod == 0` means **the stage is unused**, not a lift-off level. In
`HIDProfile.cs` the disabled-stage branch zeroes `dpi_x`, `dpi_y` and `lod`
together, and `Models.DPI.InitializeDPI` substitutes `2` when it reads `0`:

```csharp
public void InitializeDPI(int dpi, int dpiy = 0, int lod = 0)
{
    if (lod == 0) { lod = 2; }
```

**Confirmed on hardware.** Captured from G HUB writing the profile on a Pro X
Superlight 2 (format 7), diffed at profile offset `0x08` (`dpi_v6 +6`):

| Change made in G HUB | Byte |
|---|---|
| Medium to Low | `02` → `01` |
| Low to High | `01` → `03` |

So `1 = low, 2 = medium, 3 = high`, with `0` reserved for "stage unused" —
which is why `InitializeDPI` substitutes `2` when it reads `0`.

This also explains a report that OMM "rebuilds DPI stage records with LOD=02".
It does write `2`, but only for stages whose stored `lod` is `0`; the write path
otherwise preserves the loaded value.

**Resolved for format 7.** `logitech/hidpp.ts` used to map feature 0x2202's LOD
byte as `{ Low: 0, Medium: 1, High: 2 }` for every Logitech mouse, and hid `Low`
on everything but the Superstrike. That was the off-by-one above: counting from
zero, writing `0` is rejected and the third level is unreachable, which is
exactly the two-level behaviour the driver hardcoded around.

The Pro X Superlight 2 offers three levels in G HUB and its profile bytes count
from one, so format 7 now uses `{ Low: 1, Medium: 2, High: 3 }` and advertises
all three.

**Settled for every format.** The remaining doubt was whether 0x2202 shared the
profile's numbering, since they are different transports. It does:
[OpenLogi](https://github.com/AprilNEA/OpenLogi) implements 0x2202 with

```rust
pub enum Lod { NotSupported = 0, Low = 1, Medium = 2, High = 3 }
```

which is the same count-from-one scheme, arrived at independently. So `0` is
the feature's "this sensor has no lift-off control" value rather than a level,
and the driver now uses one encoding everywhere instead of keeping a
count-from-zero fallback for unrecognised formats.

What stays per format is which *levels* a device offers — a genuine hardware
difference — not how they are numbered.

OpenLogi's `DpiParameters` field order (`sensor_index, dpi_x, default_dpi_x,
dpi_y, default_dpi_y, lod`) also confirms this repo's byte offsets: with the
3-byte header, x at `[4..5]`, y at `[8..9]`, lod at `[12]`.

## Profile layouts

Recovered with Ghidra from the native registration code. Each component is
registered with a literal `(offset, size)` pair and a component id:

```c
prototype = { vftable, offset, size, ...component-specific fields }
add_<component>(manager, &prototype, component_id)
```

The registration function validates regions against each other — the error
string is *"Component's memory overlaps with other ones"* — so within a format
these ranges are guaranteed disjoint.

All offsets are relative to the start of the profile buffer. Sizes in bytes.

### Format selection

A dispatcher (`FUN_1800e7810`) switches on a format byte and composes builders:

| Format id | Builders | Notes |
|---|---|---|
| 1 | base v1 | |
| 2, 3 | base v1 + x8070 lighting | |
| 4 | base v1 + x8070 lighting + extras | |
| 5 | base v1 + x8071 lighting + counters | |
| 6 | base v6 | |
| 7 | base v6 + bunny hopping | |
| 8 | base v6 + bunny hopping + analog buttons | HITS / Superstrike |

*Inferred:* the switch byte is the `profileFormatId` from
`getOnboardProfilesInfo`. Note there are **8 cases but only 6 names** in the
managed `PROFILE_FORMAT` enum, so ids 7 and 8 are newer formats the managed
wrapper was never updated for. Treat the id→name mapping beyond 6 as unknown and
key off the numeric id.

### Base v1 layout

Builder `FUN_1800ea2b0`. Used by format ids 1–5.

| Offset | Size | Id | Component |
|---|---|---|---|
| `0x00` | 1 | 0 | `report_rate` |
| `0x01` | `0x0a` | 1 | `dpi_v1` |
| `0x0d` | 3 | 2 | `color` |
| `0x10` | 1 | 3 | `power_mode` |
| `0x11` | 1 | 4 | `angle_snapping` |
| `0x20` | `0x40` | 5 | `button_functions` |
| `0x60` | `0x40` | 6 | `g_shift_function` |
| `0xa0` | `0x30` | 7 | `profile_name` |

### Base v6 layout

Builder `FUN_1800ea780`. Used by format ids 6–8. Does **not** include base v1 —
it is a separate layout, not an extension.

| Offset | Size | Id | Component |
|---|---|---|---|
| `0x00` | 1 | `0x14` | `report_rate_wireless` — index into the rate table† |
| `0x01` | 1 | `0x15` | `report_rate_wired` |
| `0x02` | `0x19`* | `0x16` | `dpi_v6` — see below |
| `0x1d` | 4 | `0x17` | `dpi_delta` |
| `0x21` | 1 | 3 | `power_mode` |
| `0x22` | 1 | 4 | `angle_snapping` |
| `0x23` | 2 | 10 | `write_counter` |
| `0x2c` | 2 | `0x0b` | `power_save_timeout` |
| `0x2e` | 2 | `0x0c` | `power_off_timeout` |
| `0x30` | `0x30` | 5 | `button_functions` |
| `0x70` | `0x30` | 6 | `g_shift_function` |
| `0xa0` | `0x30` | 7 | `profile_name` |
| `0xd0` | `0x0b` | `0x0f` | `lighting_x8071` cluster 0 active |
| `0xdb` | `0x0b` | `0x11` | `lighting_x8071` cluster 1 active |
| `0xe6` | `0x0b` | `0x10` | `lighting_x8071` cluster 0 passive |
| `0xf1` | `0x0b` | `0x12` | `lighting_x8071` cluster 1 passive |
| `0xfc` | 1 | `0x13` | `lighting_flag` |

† **Report rate verified on hardware, both links.** The byte indexes
`[125, 250, 500, 1000, 2000, 4000, 8000]`, matching 0x8061's ordering, and the
two links are stored separately — `0x00` wireless, `0x01` wired.

| Capture | Byte | Change |
|---|---|---|
| Wireless 8000 → 1000 Hz | `0x00` | `06` → `03`, checksum `0x6e7c` → `0x20c7` |
| Wireless → 8000 Hz | `0x00` | `03` → `06` |
| Wired → 250 Hz | `0x01` | `03` → `01` |

All reproduced by our encoder, and the second capture confirms writing one link
leaves the other's byte untouched.

**Ceilings are per link and per mouse.** A Pro X Superlight 2 runs to 8 kHz over
Lightspeed but only 1 kHz over the cable, which is a charging connection rather
than a full-rate wired mode. That pair lives in `capabilitiesForFormat` as
`reportRates`, null for any format whose ceilings were never captured — the byte
can index 8000 for either link, so nothing in the encoding itself prevents
offering a rate the hardware cannot reach.

\* **`dpi_v6` verified on hardware.** The registered `(0x02, 0x19)` does not
describe the whole region. A real format-7 profile reads:

```
0x02  default resolution index
0x03  g-shift resolution index
0x04  stage 1   20 03 20 03 01   ->  800/800   lod 1
0x09  stage 2   b0 04 b0 04 02   -> 1200/1200  lod 2
0x0e  stage 3   40 06 40 06 02   -> 1600/1600  lod 2
0x13  stage 4   60 09 60 09 02   -> 2400/2400  lod 2
0x18  stage 5   80 0c 80 0c 02   -> 3200/3200  lod 2
```

So the region really spans `0x02`–`0x1c`, and `dpi_delta` follows at `0x1d`.
**DPI values are little-endian** — `AdvancedDpi.dpi_x` is a `ushort` in native
byte order, not the big-endian used elsewhere in HID++.

Stage offsets `0x04, 0x09, 0x0e, 0x13, 0x18` with LOD at `0x08, 0x0d, 0x12,
0x17, 0x1c`. The `0x19` in the registration is presumably the table size alone
(5 × 5), with the two index bytes tracked by the component's extra fields.

### Format-keyed setting limits

Limits that used to be decided by a model check now hang off the reported
format, in `capabilitiesForFormat`. The mouse announces its format through
`getInfo`, so a new model on a known format inherits the limits without being
named in the driver.

| Format | LOD levels | Encoding | DPI slots | DPI range | Source |
|---|---|---|---|---|---|
| 7 | Low, Medium, High | 1, 2, 3 | 5 | 100–32000, step 50 | Captured from G HUB on a Pro X Superlight 2 |
| 8 | Low, High | 0, 1, 2 | — | — | Observed on a PRO X 2 Superstrike |
| everything else, and unknown | Medium, High | 0, 1, 2 | — | — | Prior driver default |

Slot count and DPI range are properties of the mouse, not of the app: an older
format can hold fewer slots over a much narrower range, and base v1 has no
stage table at all. `dpiStages` is therefore `null` for every format whose
numbers were never captured, and the UI hides the slot editor rather than
borrowing format 7's limits. Format 8 almost certainly holds five slots, since
it shares the v6 stage table, but its sensor range is unknown — so it is left
null rather than half-guessed.

Format 8 is taken to be the Superstrike format because it is the only one
carrying the analog-button block, which is that mouse's distinguishing feature.
That is an inference from the layout, not a reading off the device.

The fallback is the behaviour the driver had for every non-Superstrike mouse. On
format 7 that turned out to be an off-by-one rather than a hardware limit (see
the LOD encoding section), so treat the fallback as unconfirmed rather than as
fact: capture the same G HUB diff on another format before trusting it.

Transport limits stay where they are. The Superstrike's 1 kHz cap over USB is a
property of that USB interface, not of its profile format, so it is still keyed
on the product id.

### Per-format additions

**Ids 2, 3** (`FUN_1800ea4b0`) — base v1 plus:

| Offset | Size | Id | Component |
|---|---|---|---|
| `0xd0` | `0x0b` | 8 | `lighting_x8070` (logo) |
| `0xdb` | `0x0b` | 9 | `lighting_x8070` (side) |

**Id 4** — the above plus:

| Offset | Size | Id | Component |
|---|---|---|---|
| `0x12` | 2 | 10 | `write_counter` |
| `0x1c` | 2 | `0x0b` | `power_save_timeout` |
| `0x1e` | 2 | `0x0c` | `power_off_timeout` |
| `0xe6` | `0x0b` | `0x0d` | `lighting_x8071` |
| `0xf1` | `0x0b` | `0x0e` | `lighting_x8071` |

**Id 5** (`FUN_1800ea590`) — base v1 plus:

| Offset | Size | Id | Component |
|---|---|---|---|
| `0x12` | 2 | 10 | `write_counter` |
| `0x1c` | 2 | `0x0b` | `power_save_timeout` |
| `0x1e` | 2 | `0x0c` | `power_off_timeout` |
| `0xd0` | `0x0b` | `0x0f` | `lighting_x8071` cluster 0 active |
| `0xdb` | `0x0b` | `0x11` | `lighting_x8071` cluster 1 active |
| `0xe6` | `0x0b` | `0x10` | `lighting_x8071` cluster 0 passive |
| `0xf1` | `0x0b` | `0x12` | `lighting_x8071` cluster 1 passive |
| `0xfc` | 1 | `0x13` | `lighting_flag` |

**Id 7** (`FUN_1800eab60`) — base v6 plus:

| Offset | Size | Id | Component |
|---|---|---|---|
| `0x25` | 1 | `0x18` | `bunny_hopping` — timeout in ms ÷ 10‡ |

‡ **Verified on hardware.** G HUB exposes a 100–1000 ms bunny-hop time, stored
as milliseconds ÷ 10, with `0x00` meaning off:

| G HUB | Byte | Sector 3 checksum |
|---|---|---|
| off | `0x00` | `0x6e7c` |
| 100 ms | `0x0a` | `0xd92c` |
| 200 ms | `0x14` | `0x10fd` |

So the range maps to `0x0a`–`0x64`. Each transition was reproduced byte for
byte by OpenMouse's encoder, including regenerating the checksum, and turning
it off returns the sector to its earlier state exactly.

**Id 8** — the above plus:

| Offset | Size | Id | Component |
|---|---|---|---|
| `0x26` | 6 | `0x19` | `analog_button` |

### Component ids beyond the managed enum

The native code uses ids the managed `ComponentId` enum does not name — it stops
at `23 dpi_delta` / `24 MAX_ID`, while the native registration uses:

```
0x18  (24)  bunny_hopping
0x19  (25)  analog_button
```

So the managed enum is stale relative to native, exactly as the format enum is.
Prefer the ids observed in the registration code.

## Profile checksum

**CRC-16/CCITT-FALSE**: polynomial `0x1021`, init `0xFFFF`, no input or output
reflection, no final XOR.

- computed over the buffer **excluding its last two bytes**
- stored in those last two bytes, **big-endian** (`buf[n-2]` high, `buf[n-1]` low)

From the validator (`FUN_1800e3f70`), which reports `"CRC Checksum Failed"`:

```c
uVar1 = _Dst[len - 2];
uVar2 = _Dst[len - 1];
sVar5 = compute_crc(&buffer);
if (sVar5 != CONCAT11(uVar1, uVar2)) { /* CRC Checksum Failed */ }
```

and the algorithm (`FUN_1800e76f0`), unrolled eight times per byte:

```c
crc = 0xffff;
for (i = 0; i < len - 2; i++) {
    crc ^= buf[i] << 8;
    for (bit = 0; bit < 8; bit++)
        crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
}
```

Reference implementation:

```ts
function profileCrc(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length - 2; i += 1) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}
```

Note the earlier assumption of init `0x0000` in this document's history was
wrong; it is `0xFFFF`. `HIDPP_PROTO_LIGHTSPEED_2_CA_CRC24` is unrelated, as are
the `crc32` symbols (zip/deflate).

## The write sequence is verified

`probeProfileWriteSequence` proved `memoryAddrWrite` → `memoryWrite` →
`memoryWriteEnd` on a Pro X Superlight 2 (format 7), so
`PROFILE_DPI_WRITES_ENABLED` is on.

A no-op rewrite would not have settled it: writing a sector's own bytes back
reads identical whether the write landed **or was silently dropped**. The probe
therefore makes a detectable change and undoes it, and both halves must pass.

Result on format 7, sector `0x0002` (255 bytes), padding byte `0x00cf`:

| Step | Read-back | Checksum |
|---|---|---|
| `0xff` → `0xfe` | matched byte-for-byte | valid |
| `0xfe` → `0xff` (restore) | matched byte-for-byte | valid |

The probe picks a **disabled** sector that is not the active profile, refuses if
there isn't one, checks the checksum before writing, and holds the original
bytes for restore. Run it again before trusting a format it has not been run on.

### Settings sharing a sector are written together

Flash erases a whole sector, so `writeActiveProfile` takes every changed
setting at once and writes once. Applying bunny hop and the DPI table
separately would cost two erase cycles, and the second write would be built
from a read the first had already invalidated — losing one of the two. The UI
stages them into a single pending-change group for the same reason.

## What is still unknown

**Which format id each device reports.** Read `profileFormatId` from
`getOnboardProfilesInfo` per device. Format 8 is the analog-button (HITS)
layout, so it is the Superstrike; a Superlight 2 is most likely 7, but that is a
guess until read from hardware.

**Names for format ids 7 and 8**, and the meaning of the extra
component-specific prototype fields (for example `dpi_v6` carries
`0, 1, 2, 5, 5, 0, 2, 4` after offset and size — plausibly stage count, stride
and sub-field offsets, but not decoded).

**A reported stage layout that does not match.** One account described DPI stage
offsets `0x04, 0x09, 0x0e, 0x13, 0x18` with LOD at `0x08` etc. The 5-byte stride
agrees, but base v6 puts `dpi_v6` at `0x02`, giving `0x02, 0x07, 0x0c, ...`.
Either that account covers a different format, or its offsets are relative to
something other than the profile start. Unresolved — verify against a real dump
before trusting either.

## Verifying before writing

These offsets are read from vendor code, not from hardware. Confirm against a
real device before writing anything:

1. Read a profile sector with `memoryRead` and check that decoded values match
   what G HUB or OMM shows
2. `profile_memory_manager::to_string(self, out_string, buffer)` is Logitech's
   own profile decoder — hosting the DLL in a .NET Framework 4.8 harness (it is
   mixed-mode C++/CLI and cannot load in .NET 9) gives an independent decode to
   diff against
3. Cross-check by capturing OMM writing a single changed field

## Flash wear and write safety

### Reads cost nothing

Flash reads involve no erase cycle. `memoryRead` can be called freely; the only
cost is time — roughly 16 round trips per sector, which is why the UI caches
profiles rather than reading them in the status refresh loop.

### Writes are whole-sector

`memoryAddrWrite` → `memoryWrite` × N → `memoryWriteEnd`. There is no partial
write: changing a single DPI value rewrites all 255 bytes, so **every save costs
one erase/write cycle** no matter how little changed.

`memoryWriteEnd` validates the checksum, so a bad CRC should be rejected rather
than committed. That protects against corruption, not against wear.

### Endurance

The exact flash part and its rating are unknown, so no cycle count should be
quoted as fact. Embedded flash is typically in the 10k–100k erase-cycle range.

What *is* known: the profile format contains a dedicated **`write_counter`**
component (id 10, `0x23` in the v6 layout). Logitech built a per-profile write
odometer into the format, which is not something you add unless wear matters.
On a factory device it reads `ff ff` — erased, never maintained.

A handful of saves per session is irrelevant even at the pessimistic end.
Automated writing is what destroys flash.

### Rules for any write path

1. **Explicit Save only.** Never write on drag, change, or focus loss.
2. **Diff before writing.** Build the new sector, compare against what was read,
   skip if identical. This alone prevents the most common accidental wear —
   a Save button pressed twice.
3. **Rate-limit in the driver**, not in the UI, so no caller can bypass it.
4. **Never write on connect, sync or restore.** Re-applying stored settings at
   startup is exactly how a write path turns into thousands of cycles.
5. **Maintain `write_counter`** and surface it. It is the format's own wear
   odometer.

### Power loss mid-write

On a wireless mouse the device can sleep, be switched off, or leave range
between `memoryAddrWrite` and `memoryWriteEnd`, leaving a sector half-written.
The CRC means it reads as invalid rather than silently wrong, and G HUB or OMM
can rewrite it — but check battery and connection before committing, and keep
the write window short.

### Prefer host mode for experimentation

Host mode (`setOnboardMode` → `0x02`) is live and volatile: it costs **zero**
flash cycles. It is the right place to try DPI and lift-off settings. Onboard is
for committing something already settled on.

This is also the honest fix for "my DPI reset itself": rather than making every
DPI change write flash, let the user experiment in host mode and offer one
explicit "save to onboard profile".

### Device-level settings (0x8090)

Gaming surface and LightForce are **not** profile state — they are not in the
component list and do not touch profile flash. Where the firmware persists them
is unknown:

- they survive app restarts, G HUB restarts and reconnects (observed)
- whether they survive a power cycle has **not** been tested

If they are NVM-backed they carry some write cost; if they are RAM-only there is
none. Either way `setModeStatusField` skips the write when the requested value
is already set, so re-selecting the current option is free. These are
user-driven toggles clicked occasionally, so wear is not a practical concern —
but nothing should ever write them in a loop or on a restore path.

### Other formats

Offsets are format-specific; never apply one format's layout to another. Only
ship writes for devices tested on real hardware. Decoding and dumping other
formats is safe; writing on inference is not.
