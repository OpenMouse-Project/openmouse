# OpenMouse UI redesign plan

Status: **implemented on branch `ui-redesign`.** `DESIGN.md` is now the live contract; this file
keeps the original audit and plan for reference. Changes from the plan after owner feedback:

- Navigation stays a **left sidebar** (collapsible to an icon rail, remembered), not a top bar.
  It also carries a "Your devices" switcher with battery icons.
- Devices home is a **swipeable shelf of device blocks** (drag, swipe, arrows, dots, arrow keys),
  ending in an Add device block; first run shows a hero with the connect action.
- The device page uses a **hero header with the section tabs bolted under it** instead of a left
  device column, so settings get the full width.
- Icons with every live value: connection, battery (custom fill icon), polling, DPI, profile.
- "OpenMouse AI" became **Quick help**, a plain FAQ panel opened from the sidebar.
- Language moved into Appearance; support links moved to Settings > About.
- The dead launch countdown was removed.

- Mock: `../ui-research/openmouse-redesign/mock.html` (serve the folder, open `mock.html`; bottom-left bar switches screens and themes). Renders in `../ui-research/openmouse-redesign/shots/`.
- Current-app captures for comparison: `../ui-research/openmouse-current/`.
- Reference: `../ui-research/` (invade.lol captures, `invade-ui/` design system clone at `261eba8`).

Decisions already made by the owner:

| Question | Answer |
|---|---|
| antislop | During (rules apply while planning and building) |
| Themes | Keep all 12, each rebuilt as a full token override |
| Shell | Top bar first; later changed by the owner to keep the left sidebar |
| Accent | The user's selected theme supplies the accent; no new brand colour |

Reading this as: a hardware control panel for mouse enthusiasts who tune numbers, in a calm dark instrument style, dial ENERGY 1 / RHYTHM 2 / MOTION 1.

---

## 1. Every screen in OpenMouse today

The app is a single page with state-based navigation (`App.tsx` `resolvedPage`), no URL routes. Everything below was traced from source.

### 1.1 Gates (render instead of the app)

| Screen | Source | Trigger |
|---|---|---|
| Launch countdown | `LaunchCountdown.tsx`, `launch.ts`, `launch.css` | Prod build before 2026-09-04 17:00 UTC. That date has passed, so this is dead code. |
| Unsupported notice, 4 variants | `UnsupportedNotice.tsx`, `platform/browser-support.ts` | Handheld, no WebHID and no Bridge, insecure context, old browser |
| Window too small | `main.tsx` + `useViewportTooSmall.ts` | Viewport under 900 × 600 |
| Offline banner | `offline-banner.ts/.css` | Mounted outside React; PWA offline |

### 1.2 Pages

| Page | Source | Notes |
|---|---|---|
| **Home: empty** | `OverviewPage.tsx` `OverviewEmpty` | "Connect your device" hero, animated aurora, one square add card |
| **Home: device list** | `DeviceListView` | Square 1:1 tiles of authorized devices, connected one moved to the middle, add tile last |
| **Device page** (mouse) | `OverviewPage` + `Workspace` | Pill tab bar + Back. Tabs filtered per device by `availableWorkspaceTabs()` |
| ↳ Overview | `OverviewContent` | Giant centred render, status pill (DPI, battery, Hz, profile), Firmware card, optional power cards, M2-NEX profile overview |
| ↳ Performance | `performance` array | DPI, Polling, Sensor, Ninjutso, Egg filter/polling/CPI, Processing, Power mode, Wallhack scanning/curves, ATK sensor; side column with the render |
| ↳ Buttons | same section | Superstrike (HITS), ButtonMap, Magnetic buttons, Lightforce, TMR, Debounce, SPDT, Razer/Egg/MX/ATK/LunaFury mappings, Ksnake scroll |
| ↳ Macro | `macro` array | Ksnake macros, Wallhack macros |
| ↳ Lighting | `lighting` array | LightingCard (zones, ColorPicker), DPI indicator lighting |
| ↳ Profiles | `Profiles.tsx`, `KeychronNapeLayers`, Teevolution card, ATK/onboard/Pulsar Pro cards | Rendered as the last tab in its own nav slot |
| ↳ Advanced | `advanced` array + `Diagnostics` + Logitech details + MX Master cards | Signal, sleep, low power, dongle LED, receivers, Finalmouse, Incott; dev-testing note; Diagnostics with capture |
| ↳ Empty tab | `workspace-tab-empty` | "This device has no X settings" |
| **Device page** (keyboard) | `KeyboardPanel`, `KochiKeyboardPanel`, `KeyboardWorkspaceCards` | Same frame; Kochi only gets Overview |
| **Hardware test** | `HardwareTestPage.tsx` | Render column, stage runner with verdict, device facts column, long footer paragraph |
| **Games** (Bridge only) | `GamesPage.tsx`, `GameProfilePanel.tsx` | Game tile grid; per-game profile reuses `Workspace` with `gameProfile` |
| **Settings** | `InterfaceSettings.tsx` | Profile key, theme (12), language (12), sound, animations, instant flash, advanced editors, experimental, dev previews, support links, reset |
| Docs, Help & Feedback | `AppSidebar.tsx` | External links (docs.openmouse.app, Discord) |

