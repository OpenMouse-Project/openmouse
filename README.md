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
battery history, device selection, and rendering live in focused modules under
`src/`.

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
