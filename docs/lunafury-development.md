# LunaFury setup and release

These controls use `@openmouse/protocol` `0.42.1`, pinned in the app's manifest
and lockfile. The published package includes the APIs from
[protocol PR #205](https://github.com/OpenMouse-Project/mouse-protocol/pull/205).

## Local setup

Use Node.js 24 and install dependencies from the npm registry:

```bash
git clone --branch codex/lunafury-onboard-controls https://github.com/sekiranunn/openmouse.git openmouse
cd openmouse
npm ci
npm run check
npm run size
npm audit --audit-level=high
npm run dev
```

No local protocol checkout or tarball override is needed. Keep the protocol
dependency pinned to an exact stable npm version.

## Validation scope

Games keeps originals separately for each device connection and onboard bank.
Switching banks lets the same game apply to the newly selected bank without
reusing another bank's backup. After the game exits, the selected bank is restored;
inactive banks retain their in-memory backups until selected again. Restoration
does not switch the active bank. Failed restores retain that bank's backup for retry.

Run the build, tests, bundle checks and audit after a registry-only clean install.
The integration suite uses synthetic HID and Bridge callbacks to exercise the
published protocol through the controller and UI callbacks.

The owner verified LUNA33 internal firmware `0.0.26.0` over cable and 8K:
button polling, profiles, DPI, mappings, sleep, receiver lighting and reconnect.
TYPE33, bottom-button behavior and Games apply/restore have no separate hardware result.
See the [protocol notes](https://github.com/sekiranunn/mouse-protocol/blob/codex/lunafury-onboard-controls/docs/lunafury-testing.md).

For public firmware versions, device matching and manifest maintenance, see
the [firmware notes](./lunafury-firmware.md).
