# OpenMouse design

The single source of truth for how OpenMouse looks. Read it before touching any UI.
Values live in code: `src/styles/tokens.css`. When this file and the code disagree, the code
wins; fix this file.

Reading: a hardware control panel for people who tune their mouse by the number. Calm, dark,
precise, instrument-like. Dial ENERGY 1 / RHYTHM 2 / MOTION 1.

## Principles

- **The device is the hero.** Product renders sit on a lit stage (a dark well with one soft
  accent light behind the mouse). Everything else is quiet chrome.
- **Numbers first.** Settings read as figures: label above, value, unit after, meta under. All
  numbers are tabular.
- **Colour means something.** The accent (from the user's theme) marks the active place, the
  primary action, focus, slider fills and the active stage. `--ok` / `--bad` / `--warn` mark real
  states only. Everything else is ink.
- **Real data only.** Every value comes from the device or this browser. A value the device does
  not report is left out or shown as "–". Empty states say why and what fills them.
- **One idea per block.** Short titles, sentence case, no category overlines, no uppercase micro
  labels, no decorative dots, stripes or glows.

## Structure

| Layer | Recipe |
|---|---|
| Ground | `--ground`: page ink plus one soft accent light from the top right. Painted once on the shell. |
| Chrome | Sidebar on `--ink-0` with a hairline edge. |
| Panel | `.om-panel` (or the legacy `.setting-card`): `--sheen` over `--surface-1`, `--lit` edge, `--r-md`. Featured panel: `.om-panel.is-lit` (one or two per page). |
| Row | Inside a panel: hairline `--line-1` separators. Don't nest panels. |
| Well | Inset areas (segmented controls, inputs, render stages): `--well` + `--inset-shadow`. |
| Raised | Buttons, the selected segment key, switch thumb: `--btn` / `--key`. |
| Floating | Menus, dialogs, toasts, the pending bar, help: opaque `--solid-2` + `--shadow-float`. |

## App layout

- **Sidebar** (`AppSidebar.tsx`, 248px, collapsible to a 68px icon rail, remembered):
  brand + build; Devices, Hardware test, Games (without Bridge it lists the supported games under a download-Bridge panel); "Your devices" switcher
  (thumbnail, name, battery icon + percent or "Not connected"); footer: Docs ↗, What's new,
  Help & feedback (Discord), Settings; Bridge status line, which opens a small card with Bridge's
  status, update notice and download link (`features/bridge/BridgeStatus.tsx`).
- **Main column**: news strip on top, then the scrolling page (`.om-content` > `.om-page`, max
  1160px). The pending-changes bar floats at the bottom of the main column. A help button floats
  bottom right and opens a small panel of common questions with instant answers, plus links to
  the site FAQ and Discord (`app/HelpPanel.tsx`).
- **Devices home** (`features/devices/DevicesHome.tsx`): a swipeable shelf of device blocks, each
  one surface (render on a stage, name, connection badge, live stats with icons, Configure/Open,
  and a ⋯ menu to remove the device) ending in an Add device block with the supported mice
  crossfading. Drag, swipe, arrow buttons, dots and arrow keys all move it. The shelf sits in the
  middle of the page and centres when it doesn't fill the width. No devices: the same shelf with
  only the Add device block, larger, in the middle of the page; its button becomes the primary
  action.
- **Device page** (`features/devices/DeviceHero.tsx`): hero (render stage, breadcrumb, name, connection line, stats
  with icons) with the section tabs bolted under it as one unit. Overview: Current setup figures +
  DPI stage chips, Battery over time chart (recorded samples), Firmware.
- **Setting cards** flow in a masonry column layout (`CardSlot`, `styles/instrument.css`) so there
  are no holes; every card heading carries a glyph, and feature switches are tiles
  (`SwitchRow` in `shared/ui.tsx`).
- **Settings** (`features/settings/InterfaceSettings.tsx`): grouped panels of setting rows (title + description start, control end): Appearance
  (theme gallery, each tile painted in its own theme; animations), Language (picker with native
  names), Behaviour, Profile key, Driver previews (dev builds), About.

## Tokens

Use tokens only; no hex in components or area CSS. Alpha mixes use the `-rgb` triples:
`rgb(var(--accent-rgb) / 0.12)`.

| Token | Use |
|---|---|
| `--ink-0`, `--ink-1`, `--ground` | Chrome, page |
| `--surface-1..4` | Panel, hover/selected, pressed/strong, rare |
| `--solid-1`, `--solid-2` | Opaque surfaces (menus, dialogs, sticky heads) |
| `--well`, `--glint` | Inset areas, hover wash |
| `--line-1..3` | Hairlines: divider, input edge, emphasis |
| `--text-1..4` | Values/titles, body, labels/meta, disabled/placeholder only |
| `--accent`, `--accent-rgb`, `--on-accent`, `--accent-soft`, `--accent-line` | Active place, primary action, focus, fills |
| `--ok`, `--bad`, `--warn`, `--info` | Real states only |
| `--stage-light` | The light behind a device render |

Themes: all 12 (Emerald default, Matt, Violet, Ice, Ember, Mono, Miku, Catppuccin Mocha /
Macchiato / Frappé, NieR: Automata, Light) are full token sets in `tokens.css`, selected by
`data-interface-theme` on the shell (and mirrored on `<html>`). Derived tokens are declared on every
themed element, so any element carrying `data-interface-theme` paints itself in that theme.
No component may fork on a theme name.

## Type

- DM Sans for everything; JetBrains Mono only for raw identifiers, hex and HID logs.
- Scale: page title 22, panel title 15, body 13, meta 12, small 11. Figures 28–30 at 650.
- Sentence case everywhere. No uppercase tracked labels. Weights 400–650.

## Shape and space

- Radii: 3 (chips), 6 (controls, rows), 10 (panels, wells), 14 (hero, device blocks, dialogs).
- Spacing on a 4px grid. Panel padding 16–18px; gaps between panels 16px; rows ≥ 40px.
- Device renders: always `object-fit: contain`, absolutely positioned inside their stage, never
  cropped.

## Controls

`.om-btn` (default raised), `.is-primary` (one per view), `.is-ghost`, `.is-danger`, `.is-sm`,
`.is-lg`, `.is-icon`; `.om-icon-btn`; `.om-badge` (`.is-ok/.is-bad/.is-warn/.is-accent`);
`.segmented` and `.rate-slider-buttons` (well + raised key); `SwitchButton`; `OptionMenu`;
`StepperSlider`; range inputs with an accent fill. Focus is the accent gap ring (`--focus`), never
removed.

## Icons

lucide-react at stroke 1.8, `currentColor`, `--text-3` at rest, accent when active. Icons sit next
to text that says the same thing (battery icon + percent, connection icon + "Wireless"). The battery
is the custom `BatteryIcon` (fill tracks the level; low and charging change its colour).

## Motion

120–260ms washes and fades. The device page body fades in; panels and bars rise 8px once. No
loops except the add-device crossfade, which stops with reduced motion. The Animations preference
and `prefers-reduced-motion` both stop motion.

## Checklist before shipping a page

- [ ] Tokens only; no new radii, shadows or hex.
- [ ] Sentence case, no overlines, no em dashes in copy.
- [ ] One primary button per view.
- [ ] Every number tabular; every value real or "–".
- [ ] Works in Emerald, Light and NieR; RTL (Arabic) mirrors correctly.
- [ ] Keyboard: every control reachable, visible focus, Escape closes dialogs.
