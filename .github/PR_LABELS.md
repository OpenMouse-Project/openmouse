# Automatic PR labels

The `Label pull requests` workflow categorizes new and updated pull requests,
including contributions from forks. It becomes active when merged into the
default branch. Existing PRs are labeled on their next update or title edit.

- `area: ...` labels match changed paths in `.github/labeler.yml`. Multiple
  areas can apply to one PR.
- `type: ...` labels match Conventional Commit prefixes in the PR title:
  `fix`, `feat`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
  `style`, and `revert`. An optional scope is supported.
- For example, `fix(device): restore DPI settings` gets `type: bug`, and
  `feat(ui)!: replace profile editor` gets `type: enhancement` and
  `type: breaking`. Titles without a recognized prefix get no type label;
  this workflow does not enforce a title format.

Automation creates missing labels and removes its own labels when they no
longer match. Reserve the configured `area:` and `type:` labels for automation;
other labels, including the standard `bug` and `enhancement` labels, are left
for manual triage. Existing label colors and descriptions are preserved.

The workflow uses `pull_request_target` with API access only. Do not add a PR
checkout or execute contributor-provided code in this workflow. `issues: write`
allows creation of repository labels, and `pull-requests: write` allows labeling
PRs. Both actions are pinned to commit SHAs.
