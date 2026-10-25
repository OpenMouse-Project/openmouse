# OpenMouse

<a href="https://trendshift.io/repositories/103495?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-103495" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/103495/daily?language=TypeScript" alt="OpenMouse-Project%2Fopenmouse | Trendshift" width="250" height="55"/></a>
<a href="https://osscar.dev/org/openmouse-project" target="_blank" rel="noopener noreferrer"><img src="https://osscar.dev/api/badge?slug=openmouse-project" alt="Featured on OSSCAR" height="55"/></a>

<p>
  <a href="https://github.com/OpenMouse-Project/openmouse/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/OpenMouse-Project/openmouse/ci.yml?branch=main&label=CI" alt="CI"/></a>
  <a href="https://www.npmjs.com/package/@openmouse/protocol"><img src="https://img.shields.io/github/package-json/dependency-version/OpenMouse-Project/openmouse/@openmouse%2Fprotocol?label=mouse%20protocol" alt="Mouse protocol version"/></a>
  <a href="https://www.npmjs.com/package/@openmouse/keyboard-protocol"><img src="https://img.shields.io/github/package-json/dependency-version/OpenMouse-Project/openmouse/@openmouse%2Fkeyboard-protocol?label=keyboard%20protocol" alt="Keyboard protocol version"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/OpenMouse-Project/openmouse" alt="License"/></a>
  <a href="https://github.com/OpenMouse-Project/openmouse/stargazers"><img src="https://img.shields.io/github/stars/OpenMouse-Project/openmouse" alt="Stars"/></a>
</p>

OpenMouse is a browser-based control panel for supported gaming mice.

Connect a mouse, view its information, and change supported settings such as DPI
and polling rate without installing a different app for every brand.

<a href="https://control.openmouse.app/"><img src=".github/assets/control-panel-card.svg" width="520" alt="Open the OpenMouse control panel"/></a>

