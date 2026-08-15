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

## Development

```bash
npm install
npm run dev      # start local dev server
npm run build    # production build (requires tsc + vite)
npm test         # run protocol unit tests
```

Copy `.env.example` to `.env` and fill in your Supabase credentials if you need the license/access-gate functions.

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
- **Cloudflare Pages** — hosting + edge functions (access gate)
- **Supabase** — license verification (optional, for access gate)

## License

Not currently licensed for use, modification, or redistribution.
A license will be selected before the project's full public release.