### 1.3 Overlays

`WhatsNewDialog`, `CaptureDialog`, `ShareProfileDialog`, `SetupCodeDialog`, `BounceCheckDialog`, `HitsTestDialog`, `SaveHitsPresetDialog`, `DeleteHitsPresetDialog`, `GameRequestDialog`, the dialogs inside `Profiles.tsx`, `ColorPicker`, `OptionMenu`, `ToastHost`, `PendingBar`, `NewsBanner`, `HelpPanel`.

### 1.4 Not in scope

- `src/styles/admin.css` has no consumer in `src/` (only `functions/api/admin/unban.js` exists). Leave it.
- `dist/check.html` and `dist/supported.html` are stale build output with no source entry.
- The marketing site and openmouse.app/supported live in other repos.

### 1.5 Size of the job

51 card components, ~6,100 lines of CSS across 6 files, 1,326 top-level selectors, 86 `box-shadow`, 44 `font-mono`, 15 `uppercase`, 45 hex literals in TSX (mostly the nav icon palette and stage colours). DOM coupling from logic is minimal: only `#workspace-tab-*` focus and `.battery-fill`. No test asserts class names. That makes a full restyle safe to do without touching `device/controller.ts`.

---

## 2. What we take from the reference, and what we don't

### Take (ideas)

| invade.lol idea | OpenMouse use |
|---|---|
| Slim top bar, one content column (~1200px), footer | App shell for every page |
| Profile card on the left with section nav under it | **Device card**: render, name, connection, actions; section nav under it; "Other devices" list below (the "Played with" idea) |
| Ranked/Performance panel: big figures, label above, unit after, meta under | **Current setup** panel: DPI, polling, battery, profile, plus the DPI stage strip |
| Activity/LP chart: one line, soft fade, hairline guides | **Battery over time** from `features/devices/battery-history.ts` (real samples, 5-min checkpoints, 30-day window) |
| Match rows: one row per game, result tint, expand inline | Hardware-test stages, game list, diagnostics entries |
| Champion table: name pinned, figures right-aligned, tabular | Button mapping, DPI stages, device facts, a supported-devices table if we add one |
| Segmented control as an inset well with a raised key | Polling rate, DPI mode, language, every enum setting |
| Translucent sheets lit from the top, one soft light on the ground | Surface system for all 12 themes |
| "Last answer stays until the next arrives" | Device reads: keep the old value dimmed while a read is in flight, no skeleton flashes |
| Empty states that say why and what happens next ("Checked every 30 seconds") | Every empty state (no device, no history, tab unavailable, Bridge absent) |
| ⌘K search | Settings search over the cards the connected device actually has (only if built; see 5.2) |

### Do not copy

- Invade's violet, its token values, Archivo, rank/tier colours, PerfDial glow, LoL components, copy or icons.
- `invade-ui` is **PolyForm Noncommercial**: no vendoring of CSS, components or fonts. OpenMouse is AGPL and takes donations. We reimplement the ideas in our own tokens. The mock's token file is our own sketch; re-derive values during implementation rather than diffing against `invade-ui/src/styles/tokens.css`.
- The reference's coloured 3px result edge. We mark pass/fail with icon + word + a faint tint instead (no decorative stripes).

