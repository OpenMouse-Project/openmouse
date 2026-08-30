# OpenMouse

OpenMouse is a browser-based app for managing supported gaming mice in one place.
It uses the WebHID API to communicate with devices directly from Chrome or Edge — no separate desktop utility required.

## Branches

The repository keeps two long-lived branches:

- **`main`** — the stable branch. Powers the production site at [openmouse.app](https://openmouse.app).
- **`dev`** — the integration branch. All feature work and pull requests land here first and are deployed at [dev.openmouse.app](https://dev.openmouse.app/).

## Features

- **DPI control** — view and change sensitivity presets
- **Polling rate** — switch between 125 Hz – 8 KHz where supported
- **Battery & firmware** — read live status from wireless mice
- **Lift-off distance**, debounce, motion sync, and more per brand
- Supports Logitech, Pulsar, Endgame Gear, and WLMouse hardware

## Browser support

| Browser | WebHID | Status |
|---------|--------|--------|
| Chrome  | ✅ | Fully supported |
| Edge    | ✅ | Fully supported |
| Firefox | ❌ | WebHID not implemented |
| Safari  | ❌ | WebHID not implemented |

## Development

```bash
npm install
npm run dev      # start local dev server
npm run check    # full local check (tests, types, bundle size) before pushing
npm run build    # production build (requires tsc + vite)
npm test         # run protocol unit tests
```

Copy `.env.example` to `.env` and fill in your Supabase credentials if you need the license/access-gate functions.

## Contributing

OpenMouse is one repository in a family — with the **Desktop** app,
**mouse-protocol**, and **OpenMouse-Bridge**.

Before you start, read the all-in-one contribution guide at
[`contribute.html`](https://dev.openmouse.app/contribute). It explains how the
repositories fit together, per-repo setup and conventions, safe
reverse-engineering practices, and the project's AI-assistance disclosure
policy.

Codec and driver contributions belong in the `mouse-protocol` repository.

## Bridge updates

The Settings page compares the connected OpenMouse Bridge against its latest
stable GitHub release. It only retrieves the version, changelog, and download
link; it never downloads or installs an update in the background. Users can
also run the check manually.

The control panel is organized by responsibility: `control.ts` coordinates the
application, while the template, events, DOM helpers, persisted preferences,
battery history, device selection, and rendering live in focused modules under
`src/`.

Packet codecs and WebHID drivers live in the standalone
[`@openmouse/protocol`](https://github.com/OpenMouse-Project/mouse-protocol)
library. Its codec entry points remain transport-independent, while its
`drivers` entry points own discovery filters, device clients, retries, and
application-facing status conversion. OpenMouse consumes the same public
exports that external consumers use.

## Mouse Check — HID Diagnostics

**Mouse Check** is an in-browser HID diagnostics page (see
[`check.html`](https://dev.openmouse.app/check.html)). It scans your connected
devices directly over WebHID, checks whether each one works with the browser or
requires a native driver, and produces a report you can share with the team.

- No install — runs in Chrome or Edge, right in the browser.
- Scans connected devices and reports a verdict for each one.
- Generates a Discord-formatted report via **Copy for Discord**, ready to paste
  to the OpenMouse team for help.

## Stack

- **Vite 6** + **TypeScript 5** — build tooling
- **WebHID** — browser API for direct HID device access
- **Cloudflare Pages** — hosting + edge functions (access gate)
- **Supabase** — license verification (optional, for access gate)

## License

Not currently licensed for use, modification, or redistribution.
A license will be selected before the project's full public release.