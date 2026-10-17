# AGENTS.md

Guidance for human contributors and AI agents working in this repository.

## Design

Read [`DESIGN.md`](./DESIGN.md) before touching any UI. It is the source of truth for how
OpenMouse looks: a calm, dark, instrument-like control panel where the device is the hero and
settings read as numbers.

Rules that must never be broken:

- Colours come from the tokens in `src/styles/tokens.css`. No hex, `rgb()` literals or theme-name
  checks in TSX or area CSS; alpha mixes use the `-rgb` triples (`rgb(var(--accent-rgb) / 0.12)`).
- Every theme (12 of them, Emerald default) is a full token set. A change must look right in
  Emerald, Light and NieR, and mirror correctly in Arabic (RTL).
- Sentence case everywhere. No uppercase micro labels, no category overlines, no em dashes in copy.
- Real data only: every value comes from the device or the browser; anything unknown is left out
  or shown as "–". Never ship placeholder numbers.
- Device artwork is always `object-fit: contain`, never cropped.
- Never hide a layout bug with `overflow: hidden`; pin the element box instead.
- Never remove a setting, control, link or string as a side effect of a UI change. Restyle, don't
  delete. If something has to go, say so in the PR.

## Strings and translations

- Every user-facing string is a key in `src/i18n/index.ts` (English, the source of truth) and is
  rendered with `t(locale, key)` or `tp(locale, key, vars)`.
- `src/i18n/tr-coverage.test.ts` fails on static English text in JSX under `src/app`,
  `src/features` and `src/shared`. Units and brand names go through code: `{"DPI"}`.
- Add the key to every file in `src/i18n/locales/` in the same change. `src/i18n/i18n.test.ts`
  checks that every locale has every key.
- Locales load lazily; switch through `ensureLocale()` so a switch never flashes English.

## Commands

```bash
npm run dev                                  # dev server
npm run build                                # tsc --noEmit && vite build
npm test                                     # node --test (src, test, build)
npm run size                                 # bundle budget, after a build
npm run check                                # build + tests
node scripts/sync-supported-devices.mjs      # refresh the supported-devices mirror
```

Run `npm run build`, `npm test` and `npm run size` before finishing; CI runs all three plus
`npm audit`. If the size check fails, find what grew; raise `BUDGET_BYTES` in
`build/check-bundle-size.ts` only with a note that says what was added and the measured size.

Previews: `?preview=list` opens the device shelf with fixtures, `?preview=<fixture>` opens one
device (keys in `src/device/preview/preview-modes.ts`, e.g. `egg-op1-v2`, `steelseries-gen2`).
The app needs a window of at least 900 × 600.

## Repo layout

Organized by feature; tests sit next to the code they cover.

| Path | What lives there |
| --- | --- |
| `src/main.tsx` | Entry: browser guards, service worker, mounts `App` |
| `src/app/` | Shell: `App.tsx`, `AppSidebar.tsx`, pending bar, toasts, help panel |
| `src/features/devices/` | Devices home, device page (`OverviewPage.tsx`, `DeviceHero.tsx`), setting `cards/` |
| `src/features/buttons/` | Button mapping, setup codes, Logitech button commands |
| `src/features/profiles/` | Onboard profiles and profile sharing |
| `src/features/superstrike/` | Superstrike hit test and presets |
| `src/features/bridge/` | OpenMouse Bridge client, status store, sidebar status card, update checks |
| `src/features/games/` | Games page and per-game profiles (profiles need Bridge) |
| `src/features/hardware-test/` | Hardware test page, report, supported-devices mirror and cross-check |
| `src/features/capture/` | Report capture dialog and export formats |
| `src/features/news/` | News banner and "What's new" |
| `src/features/settings/` | Interface settings page and stored preferences |
| `src/device/` | Device controller (`controller.ts`), snapshot types, per-vendor glue, pending changes, `preview/` fixtures |
| `src/shared/` | UI primitives (`ui.tsx`: `SwitchRow`, `Segmented`, `OptionMenu`, `StepperSlider`, `RateSlider`, `BatteryIcon`), `CardSlot`, icons, colour picker, formatting helpers |
| `src/i18n/` | `index.ts` (English + API), `locales/<code>.ts` |
| `src/platform/` | Service worker, offline banner, Trusted Types, XSS guard, browser support, sounds |
| `src/styles/` | `tokens.css`, base, controls, shell, page styles, `instrument.css`, `areas/` per tab |
| `src/types/` | Global declarations (Vite, WebHID) |
| `test/` | Tests for `functions/`, security headers and the PWA build |
| `functions/` | Cloudflare Pages Functions (`/api/*`, security middleware) |
| `build/` | Vite plugins and the bundle-size check |

Where new code goes: a new screen or capability gets its own folder under `src/features/`; a new
setting card for a device goes in `src/features/devices/cards/`; anything two features share goes
in `src/shared/`. Don't add files to the top of `src/`.

## Devices and protocols

Wire protocols and HID drivers live in the external `@openmouse/protocol` and
`@openmouse/keyboard-protocol` packages; don't add driver code here. This repo maps a driver's
capabilities onto the UI (`src/device/controller.ts`, `src/device/traits.ts`) and renders them.

`src/features/hardware-test/supported-devices-data.ts` is generated from the website's table
(`openmouse-landing-page/src/data/supported-mice.ts`). Don't edit it by hand; run the sync script.
