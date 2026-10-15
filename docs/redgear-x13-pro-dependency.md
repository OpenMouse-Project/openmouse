# Redgear X13 Pro release prerequisite

The app integration depends on
[mouse-protocol #233](https://github.com/OpenMouse-Project/mouse-protocol/pull/233).
The current stable `@openmouse/protocol@0.42.2` does not contain
`drivers/redgear/hid` or register the Redgear client. This integration must not be
merged or deployed with that dependency.

OpenMouse CI requires an exact stable npm version. A contributor Git commit,
a local link, an npm alias or an invented future version is not a release fix.
Keep the dependency review open until maintainers merge and publish the protocol
contribution. Then:

1. Inspect the published tarball for `dist/drivers/redgear/hid.js` and its type
   declarations, and confirm the driver export and registry entry are present.
2. Update `package.json` to that exact stable version and regenerate
   `package-lock.json` using npm.
3. Run `npm ci`, `npm run check`, `npm run size` and
   `npm audit --audit-level=high` in a fresh checkout without a sibling package
   link. Check the approved-runtime-dependencies CI rule as well.
4. Resolve the dependency review only after those checks pass.

Local testing against the protocol contribution demonstrates integration behavior;
it does not demonstrate that the committed stable dependency builds successfully.
The standalone community utility remains available at
https://github.com/AniketSpecter/redgear-x13-pro .

## Review validation snapshot (2026-10-16)

- A fresh install with the committed 0.42.2 dependency reproduces TypeScript
  TS2307 for `@openmouse/protocol/drivers/redgear/hid`. This is an open blocker.
- Installing protocol contribution commit
  `9e1267109c86fb6cfd8ad66865d49e149d60ec9f` temporarily, without saving it to
  the manifest or lockfile, passes the production build and all 383 app tests.
  The candidate is an unpacked package, not a sibling symlink.
- Candidate audit reports zero vulnerabilities. The committed dependency list
  passes the unchanged approved-runtime-dependencies rule.
- The stable baseline emits 2,476,093 JavaScript bytes; the candidate emits
  2,486,140 (+10,047). The documented size budget is 2,490,000 bytes. CSS is
  unchanged at 222,002 bytes.
- An isolated check of the controller's status-update path covers repeated
  refreshes with a pending message, no note, and ordinary refreshes. It passes
  the corrected code and detects the original duplicate-note behavior.

The candidate results are integration evidence, not passing clean-install CI for
the committed dependency. Repeat all release checks with the actual stable
published package before removing draft status.