---

## 3. What changes, aspect by aspect

| Aspect | Today | New |
|---|---|---|
| Navigation | Floating rounded left rail, rainbow icon per item, collapses on device pages | 52px top bar: brand + build, Devices, Hardware test, Games (Bridge only), Docs ↗; right side: Bridge state, search, What's new, Help, Settings |
| Device page frame | Back button + centred pill tabs with glowing active pill; giant centred render | 300px left column (device card + section nav, sticky) and a main column of panels |
| Home | Square tiles centred on a page, aurora animation | Device rows (render 64px, name, connection, polling, battery, state) + an OpenMouse Bridge panel with real status |
| Cards | 51 bespoke chromes; mono uppercase micro labels ("STAGES IN USE", "POLLING RATE") | One `Panel` (title, meta, end slot); rows split by hairlines; sentence-case labels |
| Settings rows | Mixed per card | One `SettingRow`: label + description left, control right, 44px min |
| Controls | Several button styles, filled green toggles and pills | Button (default, ghost, one primary per view), Segmented, Switch, Select, Slider, NumberField, Badge |
| Colour | Per-item icon hues, green glows, green Back button | Neutral chrome; accent only for primary action, active place, focus, slider fill, active stage. `ok/bad/warn` only for real states |
| Type | DM Sans + JetBrains Mono | DM Sans only, tabular figures everywhere; mono only for raw hex IDs and HID logs in Diagnostics. Scale: page 20, panel 14, body 13, meta 12 |
| Radii | 16px floating panels, pills | 3 / 5 / 8 / 12 only; no pills |
| Shadows | 86 shadows, glows | Lit top edge on sheets; real shadow only on menus, dialogs, the pending bar |
| Unsaved changes | `PendingBar` at the bottom of the shell | Sticky bar at the bottom of the main column: "N unsaved changes", the diff in words, Discard, **Save to mouse** |
| Motion | Aurora, glows, scroll smoothing | 120–180ms washes; values swap in place; existing "Animations" preference and `prefers-reduced-motion` both honoured |
| Help bot | Floating "OpenMouse AI" bubble with a bot icon that plays canned answers | It is a scripted FAQ, so it must not be called AI. Rename to "Quick help" and move it into the Help menu, or drop it (owner decides) |
| Launch countdown | Live code, date passed | Delete with `launch.ts`/`launch.css` instead of restyling |
| Docs | `DESIGN.md` mandates M3, rainbow icons, 16px floating surfaces, square cards | Replace `DESIGN.md` and the design rules in `AGENTS.md` before code lands |

---

## 4. Page by page

Widths: content 1200px; device page = 300px side + 24px gap + main. Below 1100px the device column becomes a horizontal header (small render, name, actions) with section nav as a row of tabs. The 900 × 600 gate stays.

### 4.1 Shell (`App.tsx`, new `TopBar.tsx`, `Footer.tsx`; delete `AppSidebar.tsx`)

- Top bar on `--ink-0` with a 1px hairline. Active item = filled `--surface-2`, no underline glow.
- News banner becomes a 34px strip under the bar, same column width, dismiss on the right (existing `features/news/news.ts` logic).
- Footer: brand, Supported devices, GitHub, Discord, X, Donate, AGPL + not-affiliated line. Moves the support links out of Settings.
- Live region and toasts stay where they are in the tree.

### 4.2 Devices (home)

- Page head: "Devices", meta "N authorized in this browser", primary **Connect a device** (the only primary on the page).
- Rows: 64px render (contain, never cropped), name + brand · connection, polling, battery, state badge ("Connected" / "Plug in to open"), chevron. Whole row opens the device; gear button removed (it did the same thing).
- Empty: no aurora. Text: what OpenMouse needs (Chromium or Bridge, the device plugged in) and the Connect button.
- Bridge panel (lit sheet): what Bridge does, real status from `features/bridge/bridge-status-store.ts`, latest release from `features/bridge/updates.ts`, Download link.

