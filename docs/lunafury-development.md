# LunaFury development and release

The onboard controls, button remapping and receiver settings on this branch
use new APIs from the matching `mouse-protocol` branch. The app still pins
`@openmouse/protocol` at `0.27.0`, which does not contain those APIs. A plain
`npm ci` restores that release and the application build fails. Use the
paired setup below for local review; the application PR must remain a draft
until a published protocol release provides the APIs.

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

`0.1.0` is the protocol checkout's local package version, not the version of
the published release. If it changes, use the filename printed by `npm pack`.
This install leaves the app's manifest and lockfile unchanged. Repeat it
after any app `npm ci`. After a protocol source change, rebuild and repack
before reinstalling it in the app.

## Release order

1. Merge the protocol changes first. The protocol repository uses
   Conventional Commits and semantic-release; a `feat:` squash title allows
   its release workflow to publish the added APIs after `main` passes CI.
2. Confirm that the published package contains the new LunaFury exports and
   driver methods. A newer version number alone does not establish that.
3. Update the app's protocol dependency to that exact stable npm version and
   regenerate the lockfile. Do not commit the local tarball override or a
   Git/file dependency. The approved runtime-dependency policy is unchanged.
4. Run a clean `npm ci`, `npm run check`, `npm run size` and the CI audit
   against the registry package, without reinstalling the local tarball.
   Remove the branch-only README warning and replace this setup note when
   the published dependency works. Then make the app PR ready for review.

Both topic branches also need to incorporate the current upstream `main`
before final validation. The checks below describe the existing paired
branches, not a future upstream merge or published-package installation.

## Hardware status

The owner tested LUNA33 firmware `0.0.26.0` over cable and the 8K receiver.
They confirmed the existing LunaFury controls, button polling, all three
onboard profiles, button remapping, sleep and the revised DPI editor. All
four receiver light modes worked over the 8K receiver, and cable connections
did not show the lighting control. Reconnect readback was also confirmed.
The new bottom-button power/DPI behavior still needs hardware testing;
TYPE33 remains unverified. Games apply/restore has automated coverage but
has not received a separate hardware result.

The protocol repository contains the packet evidence and hardware checklist
in [`docs/lunafury-testing.md`](https://github.com/sekiranunn/mouse-protocol/blob/codex/lunafury-onboard-controls/docs/lunafury-testing.md).
This public branch uses generic artwork and excludes the private test-site
files and vendor images.

## Automated validation

The paired application build and all 334 application tests pass, including
15 controller integration tests. Bundle checks pass at 205,473 / 210,000
bytes for CSS and 2,119,670 / 2,150,000 bytes for JavaScript. These results
use the local protocol tarball; they do not establish that a registry-only
install builds.

The protocol build and all 151 Lamzu driver/codec tests pass. The broader
protocol regression run on 2026-10-10 passed 2,252 tests but excluded two
registry exhaustive checks: `the probe matrix can trigger every driver` and
`no device can be claimed by more than one driver`. A full protocol CI pass
is still required before merge.

### DPI and bank-operation regressions

Games snapshots distinguish selecting a stage from editing its DPI. Older
scalar snapshots address the selected target stage. When games switch,
the lower-priority legacy scalars are resolved into tables before the new
target is merged. New tables therefore override prior restore values;
legacy targets still override restore tables in the opposite direction.

DPI edits and count changes back up the complete five- or six-slot X/Y
storage separately from the enabled count. Restore puts dormant slots back
before applying table edits and selection. Re-enabling a hidden slot then
reads its original value, including Y values stored while the axes are
linked. This backup is held in memory and excluded from saved Games
snapshots and imports. The protocol rejects a backup for another bank and
verifies every stored slot on readback.

The controller tests use the real draft, staging, Apply and restore paths
with synthetic HID devices. They cover both cross-format switch directions,
expansion followed by restore and re-enabling on all four runtime PIDs,
pending user edits, shrinking counts and combined axis-mode/DPI edits.
The two cross-format cases and four expansion cases failed before the
2026-10-10 fixes and pass with them. The Bridge hook itself is not mounted
by this harness; the tests call the same merge functions and controller path.

The paired protocol branch refreshes the active DPI stage and both tables
during LunaFury live reads. Its older bank-scoped setters and status reads
now share the queue used by bank switches and the newer setters. Other
brands retain their existing execution paths. These tests use simulated
devices and do not add a hardware-verification result.
