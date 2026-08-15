# OpenMouse

OpenMouse is a browser-based app for managing supported gaming mice in one place.
It uses the WebHID API to communicate with devices directly from Chrome or Edge — no separate desktop utility required.

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

Firefox/Safari users, and anyone who'd rather not run this in a browser tab,
can use the [desktop app](#desktop-app-tauri) instead — it talks to hardware
natively and doesn't depend on WebHID at all.

## Development

```bash
npm install
npm run dev      # start local dev server
npm run build    # production build (requires tsc + vite)
npm test         # run protocol unit tests
```

Copy `.env.example` to `.env` and fill in your Supabase credentials if you need the license/access-gate functions.

## Desktop app (Tauri)

`src-tauri/` wraps the frontend in a Tauri shell so DPI/polling-rate control
works outside Chrome/Edge — where `navigator.hid` doesn't exist at all
(Firefox, Safari) or is blocked (most embedded webviews, including Tauri's
own). Hardware access goes through `src/hardware/`:

- `bridge.ts` picks a transport once at startup by checking for
  `window.__TAURI_INTERNALS__`.
- `webHID.ts` wraps `navigator.hid` directly (browser build).
- `native.ts` proxies the same `HIDDevice`/`HID` shape over Tauri `invoke()`
  to `src-tauri/src/hid/commands.rs`, which talks to hardware via the
  `hidapi` crate.

Everywhere else in the app — every `*-hid.ts` driver, `control.ts` — reads
`hid` from `bridge.ts` instead of touching `navigator.hid`. **Adding a new
mouse profile only ever means writing `<vendor>-hid.ts` against the
`HIDDevice` interface**, same as before; it runs on both targets without
change.

```bash
npm install
npm run desktop:dev      # tauri dev — spawns vite, opens a native window
npm run desktop:build    # tauri build — produces an installer in src-tauri/target
```

Desktop build prerequisites (not needed for `npm run dev`/`npm run build`):

- A Rust toolchain (`rustup`) — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/).
- Linux only: `libudev-dev` (hidapi's hidraw backend links against it) plus
  Tauri's own webview/build dependencies from the prerequisites page above.
- macOS: the first time the app opens a mouse, macOS may prompt for Input
  Monitoring access under System Settings → Privacy & Security — this is an
  OS-level prompt, not something this app controls.

**Known gap:** `control-app.html` (the actual control panel) is currently
gated by `functions/_middleware.js`, a Cloudflare Pages Function that checks
a Supabase session cookie. That function doesn't run inside the Tauri
webview — there's no Cloudflare edge runtime locally — so the desktop build
as configured serves `control-app.html` unconditionally, bypassing the
license check entirely. Decide how the desktop build should handle
licensing (e.g. call `/api/license/activate` directly over the network and
cache the resulting session) before shipping a build.

**Known gap:** `src-tauri/src/hid/descriptor.rs` parses the raw HID report
descriptor into the same `collections` tree `HIDDevice.collections` exposes
in a browser, since several drivers' `isSupported()` checks walk that tree.
It was written without a Rust toolchain available to compile or test it —
review it against a real descriptor dump for each supported mouse before
relying on it.

## Mouse Check — Diagnostics & Discord Reporting

**Mouse Check** is a companion Tauri desktop app for checking whether a mouse is WebHID compatible.
It scans native HID devices, tests the Razer protocol over every interface, and generates a full diagnostic report.

### Where to enter your Discord Webhook URL

1. Open **Mouse Check**
2. Select your mouse from the device list and click **Run Diagnostics**
3. When the **Discord Report** section appears at the bottom, paste your Discord Webhook URL into the field labeled *"Discord Webhook URL (saved locally)"*
4. Click **Send to Discord**

The webhook URL is saved in your browser's `localStorage` under the key `om-discord-webhook`.
It is **never** stored in the app code, never committed to the repository, and never sent anywhere other than Discord.

**How to create a webhook:**
Discord server → Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL

## Stack

- **Vite 6** + **TypeScript 5** — build tooling
- **WebHID** — browser API for direct HID device access
- **Tauri 2** + **hidapi** (Rust) — native HID access for the desktop build
- **Cloudflare Pages** — hosting + edge functions (access gate)
- **Supabase** — license verification (optional, for access gate)

## License

Not currently licensed for use, modification, or redistribution.
A license will be selected before the project's full public release.