### 4.3 Device page

**Left column**
- Device card (`--r-lg`): render in an inset well with a soft accent light behind it; name 20px; "Connected · Brand"; connection detail; actions: Share profile, Setup code, overflow (Disconnect, Copy profile key, Diagnostics).
- Section nav: Overview, Performance, Buttons, Macros, Lighting, Profiles, Advanced, filtered by the existing `availableWorkspaceTabs()`. Arrow-key behaviour from today's tablist is kept.
- Other devices (overview only): other authorized devices as 44px rows.

**Overview**
- Current setup (lit sheet): DPI, polling, battery, onboard profile as figures; DPI stage strip with the active stage marked. Every value from `status`; missing values show "–".
- Battery over time: chart from `features/devices/battery-history.ts` with the time-left estimate it already computes; empty state explains the 10-minute minimum.
- Firmware: installed / latest / connection rows + Check for update (`firmware-updates.ts`).
- Device-specific overview blocks (M2-NEX profiles, power overview) slot in as panels.

**Performance**: Sensitivity panel (stage rows: enable, index, number field, slider, "Active"), Polling rate (segmented well, current value as a figure), Sensor/LOD, then vendor panels. One column; the render no longer repeats here because it sits in the left card.

**Buttons**: ButtonMap gets the main column with the mouse diagram; mapping tables become two-column rows (button name | select). HITS keeps its dial-like controls but inside a standard panel; its presets become a Select + Save/Delete in the panel header.

**Macros / Lighting / Profiles**: standard panels. Lighting zone list on the left of the panel, ColorPicker on the right. Profiles as rows (slot, name, active badge, actions) with Share/Import in the header.

**Advanced**: settings rows grouped into panels (Wireless, Power, Receiver, Vendor). The dev-testing note becomes one quiet line at the top. Diagnostics becomes a panel with an inline expandable log (mono allowed here) and Capture.

**Unsaved changes bar**: described in section 3.

### 4.4 Keyboard page

Same frame. Device card shows the keyboard render; sections from `availableKeyboardWorkspaceTabs()`.

### 4.5 Hardware test

- Page head: "Hardware test", one-line meta, actions: Start test (primary), Download log.
- Left: device card (shared component). Right: stage list, one 44px row per stage: state icon + label + detail + right-aligned result; running stage shows its progress bar and live Hz. Verdict summary panel on top when finished: Passed / Failed / Stopped, counts, duration.
- Device facts panel (key/value rows) below the stages instead of a third column.
- The 3-line footer paragraph shrinks to one sentence with the Discord link.

### 4.6 Games (Bridge only)

- Page head with Bridge state. Grid of game tiles (art 16:9, name, "Auto-apply" badge when set) plus a "Request a game" tile that opens `GameRequestDialog`.
- Game profile: the device page frame with the game's art in place of the render and only settings sections (as `gameProfile` already filters).

### 4.7 Settings

- Two columns: anchor list on the left (Appearance, Language, Behaviour, Profile key, Developer previews when enabled), panels on the right.
- Theme picker: 12 swatches that each render a tiny preview in that theme's own tokens (sheet, text, accent), not just a dot.
- Language: Select with native names (12 options is too many for a segmented control).
- Behaviour: sound, animations, instant flash, advanced editors, experimental as SettingRows with switches.
- Reset as a ghost button at the bottom. Support links move to the footer.

### 4.8 Gates and notices

One `Notice` layout for Unsupported (4 variants) and Window too small: brand mark, headline, one paragraph, one action where an action exists (Download Bridge, Open over HTTPS). Offline banner reuses the news strip style.

### 4.9 Dialogs, menus, toasts

- `Dialog` primitive: opaque `--solid-2`, `--r-lg`, menu shadow, title + close, footer actions with one primary, Escape and focus trap. All 11 dialogs move onto it.
- Menus/popovers (`OptionMenu`, ColorPicker): `--solid-2`, `--r-sm`.
- Toasts: bottom-right, solid, icon + text, no glow.

---

## 5. Implementation

### 5.1 Structure

