# LunaFury firmware manifest

The entries in `scripts/firmware-manifest.extra.json` use the public production
[LunaFury driver](https://mouse.lunafury.games/), checked on 2026-10-14.
The model table in [app.9b5df071.js](https://mouse.lunafury.games/js/app.9b5df071.js)
provides the runtime VID/PIDs and firmware filenames. Its update dialog reads
the mouse version from `DeviceFWFile_00` and the receiver version from
`Receiver4K8KFWFile_00`.

| Model | Mouse interfaces | Receiver interface | Public version | Driver readout |
| --- | --- | --- | --- | --- |
| LUNA33 | `373e_0032`, `373e_0033` | `373e_0033` | `0.0.25.0` | `25.0` |
| TYPE33 | `373e_0054`, `373e_0084` | `373e_0084` | `0.0.1.47` | `1.47` |

Each model has separate `Mouse` and `Dongle` entries. The connected interface
identifies the model; the firmware label identifies which component is compared.
Mouse entries include both cable and receiver interfaces because the receiver
also returns the paired mouse's version. Dongle entries match only receivers.
Bootloader PIDs and name-only matches are excluded.

Protocol 0.42.1's CompX decoder formats the last two version bytes, so
`latestVersion` uses the two-part driver readout. Both public versions above
have zero first and second bytes. Recheck the decoder if those bytes change;
do not discard nonzero version components. A newer internal version, such as
LUNA33 `26.0`, does not trigger an update or downgrade prompt.

## Published files

All six URLs returned HTTP 200 with binary content on the verification date.
The official updater uses `fwfiles/<ModelCN>/<filename>`; TYPE33's `FWFolder`
value (`TYPE33_54H`) is not the download directory used by its update dialog.

| Model | Component | File under `https://mouse.lunafury.games/fwfiles/` |
| --- | --- | --- |
| LUNA33 | Mouse | `LUNA33/LunaFury33_Mouse_840_App_v0.0.25.0_20260202.xvi` |
| LUNA33 | Receiver 00 | `LUNA33/LunaFury33_8K_Dongle_AT405_App_v0.0.25.0_20260202.xvi` |
| LUNA33 | Receiver 01 | `LUNA33/LunaFury33_8K_Dongle_820_App_v0.0.25.0_20260202.xvi` |
| TYPE33 | Mouse | `TYPE33/TYPE33_Mouse_54H20_App_v0.0.1.47_20261009.xvi` |
| TYPE33 | Receiver 00 | `TYPE33/TYPE33_Dongle_305_App_v0.0.1.47_20261009.xvi` |
| TYPE33 | Receiver 01 | `TYPE33/TYPE33_Dongle_54L15_App_v0.0.1.47_20261009.xvi` |

The updater accepts both receiver files. OpenMouse reads target 0 as `Dongle`
and does not expose separate version verdicts for both receiver components.
The manifest follows the official dialog's Receiver 00 comparison and links
to the official driver, which selects and updates the appropriate files.
It does not offer direct binary downloads or perform flashing.

## Maintenance

These entries are maintained manually. For a public release, read the current
production page's linked app script, verify the model table and file URLs,
and update the matching entries in `scripts/firmware-manifest.extra.json`.
Then regenerate with `node scripts/generate-firmware-manifest.mjs` and review
`public/firmware-manifest.json`. Preserve model and component boundaries even
when two files share a version. Test or internal firmware must not become the
public baseline.

Tests cover actual protocol readouts on all four runtime PIDs, component
isolation, missing versions, unknown and bootloader IDs, and older/current/newer
firmware. They do not flash hardware.
