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
`src/`. Vendor drivers are grouped under `src/devices/`: `endgame/`,
`logitech/`, `pulsar/`, `wlmouse/` and `teevolution/`; shared device types and HID filters
remain directly under `src/devices/`.

## Adding a vendor

Each supported vendor is self-contained under `src/devices/<vendor>/`.

1. Add the vendor's HID driver module(s) in a new vendor folder.
2. Register the driver in `src/devices/registry.ts`, including its brand,
   support check, client factory, and priority score.
3. Add the vendor's WebHID filters in `src/devices/vendors.ts`.
4. Add or extend protocol tests, then run `npm run check`.

The registry is the only central integration point for a new vendor; the
control UI discovers supported clients through it automatically.

Hardware-specific validation checklists live with each driver, for example
`src/devices/orbital/TESTING.md` for Orbital DMS V1/V2 devices and receivers.
