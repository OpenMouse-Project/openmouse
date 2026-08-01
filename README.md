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
`logitech/`, `pulsar/`, and `wlmouse/`; shared device types and HID filters
remain directly under `src/devices/`.
