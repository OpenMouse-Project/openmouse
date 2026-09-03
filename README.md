# OpenMouse

OpenMouse is a free, open source, browser-based mouse configurator — no vendor
software, no accounts, no telemetry. It runs entirely over WebHID and
supports dozens of gaming mice across brands.

This branch is intentionally just an index — `main` isn't built or deployed.
Active development happens on **`control-panel`**, which builds and deploys
straight to the links below.

## Live sites

- **[openmouse.app](https://openmouse.app)** — the public site: landing page,
  supported devices, donate, and the contribution guide.
- **[control.openmouse.app](https://control.openmouse.app)** — the actual
  control app.

## Branches

- **`control-panel`** — where all development happens. Deploys to
  `control.openmouse.app`.
- **`landing-page`** — auto-synced to match `control-panel` on every push
  (see `.github/workflows/sync-landing-page-branch.yml` there). Deploys to
  `openmouse.app`. Never committed to directly.

## Related repos

- **[mouse-protocol](https://github.com/OpenMouse-Project/mouse-protocol)** —
  the packet codecs and WebHID drivers, published as `@openmouse/protocol`.
- **[OpenMouse-Bridge](https://github.com/OpenMouse-Project/OpenMouse-Bridge)**
  — reaches devices WebHID can't, for the app's Bridge mode.
- **[openmouse-desktop](https://github.com/OpenMouse-Project/openmouse-desktop)**
  — the Tauri desktop app.

## Contributing & support

- [Contribution guide](https://openmouse.app/contribute.html) — how the repos
  fit together, per-repo setup, and reverse-engineering conventions.
- [Donate](https://openmouse.app/donate.html) / [GitHub Sponsors](https://github.com/sponsors/OpenMouse-Project)
- [Discord](https://discord.gg/yxC9jzMdw6) · [X / Twitter](https://x.com/openmouseapp)

## License

Not currently licensed for use, modification, or redistribution. A license
will be selected before the project's full public release.
