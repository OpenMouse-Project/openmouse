# LunaFury setup and release

These controls require APIs from the paired protocol branch.
The app's pinned `@openmouse/protocol` `0.40.1` lacks them.

## Local setup

Use Node.js 24 with the two branches in sibling directories:

```bash
git clone --branch codex/lunafury-onboard-controls https://github.com/sekiranunn/mouse-protocol.git mouse-protocol
git clone --branch codex/lunafury-onboard-controls https://github.com/sekiranunn/openmouse.git openmouse
cd mouse-protocol
npm ci
npm run build
npm pack --ignore-scripts --pack-destination ..
cd ../openmouse
npm ci
npm install --no-save --package-lock=false ../openmouse-protocol-0.1.0.tgz
npm run check
npm run size
npm run dev
```

`0.1.0` is the checkout's local package version. Use the filename printed by
`npm pack` if it changes. Repeat the no-save install after an app `npm ci`;
rebuild and repack after protocol changes. Manifest and lockfile remain unchanged.

## Release order

1. Complete protocol CI against the current upstream base.
2. Merge and publish the protocol, then confirm the package contains the required APIs.
3. Pin that exact stable npm version in the app and update its lockfile.
4. Run registry-only `npm ci`, `npm run check`, `npm run size` and audit.
   Remove the temporary README warning and make the app PR ready for review.

Do not commit a local tarball override or Git/file dependency.

## Validation scope

The paired app passes its build, 511 tests, bundle checks and audit with the local
protocol package. The protocol passes its build, all 2,470 tests and package checks;
158 Lamzu driver/codec tests also pass with real timers. Local checks do not
replace upstream CI or registry-only app validation.

The owner verified LUNA33 firmware `0.0.26.0` over cable and 8K:
button polling, profiles, DPI, mappings, sleep, receiver lighting and reconnect.
TYPE33, bottom-button behavior and Games apply/restore have no separate hardware result.
See the [protocol notes](https://github.com/sekiranunn/mouse-protocol/blob/codex/lunafury-onboard-controls/docs/lunafury-testing.md).
