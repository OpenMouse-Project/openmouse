# Logitech firmware updater — Windows grab-list + agent handoff

Date: 2026-10-09. Goal: no user ever needs G HUB; OpenMouse detects,
downloads, verifies, and flashes Logitech firmware itself.

## Part 1 — Grab from the Windows machine

G HUB for Windows keeps the same depot cache layout as macOS. Everything
below is read-only copying of files G HUB already downloaded for hardware
you own. Copy to a USB stick / cloud folder preserving directory names.

### A. Firmware packages (highest value)

1. In Explorer address bar: `%ProgramData%\LGHUB\depots\`
2. Search that folder for `dfu.json` (search box, top right). Every folder
   containing one is a firmware package.
3. For each such folder, copy the whole folder. Priority order:
   - Anything with `superlight`, `pro_x`, `lightspeed`, or `receiver` in
     the path (PRO X SUPERLIGHT 2c + PRO LIGHTSPEED receiver coverage)
   - Anything ending in `_dfu`
   - Everything else with a `dfu.json` if space allows
4. Each folder should contain `dfu.json` (version + interface IDs + hashes),
   `manifest.json` (binary map), one or more `*.dfu` binaries, and
   `release_notes/`. If a folder has `dfu.json` but no `.dfu`, copy it
   anyway (metadata still helps).

### B. G HUB logs from an actual flash (gold dust)

1. In G HUB, start the PRO LIGHTSPEED receiver update (INSTALL) and let it
   finish completely. Do not unplug anything mid-flash.
2. Afterwards, collect every `*.log` / `*.log.*` file under:
   - `%ProgramData%\LGHUB\`
   - `%LOCALAPPDATA%\LGHUB\` and `%APPDATA%\LGHUB\` (if they exist)
   - Search the C: drive for `*lghub*.log*` and `xlog*` if the above are empty
3. The `dfu_diag` / `dfu_worker` / `feature_00d0_dfu` lines record the exact
   state machine (packet counts, retries, reboot timing) — that is what we
   cross-check our implementation against.

### C. Bootloader USB IDs (30 seconds in Device Manager)

1. Start the receiver update again (or watch during any firmware flash).
2. While flashing: Device Manager → View → "Devices by connection", find
   the Logitech entry that appears/disappears, note its VID:PID
   (expect `046D:0ADx` family). Screenshot it.
3. This confirms which bootloader PID each device re-enumerates as — the
   updater opens exactly that device for the Yeti phase.

### D. USBPcap capture (optional, best evidence available)

Only if the above leaves gaps: install USBPcap + Wireshark on Windows,
capture on the hub the receiver is plugged into, run one G HUB receiver
flash, save the `.pcapng`. That file contains the exact Yeti wire bytes
and ends all guessing. One capture is enough — do the receiver, not the
mouse (receiver DFU is fully mapped already).

### E. Do NOT bother with

- G HUB installers, the app itself, or account data — useless for this.
- `keys.json`-style signing keys — red herrings for our purposes.
- Registry exports — nothing needed lives there.

## Part 2 — Notes for the agent (session handoff)

### Repo state (2026-10-09 EOD)

- `openmouse`: `logitech-firmware-updates` merged to `main` and pushed.
  351/351 tests green. Dev server last on `:5174`.
- `mouse-protocol`: same branch merged locally, direct push to `main`
  blocked by branch protection (needs 5 CI checks) → **PR #187 open**,
  merge it in the GitHub UI once CI is green. Then `git pull` local main.
- `openmouse-desktop`: left dirty on purpose — earlier firmware experiment
  (`lib/firmware-updates.ts`, `hooks/use-firmware-updates.ts`, Overview
  row, `public/firmware-manifest.json`) was superseded by the webapp.
  Strip just those files when convenient; other uncommitted work there is
  the user's, do not touch.
- Dev servers may still be running (`:5174` webapp, `:1420` desktop).

### Verified ground truth (user hardware: PRO X SUPERLIGHT 2c + dongle)

- Mouse: pid `0x40b7`, model `pro_x_2_compact_wireless_mouse`, entities
  `BL2 50.00` (bootloader, own version line) + `MPM 38.00` (== package
  `38.0.5` shown by G HUB). Card shows both up to date. Correct.
- Receiver: live dfu entity `rev0000`, package `14.4.20.0` vs device
  `14.3.19`, `isRequired`, pairing warning — matches G HUB's blue banner.
  0xF1 reads: `mcu=1 → 01 07 02` (MPR07 7.x line), `mcu=2 → 02 00 11`
  (STM32 line, mapping to 14.x still provisional — see open questions).
- Binaries on disk (Mac): `.../LGHUB/depots/876194/93bbe5f7-.../` —
  `pro_receiver_m2_v14_04_20.dfu` + `pro_receiver_m1_v07_02_11.dfu`,
  SHA256 verified against `dfu.json`. `.dfu` header: `04 01 "CC14_D0"`.
- Endpoints (all verified live, no auth on file URLs):
  `https://updates.ghub.logitechg.com/depots/<uuid>/<name>.depot`
  (200, byte-exact). Listing (780 depots) is NOT browser-browsable;
  harvest via local G HUB WS `127.0.0.1:9010` (`{path,verb}` JSON framing,
  subprotocol `json`): `GET /updates/info`, `/dfu/info` (needs payload
  `{"@type": ".../dfu.Info.Request"}`), `/devices/list`. Probe script
  pattern saved this session in `/tmp` (rewrite, it was temp).
