# OpenMouse

OpenMouse is a browser-based control panel for supported gaming mice.

Connect a mouse, view its information, and change supported settings such as DPI
and polling rate without installing a different app for every brand.

This branch is deployed as the public development control panel.

## Development

```bash
npm install
npm run dev
```

Run the full local check before pushing changes:

```bash
npm run check
```

The control panel is organized by responsibility: `control.ts` coordinates the
application, while the template, events, DOM helpers, persisted preferences,
battery history, and device-client selection live in focused modules under
`src/`. Vendor drivers are grouped under `src/devices/`: `atk/`, `endgame/`,
`finalmouse/`, `logitech/`, `pulsar/`, `razer/`, `teevolution/`, and `wlmouse/`;
shared device types and HID filters remain directly under `src/devices/`.

Transport-independent packet codecs live in the standalone
[`@openmouse/protocol`](https://github.com/OpenMouse-Project/mouse-protocol)
library. OpenMouse consumes the same public package exports that external
consumers use; WebHID transport and application-facing status conversion
remain in the device drivers.

## Adding a vendor

Each supported vendor is self-contained under `src/devices/<vendor>/`.

1. Add transport-independent packet definitions and codecs to the
   `mouse-protocol` repository, then expose a package subpath.
2. Add the vendor's WebHID driver module(s) in a new vendor folder.
3. Register the driver in `src/devices/registry.ts`, including its brand,
   support check, client factory, and priority score.
4. Add the vendor's WebHID filters in `src/devices/vendors.ts`.
5. Add or extend protocol tests and state which product IDs were verified on
   hardware, then run `npm run check`.

The registry is the only central integration point for a new vendor; the
control UI discovers supported clients through it automatically.

Hardware-specific validation checklists live with each driver, for example
`src/devices/orbital/TESTING.md` for Orbital DMS V1/V2 devices and receivers.
