# OpenMouse — Design Style Guide

This project follows **Material Design 3 (M3)** conventions. Read this guide
before touching any UI. It is the single source of truth for visual style.

All design tokens live in `src/control.css` (CSS custom properties on the
`.control-shell` / `:root` theme blocks). **Never hardcode colors in
components** — use the theme tokens. Art/SVG/glyph fills may only use
`currentColor` or `color-mix()` against tokens; never hardcode hue values
except for the per-icon accent palette defined below.

## Core principles

- **Filled, colored glyphs**: navigation and inline icons are Material
  Symbol-style filled paths (`fill="currentColor"`) rendered at 20–24px.
  Thin stroke-only icons are out of style for navigation.
- **Floating rounded surfaces**: elevated panels are inset from the page,
  rounded (`border-radius: 16px`), with layered `box-shadow` depth — not flat,
  border-only rectangles.
- **Elevation over borders**: distinguish surfaces with elevation (gradients,
  shadows, `--surface-*` tokens) before reaching for borders. When a divider
  is needed it must be clearly visible (use `--line-strong`, never
  `--border-rule`/`--line` — those are too faint).
- **State layers**: hovers are subtle overlays (`--hover`, `--surface-hover`)
  — a change of background/color, never a sudden border or outline.
- **Theme-awareness**: every style must hold up in **all themes** (dark,
  light, ocean, Nier, catppuccin). Check contrast between adjacent surfaces in
  both dark and light before committing.
- **Bold labels**: navigation labels use high weight (`font-weight: 600–700`)
  and high-contrast text tokens so they read as interactive targets.

## Layout

### Sidebar (`.app-sidebar`)

The left rail is the app's navigation drawer:

- Floating rounded panel: inset from the shell edge (`margin: 0.55rem 0
  0.55rem 0.55rem`), `border-radius: 16px`, full outline in `--edge`,
  gradient background `linear-gradient(180deg, var(--surface-strong),
  var(--surface-dialog))`, and layered drop shadows for lift.
- Nav items (`.app-sidebar-nav-item`): 42px tall, rounded 8px, flex row of
  `[icon] [label] [>]`.
  - `>` chevron (`.app-sidebar-nav-arrow`) sits at the right via
    `margin-left: auto`; it nudges right on hover.
  - Adjacent items are separated by a Material divider
    (`border-top: 1px solid var(--line-strong)`).
- Per-item icon accent palette (set via inline `style={{ color }}` on the
  icon svg — the label itself keeps theme text tokens):
  - Home / Connect: green `#5dde89`
  - Dashboard (mouse config): blue `#67d8ff` — **use the mouse glyph**
    (`M13 1.07V9h7c0-4.08-3.05-7.44-7-7.93zM4 15c0 4.42 3.58 8 8 8s8-3.58
    8-8v-4H4v4zm7-13.93C7.05 1.56 4 4.92 4 9h7V1.07z`)
  - Docs: amber `#e8b267`
  - Supported: violet `#a78bfa`
  - What's New: gold `#fbbf24`
  - Feedback: orange `#fb923c`
  - Settings: slate `#94a3b8`
- Section order: top nav = Home, Dashboard, Docs. Bottom nav = What's New,
  Feedback, Settings. Supported devices lives **inside the Settings page**,
  not the sidebar.

### Device cards

- Connected-device cards and the add-device cards are **square (1:1)**, equal
  size, on a centered grid.
- Card background is `--surface-strong` so cards separate clearly from the
  page background in every theme.
- No border at rest — border + subtle shadow appear only on hover.
- Device artwork:
  - Rendered through `.device-tile-image` as `position: absolute; inset: 0;
    object-fit: contain;` (+ `transform: scale(1.1)`), never cropped.
  - The card clips with `overflow: hidden`.
- The mouse add card and keyboard add card are identical size and shape. The
  keyboard add card in the device list must not carry the flex `max-width`
  that the empty-state add grid uses (`max-width: none` override).
- State: per-card "Connecting…" text from local state, not global labels.
- Cog/gear buttons are borderless icons (no square outline), `overflow:
  visible` on the icon svg so strokes are never clipped.

## Commandments

1. Never crop a product rendering; always `object-fit: contain`.
2. Never reintroduce the old 9:16 card aspect ratio for the connected list.
3. Never use `overflow: hidden` to "fix" artwork — pin the image box with
   absolute positioning instead.
4. Never use `--line` / `--border-rule` for dividers you want visible.
5. Never introduce a new UI concept (page, card, dialog) without reading this
   file and matching the M3 conventions above.