Works in Chromium-based browsers that support WebHID. Learn more at
[openmouse.app](https://openmouse.app/).

This branch is deployed as the public development control panel at
[control.openmouse.app](https://control.openmouse.app/).

## Development

```bash
npm install
npm run dev
```

Run the full local check before pushing changes:

```bash
npm run check
```

### Linux WebHID permissions

If a device appears in Chromium's picker but OpenMouse reports `Failed to open
the device`, check the permissions on its `/dev/hidraw*` nodes. Linux does not
grant user access to every HID device by default.

First inspect the connected device IDs:

```bash
lsusb
```

VXE R1 SE+ hardware ships with more than one receiver implementation. If the
mouse and 1K receiver appear as `3554:f58f` and `3554:f58e`, respectively,
install these narrowly scoped rules:

```udev
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="3554", ATTRS{idProduct}=="f58f", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="3554", ATTRS{idProduct}=="f58e", TAG+="uaccess"
```

Save it as `/etc/udev/rules.d/70-openmouse-vxe.rules`, reload the rules, then
unplug and reconnect both devices:

```bash
sudo udevadm control --reload-rules
```

Grant access to every `hidraw` node for each product. Chromium opens the HID
device before OpenMouse selects its vendor configuration collection, so access
to only the `0xff02:0x0002` collection's node is insufficient.

## Community

Questions, device requests, bug reports, or just want to follow along? Come
hang out on Discord.

<a href="https://discord.gg/yxC9jzMdw6"><img src="https://control.openmouse.app/api/discord-card" width="520" alt="Join OpenMouse on Discord"/></a>

## Sponsors

OpenMouse is supported by [Macroscope](https://macroscope.com/), [Hypertune](https://hypertune.gg/), and [Hone](https://hone.gg/).

## Contributing

OpenMouse is one repository in a family — with the **Desktop** app,
**mouse-protocol**, and **OpenMouse-Bridge**.

Before you start, read the [contribution guide](https://docs.openmouse.app).
It explains how the repositories fit together, per-repo setup and
conventions, and safe reverse-engineering practices.

## Bridge updates

The Settings page compares the connected OpenMouse Bridge against its latest
stable GitHub release. It only retrieves the version, changelog, and download
link; it never downloads or installs an update in the background. Users can
also run the check manually.

When Bridge is reachable, the control panel prefers its loopback native HID
transport over browser WebHID. The same `@openmouse/protocol` drivers continue
to handle device discovery and settings; Bridge only carries HID reports. This
keeps Razer control interfaces protected by Chrome 153+ usable without relying
on the browser's former protected-collection bypass.

Bridge connection attempts, disconnects, request failures, scan durations, and
device inventory changes are written to the browser console with the
`[OpenMouse Bridge]` prefix. The same lifecycle events are included in the
downloadable diagnostics from a connected device's **Advanced** panel; HID
report payloads are not written to the console.

The control panel is organized by feature. Tests sit next to the code they cover.

| Folder | What lives there |
| --- | --- |
| `src/main.tsx` | Entry point: guards, service worker, mounts the app |
| `src/app/` | The shell: `App`, sidebar, pending-changes bar, toasts, AI overlay |
| `src/features/devices/` | Device home, device page, hero, stats, and the setting `cards/` |
| `src/features/buttons/` | Button mapping, setup codes, Logitech button commands |
| `src/features/profiles/` | Onboard profiles and profile sharing |
| `src/features/superstrike/` | Superstrike hit test and presets |
| `src/features/bridge/` | OpenMouse Bridge client, status line, update checks |
| `src/features/games/` | Games page and per-game profiles (Bridge only) |
| `src/features/hardware-test/` | Hardware test page, report builder, supported-devices cross-check |
| `src/features/capture/` | Report capture dialog and export formats |
| `src/features/news/` | News banner and "What's new" |
| `src/features/settings/` | Interface settings and stored preferences |
| `src/device/` | Device controller, per-vendor glue, pending changes, preview fixtures |
| `src/shared/` | UI primitives, icons, colour picker, formatting helpers |
| `src/i18n/` | Strings: `index.ts` is English and the API, `locales/` has one file per language |
| `src/platform/` | Service worker, offline banner, Trusted Types, browser support, sounds |
| `src/styles/` | Design tokens, base styles, and one stylesheet per area |
| `src/types/` | Global type declarations (Vite, WebHID) |
| `test/` | Tests for the Cloudflare functions, security headers and the PWA build |

Packet codecs and WebHID drivers live in the standalone
[`@openmouse/protocol`](https://github.com/OpenMouse-Project/mouse-protocol)
library. Its codec entry points remain transport-independent, while its
`drivers` entry points own discovery filters, device clients, retries, and
application-facing status conversion. OpenMouse consumes the same public
exports that external consumers use.

## Adding a vendor

Codec and driver contributions belong in the `mouse-protocol` repository.

1. Add transport-independent packet definitions and codecs under the vendor's
   `mouse-protocol/src/<vendor>/` folder.
2. Add the WebHID implementation under `mouse-protocol/src/drivers/<vendor>/`.
3. Register the driver and browser filters in the shared driver layer.
4. Add or extend codec and driver tests, state which product IDs were verified
   on hardware, and run the checks in both repositories.

OpenMouse should only need changes when a driver introduces a genuinely new UI
capability. The control UI otherwise discovers supported clients through the
library registry automatically.

Hardware-specific validation checklists live in the protocol repository's
`docs/` directory.

## Star history

<a href="https://star-history.com/#OpenMouse-Project/openmouse&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=OpenMouse-Project/openmouse&type=Date&theme=dark"/>
    <img src="https://api.star-history.com/svg?repos=OpenMouse-Project/openmouse&type=Date" alt="Star history chart"/>
  </picture>
</a>

## License

[GNU AGPL-3.0](LICENSE). Contributions are accepted under the same license.
