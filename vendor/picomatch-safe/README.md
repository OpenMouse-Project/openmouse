# Local picomatch security fork

This is a build-only fork of the MIT-licensed `picomatch@4.0.7`, fetched from
the npm registry. Upstream's license is retained in `LICENSE`. The original
`lib/parse.js` SHA-256 is
`4e1e05447668aa1e94366c5516a2bcd8f5fff800cc92b1d0cd7d77703b8618c4`.
The other JavaScript files are unchanged.

GHSA-fc5q-39xc-vjpf describes catastrophic regex backtracking in single-branch
repeated wildcard extglobs such as `+(*a)` and `+(*)`. At the time this fork was
added, no fixed upstream release existed. An older Vite introduces other
security advisories, so downgrading is not a safe solution.

The patch at the start of `analyzeRepeatedExtglob` detects unescaped wildcard
stars inside repeated extglob bodies, including nested groups, and routes them
through upstream's existing risky-pattern literalization. Quoted, escaped and
character-class stars remain literals. Ordinary globs and literal extglobs
retain their behavior. This guard is enforced even when recursion-limit checks
are explicitly disabled. It does not claim to make arbitrary regex safe.

The package has its own local name, `@openmouse/picomatch-safe`; its version
identifies the upstream base, not an unpublished upstream security release.
The root development dependency and npm override make Vite, fdir and tinyglobby
all use this checked-in implementation. There are no install scripts or new
runtime dependencies. The full npm audit gate remains enabled.

`test/picomatch-security.test.ts` checks exploit-shaped patterns in a child
process with a hard timeout, normal glob behavior, and transitive resolution.
Remove this fork and override when a fixed upstream release is available,
after rerunning those regressions and the normal build/test/audit checks.

Advisory: https://github.com/advisories/GHSA-fc5q-39xc-vjpf