- Full 780-depot listing saved during session to a temp file (1.2MB,
  ask user if lost — re-harvestable in one command while G HUB runs).

### Open questions (in priority order)

1. **MCU2 decode**: `[02,00,11]` → treated as `2.0.17` vs package
   `14.4.20`. Decisive test: user flashes via G HUB, we re-read; whatever
   the bytes become is the reference for 14.4.20. Do this FIRST — it
   decides whether the receiver verdict logic is right.
2. **Yeti framing**: port from fwupd (public, vendor-blessed) —
   `plugins/logitech-hidpp/`: `fu-logitech-hidpp-bootloader-{nordic,texas}.c`,
   `fu-logitech-hidpp-device.c`, `fu-logitech-hidpp.rs` (cmd enum 0x10–0xe0,
   packet struct, HID++ message framing). HID++-transported → WebHID can
   send it; raw-USB control transfers (if any phase needs them) belong in
   the Tauri desktop app, not the webapp.
3. **0x00D0 function IDs + packet layout**: not in strings; fwupd port or
   USBPcap (Part 1D) closes it. Never invent these bytes.
4. **Encrypted depots** (some keyboards, UUID-named packs): `{"header-sha",
   "key-id"}` index variant — generator skips with warning. Keys ship
   on-disk (94 in `keys.json`) but reimplementing vendor crypto is out of
   scope; cover via `firmware-manifest.extra.json`.
5. **MPR07/MCU1 vs STM32/MCU2 split** on shared interfaceIds (`046d_c54d`
   etc.): manifest can't split by MCU yet; entries may false-positive
   across generations. Documented in `extra.json` releaseNotes.

### Environment gotchas (learned the hard way)

- G HUB agent (`lghub_agent`) holds the receiver: root/0x00 requests
  answer `device busy (0x08)` while it runs. `pkill -f lghub_agent`
  (plus `lghub_system_tray`) before any WebHID receiver work. Mouse-slot
  traffic is unaffected, which makes this confusing.
- Manifest cache is 24h in `localStorage` (`...-cache.v3` key); the card's
  Check button force-refreshes. Any "still seeing old data" report means
  click Check (or bump the key).
- jsDelivr serves `public/firmware-manifest.json` from the repo path —
  works automatically once on `main`; until then the CDN fetch 404s and
  the app falls back to same-origin (by design, just noisy in console).
- `@openmouse/protocol` in the webapp resolves to registry `dist`, NOT
  the local checkout — protocol methods (e.g. `readReceiverFirmware`)
  are invisible to the webapp until published. The controller carries a
  marked TEMPORARY local copy; delete it after the next protocol release.
- The `edit` tool intermittently fails to match (long blocks, `?.`/`??`
  heavy files): fall back to full-file `write` or python line surgery,
  and verify with `tsc --noEmit` after every patch (several splices
  collided this session — always re-read before patching).
- zsh: never `echo ===` (parses as command). Quote heredocs (`<<'EOF'`)
  and prefer script files over `python3 -c` for anything with quotes.
- `npm test` in mouse-protocol exceeds shell timeouts; run per-file
  (`npx tsx --test src/drivers/logitech/<name>.test.ts`).
- `npm run build` (vite) in webapp is the real gate and is fast; `tsc`
  must pass first.

## Addendum 2026-10-09 EOD — Windows handoff + disproven decode

Source: `/Volumes/nas/storage/OpenMouse/Logitech-firmware-capture-handoff-2026-10-09/`
(README.md, CAPTURE-STATUS.txt, `LGHUB/depots/{824196,876190}`, `hid-read/`,
`Logi/GHUB/Logs/`, `ghub-ws-replies.json`, `logitech-usb-transitions.jsonl`,
`probe-ghub-ws.mjs`, `watch-logitech-usb.ps1`).

- Receiver flashed via G HUB on Windows: **successful**. Post-flash
  `/dfu/info` shows `rev0000.state=STATE_NONE`, `isRequired=false`.
- **Bootloader PID observed live: `046D:AB24`** (runtime `046D:C54D` →
  bootloader `046D:AB24` → runtime). The `0ADx` list stands as
  string-observed only; `vendors.ts` now records both provenances.
- **0xF1 decode disproven**: post-flash reads are byte-identical
  (`mcu=1 → 01 07 02`, `mcu=2 → 02 00 11`). The replies are per-MCU
  **bootloader identifiers**, not app versions. Receiver manifest version
  entries removed (`extra.json`); receiver card shows bootloader readout
  with an honest Unknown verdict until an app-version source is found.
  All related comments reframed (controller, card, protocol `hidpp.ts`).
- Depot `824196` (MCU2 14.2.18) + `876190` (MCU2 14.4.20): real version
  movement; only structural diff is version/hash/`retryStuckBootloader`.
- No USBPcap (UAC canceled at driver launch) and no dfu logs on disk —
  wire bytes and 0x00D0 function IDs still open. fwupd port remains the
  planned source (see prior session notes).
- Windows capture framing (`read-receiver-f1.cjs`, node-hid) matches the
  webapp probe byte-for-byte: `[0x10, 0xff, 0x81, 0xf1, mcu, 0, 0]`.
