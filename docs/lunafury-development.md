# LunaFury branch development

This branch uses new APIs from the matching `mouse-protocol` branch. The app
still pins the official `@openmouse/protocol` release, `0.27.0`, so running
`npm ci` alone does not install those APIs. The existing CI workflow also
uses that release; it cannot validate this branch until the protocol changes
are published and the dependency is updated.

## Local setup

Use Node.js 24 and clone both branches into sibling directories:

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

`0.1.0` is the protocol checkout's current local package version. If it
changes, use the filename printed by `npm pack`. The local install leaves
the app's manifest and lockfile unchanged. Repeat it after any app `npm ci`
or protocol source change; rebuild and repack the protocol first when needed.

## Hardware status

The owner confirmed the existing LunaFury controls, onboard profiles, button
remapping, receiver lighting, sleep and revised DPI editor on LUNA33 firmware
`0.0.26.0`, over cable and the 8K receiver. The new bottom-button power/DPI
behavior still needs hardware testing; TYPE33 also remains unverified.

The protocol repository contains the packet evidence and hardware checklist
in [`docs/lunafury-testing.md`](https://github.com/sekiranunn/mouse-protocol/blob/codex/lunafury-onboard-controls/docs/lunafury-testing.md).
This public branch uses generic artwork and excludes the private test-site
files and vendor images.

## DPI and bank-operation regressions

Games snapshots now save a stage selection independently of its displayed
DPI. Older scalar snapshots address the selected target stage; actual edits
back up both tables so restoration can undo them. The controller integration
tests use its real draft, staging, Apply and restore paths with a synthetic
HID device, including pending user edits and stage-count changes.

The paired protocol branch refreshes the active DPI stage and both tables
during LunaFury live reads. Its older bank-scoped setters and status reads
now share the queue used by bank switches and the newer setters. Other
brands retain their existing execution paths. These regression checks are
automated; they do not add a new hardware-verification result.