- `src/styles/tokens.css`: shape/type/motion + **12 theme blocks**, each defining the full colour set (`--ink-0/1`, `--surface-*`, `--solid-*`, `--line-*`, `--text-1..4`, `--accent`, `--accent-rgb`, `--on-accent`, `--ok/--bad/--warn`, lighting and shadow recipes). Default stays whatever `DEFAULT_INTERFACE_PREFERENCES.theme` says (currently **Emerald**; the decision text said Matt, so confirm).
- `src/styles/base.css`, `primitives.css`, `shell.css`, then one file per area (`device.css`, `performance.css`, `buttons.css`, `lighting.css`, `profiles.css`, `advanced.css`, `hardware-test.css`, `games.css`, `settings.css`, `dialogs.css`). Replaces `control.css`, `control-devices.css`, `control-profiles.css`, `profile-card.css`.
- Primitives in `src/app/ui/`: `Panel`, `SettingRow`, `Figure`, `KeyValue`, `Button`, `Badge`, `EmptyState`, `Dialog`, `DeviceCard`, `SectionNav`. Existing `ui.tsx` controls (`Segmented`, `SwitchButton`, `OptionMenu`, `StepperSlider`, `RateSlider`, `Collapsible`, `BatteryIcon`) keep their props and get restyled, so the 51 cards mostly change only their outer chrome.
- Icons: keep `lucide-react` for now, one stroke width, `currentColor`, no per-icon hues. Swap the set later if the owner wants a different look.
- All new strings through `t()`; add keys to all 12 locales (the `i18n-tr-coverage` test fails otherwise). Logical CSS properties throughout for Arabic RTL.

### 5.2 Order

| # | Step | Done when |
|---|---|---|
| 0 | Rewrite `DESIGN.md`, update `AGENTS.md` rules, delete launch gate | Docs merged |
| 1 | Tokens for all 12 themes + base + primitives | Primitive gallery renders in 12 themes, AA contrast measured for `--text-1..3` on `--ink-1` and `--surface-1` per theme |
| 2 | Shell: TopBar, news strip, footer, layout; remove sidebar | Every existing page reachable; Games appears only with Bridge |
| 3 | Devices home + empty + Bridge panel + notices | Preview `list` and a no-device run render clean |
| 4 | Device page frame: DeviceCard, SectionNav, Overview, pending bar | `?preview=razer` overview matches the mock |
| 5 | Section areas in parallel (one worker each): Performance; Buttons/HITS/Magnetic/ButtonMap; Macros + Lighting + Profiles; Advanced + Diagnostics + Firmware + keyboard | Every preview key × every tab renders without overflow |
| 6 | Hardware test, Games, Settings | Click-through recorded |
| 7 | Dialogs, menus, toasts on the shared primitives | Each dialog opens, closes with Escape, traps focus |
| 8 | Optional: URL routes (`/`, `/device/:i/:section`, `/test`, `/games`, `/settings`) with an allowlisted parser like `device/preview/preview-modes.ts` | Back button works; PWA precache test still passes |
| 9 | Optional: settings search (Ctrl K) indexing only cards from `cardAvailability()` | Results jump to and focus the card; not rendered until built |

### 5.3 Verification

- Harness: the 36 `?preview=` fixtures already cover most vendors. A Node Playwright script shoots every preview key × every available tab at 1920 × 1080 and 1100 × 800 in Emerald, Light and NieR, plus Arabic once, and logs page overflow and console errors.
- `npm run check` (tsc + vite build + node tests) and `npm run size` (CSS budget should drop well below 225 kB).
- antislop Delivery Gate report with the click-through before anything is called done.

---

## 6. Open questions

1. Default theme: code default is **Emerald**; the decision text said Matt. Which one?
2. "OpenMouse AI": rename to Quick help in the Help menu, or remove?
3. Add an in-app **Supported devices** table page (data is already in `features/hardware-test/supported-devices-data.ts`), or keep linking to openmouse.app/supported?
4. URL routing (step 8) now, or later?
5. Keep the per-mouse DPI stage colours (M2-NEX `--stage-color-*`, these mirror the mouse's LED colours) as the only multi-hue element?
