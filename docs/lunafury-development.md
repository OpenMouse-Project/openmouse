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

The paired application build and all 384 application tests pass, including
62 controller/Bridge integration tests. Bundle checks pass at 205,473 / 210,000
bytes for CSS and 2,120,700 / 2,150,000 bytes for JavaScript. These results
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
storage separately from the enabled count. When switching games, the app
composes the final enabled count and X/Y slots from that backup and the new
target, then stages one complete-table write followed by stage selection.
It does not restore the old count first and queue individual slot edits
against the previous game's status. A final table already on the mouse
requires no table write. Exiting restores the original complete storage,
so re-enabling a hidden slot reads its original value, including Y values
stored while the axes are linked. The backup stays in memory and is excluded
from saved Games snapshots and imports. The protocol rejects another bank
and verifies every stored slot on readback.

The controller tests use the real draft, staging, Apply and restore paths
with synthetic HID devices. They cover both cross-format switch directions,
expansion followed by restore and re-enabling on all four runtime PIDs,
pending user edits, shrinking counts and combined axis-mode/DPI edits.
The two cross-format cases and four expansion cases failed before the
2026-10-10 fixes and pass with them. Those cases call the same merge
functions and controller path used by the Bridge hook.

Three further switch counterexamples are included in the controller suite:
both games use the same edited DPI table but a different selection; both
require four stages but different fourth-slot values; and the first uses
the model's maximum count while the second needs four stages. The last is
six-to-four on LUNA33 and five-to-four on TYPE33. All three run on each of
the four PIDs, producing 12 cases that failed before final-table composition
and pass with it. They check both axes, count, selection, dormant slots,
TYPE33 trailing bytes and restoration of the accumulated originals. Three
unit tests cover composition, unchanged final tables and legacy scalars.

The protocol source did not change for these switch fixes or the failure
handling below. Its build and 151 focused tests were rerun on 2026-10-11;
the 2,252-test result above is the earlier broader run.

### Games failure and retry regressions (2026-10-11)

`flashPendingChanges` and `flashGameProfileSnapshot` return `failed` when a
write is rejected or the final status read fails. A queued flash does not
hide a failed batch by immediately retrying it. Games always restores the
user's unrelated staged edits, including when snapshot staging throws.
`written` means the attempt completed; `unchanged` and `busy` keep their
existing meaning. Failure does not imply that every earlier write was undone.

The Bridge hook records an applied signature only after `written` or
`unchanged`. A failed application invalidates any previous signature and
keeps the accumulated originals, including fields from a partially applied
first game. A failed restore keeps that backup. The next Bridge status poll
can retry the same game or the restore; success notifications and backup
cleanup happen only after confirmation.

Eighteen new integration cases cover ignored complete-table writes and
restore retries on all four PIDs, a queued flash, final-status read failures,
staging exceptions, partial application/restoration, old-signature
invalidation and busy-to-ready retry. Fourteen fault cases failed against
the previous implementation before the fix. The six Bridge cases execute
the actual hook subscription callback with persistent synthetic refs and a
synthetic status subscription, using the real controller and protocol
driver. They do not mount a DOM/Preact renderer or start a native Bridge
process. Failed cases assert no success notification and then verify the
synthetic device's values after retry and restore; they do not treat an
expected `written` on failure as a passing contract.

The paired protocol branch refreshes the active DPI stage and both tables
during LunaFury live reads. Its older bank-scoped setters and status reads
now share the queue used by bank switches and the newer setters. Other
brands retain their existing execution paths. These tests use simulated
devices and do not add a hardware-verification result.

### Unconfirmed status-cache regressions (2026-10-11)

A failed final read now marks the displayed snapshot untrusted. Games must
obtain a successful status read before planning writes, capturing newly
touched originals or confirming `unchanged`. An empty manual Apply follows
the same rule. Manual staging cannot discard an edit just because it matches
that old snapshot. A successful background read restores trust even when
its JSON is unchanged; a local-only layer preview does not.

If the foreground refresh also fails, Games returns `failed` without
attempting another write. Bridge keeps its original-settings backup and
does not record an applied signature or notify success. Once reads recover,
the next poll can apply or restore from the confirmed status. If the previous
write already landed, the fresh read can confirm `unchanged` without sending
a duplicate write. An in-flight recovery returns `busy` to another Games
attempt rather than allowing it to plan against the stale cache.

Seventeen integration cases were added. Both counterexamples run on all
four runtime PIDs: apply lands but final read fails, followed by exit before
background refresh; restore lands but final read fails, followed by reopening
the same game. Two cases inject sustained foreground and background read
failures, then check recovery and restoration of the retained originals.
The remaining cases cover empty Apply, same-JSON recovery, newly touched
fields, generic scalar-DPI control, manual deduplication, pending user edits
and overlapping recovery. Sixteen cases failed against `b2fab92` before this
fix; the same-JSON background recovery was an already-passing control case.

All 62 controller/Bridge cases and all 384 application tests pass. The 17
Bridge cases across both failure-handling rounds run the real subscription
callback with synthetic refs and status events, not a DOM renderer or native
Bridge process. Protocol source, packets and dependencies are unchanged;
its build, 151 focused tests, package dry-run and runtime audit were rerun.
No new hardware result is claimed.
