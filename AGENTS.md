# AGENTS.md

Guidance for human contributors and AI agents working in this repository.

## Design

Read [`DESIGN.md`](./DESIGN.md) before touching any UI. The project follows
Material Design 3 (M3): colored filled icon glyphs, floating rounded surfaces,
elevation instead of borders, and theme-token-only colors. All the specific
conventions — sidebar layout, device cards, artwork handling, and the icon
accent palette — are defined there.

Key rules that must never be broken:

- Use design tokens from `src/control.css`; never hardcode colors in TSX.
- Device artwork is always `object-fit: contain`, never cropped.
- Connected-device cards are square (1:1), not 9:16.
- Never invert or work around a styling bug with `overflow: hidden`; pin the
  element box instead (see `DESIGN.md` "Commandments").

## Commands

```bash
npm run dev                                  # start dev server
npm run build                                # tsc --noEmit && vite build
npm test                                     # node --test
npx tsc --noEmit                             # typecheck only
npm run check                                # full local check (dev readiness)
```

Run `npm run build` (or `npx tsc --noEmit`) after any change before finishing.

## Repo orientation

- `src/control.css` — all theme tokens and UI styles (single stylesheet).
- `src/app/` — UI: `AppSidebar.tsx` (nav rail), `InterfaceSettings.tsx`
  (settings page), `OverviewPage.tsx` (connect + device list pages).
- `src/device/` — controller, types (`ControlSnapshot`), and protocol glue.
- `src/i18n.ts` — all user-facing strings, organized by key.
- Actual wire protocol/drivers live in the external `@openmouse/protocol`
  library; do not expect to add HID driver code here.