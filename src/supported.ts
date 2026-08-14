import "./supported.css";

// ── Theme ─────────────────────────────────────────────────────────────────
type Theme = "light" | "dark";
type ThemePreference = Theme | "system";

const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

function preferredTheme(): ThemePreference {
  try {
    const v = localStorage.getItem("openmouse-theme-preference");
    if (v === "system" || v === "light" || v === "dark") return v;
  } catch { /* storage unavailable */ }
  return "system";
}

function resolvedTheme(pref: ThemePreference): Theme {
  return pref === "system" ? (colorSchemeQuery.matches ? "dark" : "light") : pref;
}

let themePreference = preferredTheme();

function applyTheme(): void {
  const theme = resolvedTheme(themePreference);
  document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#09090b" : "#ffffff");
  try { localStorage.setItem("openmouse-theme-preference", themePreference); } catch { /* ok */ }
}

function updateThemeToggle(): void {
  const toggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
  if (!toggle) return;
  const label = themePreference[0].toUpperCase() + themePreference.slice(1);
  toggle.textContent = `Theme: ${label}`;
  const next = themePreference === "system" ? "light" : themePreference === "light" ? "dark" : "system";
  toggle.setAttribute("aria-label", `Color theme: ${label}. Click to switch to ${next}`);
}

applyTheme();
colorSchemeQuery.addEventListener("change", () => {
  if (themePreference === "system") applyTheme();
});

// ── Data ──────────────────────────────────────────────────────────────────
type Status = "supported" | "pr" | "quickwin" | "likely" | "driver" | "unknown";

interface Mouse {
  brand: string;
  model: string;
  status: Status;
  req: number;
  note: string;
}

const STATUS: Record<Status, { label: string; order: number }> = {
  supported: { label: "Supported",     order: 0 },
  pr:        { label: "PR pending",    order: 1 },
  quickwin:  { label: "Quick Win",     order: 2 },
  likely:    { label: "Test Needed",   order: 3 },
  driver:    { label: "Driver Needed", order: 4 },
  unknown:   { label: "Unknown",       order: 5 },
};

const TABS: Array<{ key: Status | "all"; label: string }> = [
  { key: "all",       label: "All" },
  { key: "supported", label: "Supported" },
  { key: "pr",        label: "PR pending" },
  { key: "quickwin",  label: "Quick Win" },
  { key: "likely",    label: "Test Needed" },
  { key: "driver",    label: "Driver Needed" },
  { key: "unknown",   label: "Unknown" },
];

const MICE: Mouse[] = [
  // LOGITECH ─────────────────────────────────────────────────────────────
  { brand: "Logitech", model: "G502 (all variants)",    status: "likely",    req: 42,
    note: "Multiple G502 generations requested — G502 HERO wired supported; Lightspeed via dongle likely working" },
  { brand: "Logitech", model: "G203 LIGHTSYNC",         status: "supported", req: 3,
    note: "PID 0xc092 — HID++ direct, legacy DPI feature 0x2201" },
  { brand: "Logitech", model: "G203 PRODIGY",           status: "supported", req: 2,
    note: "PID 0xc084 — HID++ direct, legacy DPI feature 0x2201" },
  { brand: "Logitech", model: "G102 LIGHTSYNC",         status: "supported", req: 1,
    note: "PID 0xc089 — same family as G203, HID++ direct" },
  { brand: "Logitech", model: "G402 Hyperion Fury",     status: "supported", req: 3,
    note: "PID 0xc07e — HID++ direct, legacy DPI feature 0x2201" },
  { brand: "Logitech", model: "G303 Daedalus Apex",     status: "supported", req: 1,
    note: "PID 0xc080 — HID++ direct" },
  { brand: "Logitech", model: "G Pro (2017)",           status: "supported", req: 2,
    note: "PID 0xc085 — HID++ direct, DPI feature 0x2202" },
  { brand: "Logitech", model: "G502 HERO (wired)",      status: "supported", req: 3,
    note: "PID 0xc08b — HID++ direct, DPI feature 0x2202" },
  { brand: "Logitech", model: "G Pro Hero",             status: "supported", req: 2,
    note: "PID 0xc08c — HID++ direct" },
  { brand: "Logitech", model: "G903 HERO (wired)",      status: "supported", req: 2,
    note: "PID 0xc08e — HID++ direct" },
  { brand: "Logitech", model: "G403 HERO (wired)",      status: "supported", req: 1,
    note: "PID 0xc08f — HID++ direct, DPI feature 0x2202" },
  { brand: "Logitech", model: "G Pro X Superlight",     status: "supported", req: 4,
    note: "PID 0xc094 — HID++ direct" },
  { brand: "Logitech", model: "G305",                   status: "supported", req: 8,
    note: "Via Lightspeed USB receiver — confirmed ✓" },
  { brand: "Logitech", model: "MX Master 3S",           status: "supported", req: 8,
    note: "Logi Bolt receiver already in driver" },
  { brand: "Logitech", model: "G502 X (wired)",         status: "quickwin",  req: 31,
    note: "HID++ direct — PID not yet confirmed, needs hardware test" },
  { brand: "Logitech", model: "G502 X PLUS (wireless)", status: "quickwin",  req: 27,
    note: "Via Lightspeed dongle — PID not yet confirmed" },
  { brand: "Logitech", model: "G502 X LIGHTSPEED",      status: "quickwin",  req: 2,
    note: "Wireless Lightspeed variant — PID needs confirmation" },
  { brand: "Logitech", model: "MX Vertical",            status: "driver",    req: 9,
    note: "Bluetooth primary — WebHID Bluetooth support limited in Chrome" },
  { brand: "Logitech", model: "MX Master 4",            status: "driver",    req: 8,
    note: "Bluetooth primary — WebHID Bluetooth support limited in Chrome" },
  { brand: "Logitech", model: "G304",                   status: "likely",    req: 7,
    note: "Via Lightspeed receiver — test at dev.openmouse.app" },
  { brand: "Logitech", model: "G Pro Wireless",         status: "likely",    req: 6,
    note: "Via Lightspeed dongle — likely working" },
  { brand: "Logitech", model: "G300s",                  status: "driver",    req: 4,
    note: "Older HID++ protocol variant — needs investigation" },
  { brand: "Logitech", model: "G600",                   status: "driver",    req: 4,
    note: "12-button side panel — HID++ protocol variant not yet implemented" },
  { brand: "Logitech", model: "G Pro 2 Lightspeed",     status: "likely",    req: 3,
    note: "Via Lightspeed dongle — needs PID check in registry" },
  { brand: "Logitech", model: "G502 Lightspeed",        status: "likely",    req: 2,
    note: "Via Lightspeed USB dongle — likely working" },
  { brand: "Logitech", model: "MX Master 2S",           status: "likely",    req: 2,
    note: "Via Logi Bolt or Lightspeed dongle — likely working" },
  { brand: "Logitech", model: "MX Anywhere 3",          status: "likely",    req: 2,
    note: "Via Logi Bolt dongle — likely working" },
  { brand: "Logitech", model: "G309 Lightspeed",        status: "likely",    req: 1,
    note: "Via Lightspeed USB dongle — likely working" },
  { brand: "Logitech", model: "MX Ergo S",              status: "likely",    req: 1,
    note: "Via Logi Bolt dongle — likely working" },
  { brand: "Logitech", model: "MX Anywhere 2",          status: "likely",    req: 1,
    note: "Via Lightspeed dongle — likely working" },
  { brand: "Logitech", model: "Compact Wireless",       status: "unknown",   req: 1,
    note: "Protocol unknown — receiver type needs identification" },
  { brand: "Logitech", model: "G700s",                  status: "unknown",   req: 1,
    note: "HID++ 1.0 (legacy protocol) — not yet implemented" },
  { brand: "Logitech", model: "M171 Wireless",          status: "driver",    req: 1,
    note: "Basic optical — no HID++ control channel exposed" },

  // ROCCAT ─────────────────────────────────────────────────────────────
  { brand: "Roccat", model: "Kone Pro Air",             status: "driver",    req: 39,
    note: "Roccat Swarm / AIMO protocol — not yet implemented" },
  { brand: "Roccat", model: "Kone XP Air",              status: "driver",    req: 5,
    note: "Roccat AIMO protocol — not yet implemented" },
  { brand: "Roccat", model: "Tyon",                     status: "driver",    req: 2,
    note: "Roccat protocol — not implemented" },
  { brand: "Roccat", model: "Nyth",                     status: "driver",    req: 2,
    note: "Roccat protocol — not implemented" },
  { brand: "Roccat", model: "Kain 100 AIMO",            status: "driver",    req: 2,
    note: "Roccat AIMO protocol — not implemented" },
  { brand: "Roccat", model: "Kone Pro",                 status: "driver",    req: 1,
    note: "Roccat protocol — not implemented" },

  // REDRAGON ─────────────────────────────────────────────────────────────
  { brand: "Redragon", model: "M725 Honeycomb",         status: "driver",    req: 32,
    note: "Redragon HID protocol — not implemented" },
  { brand: "Redragon", model: "Impact Elite M913",      status: "driver",    req: 18,
    note: "Redragon HID protocol — not implemented" },
  { brand: "Redragon", model: "PREDATOR M612",          status: "driver",    req: 2,
    note: "Redragon HID protocol — not implemented" },
  { brand: "Redragon", model: "K1ng M916 Pro 4K",      status: "driver",    req: 2,
    note: "Redragon HID protocol — not implemented" },
  { brand: "Redragon", model: "M711 Cobra",             status: "driver",    req: 2,
    note: "Redragon HID protocol — not implemented" },
  { brand: "Redragon", model: "M917 Pro",               status: "driver",    req: 2,
    note: "Redragon HID protocol — not implemented" },
  { brand: "Redragon", model: "M991",                   status: "driver",    req: 2,
    note: "Redragon HID protocol — not implemented" },
  { brand: "Redragon", model: "M703",                   status: "driver",    req: 2,
    note: "Redragon HID protocol — not implemented" },
  { brand: "Redragon", model: "TAIPAN PRO M810",        status: "driver",    req: 2,
    note: "Redragon HID protocol — not implemented" },
  { brand: "Redragon", model: "Ranger Lite",            status: "driver",    req: 1,
    note: "Redragon HID protocol — not implemented" },
  { brand: "Redragon", model: "Infernal Dragon",        status: "driver",    req: 1,
    note: "Redragon HID protocol — not implemented" },
  { brand: "Redragon", model: "M696 Pro",               status: "driver",    req: 1,
    note: "Redragon HID protocol — not implemented" },
  { brand: "Redragon", model: "M721 Pro",               status: "driver",    req: 1,
    note: "Redragon HID protocol — not implemented" },

  // ATTACK SHARK ────────────────────────────────────────────────────────
  { brand: "Attack Shark", model: "X3",                 status: "driver",    req: 15,
    note: "VID 0x25a7 — driver skeleton added, protocol WIP" },
  { brand: "Attack Shark", model: "X11",                status: "driver",    req: 10,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "R5 Ultra",           status: "driver",    req: 7,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "X6",                 status: "driver",    req: 5,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "R3",                 status: "driver",    req: 4,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "R1",                 status: "driver",    req: 3,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "X8 Ultra",           status: "driver",    req: 3,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "X8 SE",              status: "driver",    req: 3,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "X1",                 status: "driver",    req: 2,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "V3 Pro",             status: "driver",    req: 1,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "X3 Pro",             status: "driver",    req: 1,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "X11 SE",             status: "driver",    req: 1,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "X8 PLUS",            status: "driver",    req: 1,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "X12",                status: "driver",    req: 1,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "R6",                 status: "driver",    req: 1,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "G3",                 status: "driver",    req: 1,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },
  { brand: "Attack Shark", model: "R2",                 status: "driver",    req: 1,
    note: "VID 0x25a7 — custom HID protocol, driver not yet implemented" },

  // RAZER ───────────────────────────────────────────────────────────────
  { brand: "Razer", model: "DeathAdder V3 (wired)",     status: "supported", req: 9,
    note: "Confirmed working ✓" },
  { brand: "Razer", model: "DeathAdder V2 Pro",         status: "supported", req: 3,
    note: "0x0084 — specific driver filter" },
  { brand: "Razer", model: "Cobra",                     status: "supported", req: 2,
    note: "0x00a3 — specific driver filter" },
  { brand: "Razer", model: "Viper V3 Pro",              status: "supported", req: 1,
    note: "0x00c0 / 0x00c1 — specific driver filter" },
  { brand: "Razer", model: "DeathAdder Essential",      status: "supported", req: 1,
    note: "0x006e / 0x0071 / 0x0098 — specific driver filters" },
  { brand: "Razer", model: "Basilisk V3 (wired)",       status: "likely",    req: 13,
    note: "In Razer device registry — test at dev.openmouse.app" },
  { brand: "Razer", model: "Basilisk V3 Pro",           status: "likely",    req: 13,
    note: "Wireless — in Razer registry, needs HyperSpeed dongle" },
  { brand: "Razer", model: "Viper Ultimate",            status: "likely",    req: 5,
    note: "Wireless — in Razer registry" },
  { brand: "Razer", model: "Basilisk V3 X HyperSpeed",  status: "likely",    req: 5,
    note: "Wireless — in Razer registry" },
  { brand: "Razer", model: "DeathAdder V2 (wired)",     status: "likely",    req: 3,
    note: "Wired variant — in Razer registry" },
  { brand: "Razer", model: "Viper mini",                status: "likely",    req: 3,
    note: "In Razer registry — control interface not fully pinned down" },
  { brand: "Razer", model: "Naga V2 Pro",               status: "likely",    req: 3,
    note: "In Razer registry" },
  { brand: "Razer", model: "DeathAdder V3 Pro",         status: "likely",    req: 2,
    note: "Wireless — in Razer registry" },
  { brand: "Razer", model: "DeathAdder V4 Pro",         status: "likely",    req: 2,
    note: "In Razer registry" },
  { brand: "Razer", model: "Naga Trinity",              status: "driver",    req: 2,
    note: "Older HID layout — control channel not yet mapped" },
  { brand: "Razer", model: "Naga X",                    status: "likely",    req: 2,
    note: "In Razer registry" },
  { brand: "Razer", model: "Basilisk Essential",        status: "likely",    req: 1,
    note: "In Razer device registry" },
  { brand: "Razer", model: "Basilisk V3 HyperSpeed",    status: "likely",    req: 1,
    note: "Wireless — in registry, needs dongle connected" },
  { brand: "Razer", model: "Basilisk",                  status: "likely",    req: 1,
    note: "In Razer device registry" },
  { brand: "Razer", model: "Orochi V2",                 status: "likely",    req: 1,
    note: "Wireless — in Razer registry" },
  { brand: "Razer", model: "Cobra HyperSpeed",          status: "likely",    req: 1,
    note: "Wireless — in Razer registry" },
  { brand: "Razer", model: "Viper 8KHz",                status: "likely",    req: 1,
    note: "In Razer registry" },
  { brand: "Razer", model: "Viper V3 HyperSpeed",       status: "likely",    req: 1,
    note: "Wireless — in Razer registry" },
  { brand: "Razer", model: "Basilisk X HyperSpeed",     status: "likely",    req: 1,
    note: "Wireless — in Razer registry" },
  { brand: "Razer", model: "Naga V2 HyperSpeed",        status: "likely",    req: 1,
    note: "Wireless — in Razer registry" },
  { brand: "Razer", model: "Basilisk Ultimate",         status: "likely",    req: 1,
    note: "Wireless — in Razer registry" },
  { brand: "Razer", model: "DeathAdder V2 X HyperSpeed",status: "likely",    req: 1,
    note: "Wireless — in Razer registry" },
  { brand: "Razer", model: "DeathAdder Elite",          status: "driver",    req: 1,
    note: "Older protocol variant — not yet implemented" },
  { brand: "Razer", model: "Viper V3 Pro SE",           status: "quickwin",  req: 1,
    note: "SE variant PID likely differs — verify & add to registry" },

  // HYPERX ─────────────────────────────────────────────────────────────
  { brand: "HyperX", model: "Pulsefire Haste 2",          status: "driver",  req: 10,
    note: "Kingston NGENUITY protocol — not implemented" },
  { brand: "HyperX", model: "Pulsefire Haste 2 Wireless", status: "driver",  req: 4,
    note: "Kingston NGENUITY protocol — not implemented" },
  { brand: "HyperX", model: "Pulsefire FPS Pro",          status: "driver",  req: 2,
    note: "Kingston NGENUITY protocol — not implemented" },
  { brand: "HyperX", model: "Pulsefire Fuse",             status: "driver",  req: 1,
    note: "Kingston NGENUITY protocol — not implemented" },

  // STEELSERIES ─────────────────────────────────────────────────────────
  { brand: "SteelSeries", model: "Aerox 9 Wireless",    status: "driver",    req: 5,
    note: "SteelSeries GG protocol — not implemented" },
  { brand: "SteelSeries", model: "Sensei Ten",           status: "driver",    req: 4,
    note: "SteelSeries GG protocol — not implemented" },
  { brand: "SteelSeries", model: "Aerox 5",              status: "driver",    req: 2,
    note: "SteelSeries GG protocol — not implemented" },
  { brand: "SteelSeries", model: "Rival 3 Wireless",     status: "driver",    req: 2,
    note: "SteelSeries GG protocol — not implemented" },
  { brand: "SteelSeries", model: "Rival 650 Wireless",   status: "driver",    req: 2,
    note: "SteelSeries GG protocol — not implemented" },
  { brand: "SteelSeries", model: "Aerox 3",              status: "driver",    req: 1,
    note: "SteelSeries GG protocol — not implemented" },
  { brand: "SteelSeries", model: "Prime+",               status: "driver",    req: 1,
    note: "SteelSeries GG protocol — not implemented" },
  { brand: "SteelSeries", model: "Rival 310",            status: "driver",    req: 1,
    note: "SteelSeries GG protocol — not implemented" },
  { brand: "SteelSeries", model: "Prime Mini Wireless",  status: "driver",    req: 1,
    note: "SteelSeries GG protocol — not implemented" },

  // CORSAIR ─────────────────────────────────────────────────────────────
  { brand: "Corsair", model: "Harpoon RGB Pro",           status: "driver",   req: 5,
    note: "iCUE protocol — not implemented" },
  { brand: "Corsair", model: "Katar Pro",                 status: "driver",   req: 4,
    note: "iCUE protocol — not implemented" },
  { brand: "Corsair", model: "M65 Pro RGB",               status: "driver",   req: 3,
    note: "iCUE protocol — not implemented" },
  { brand: "Corsair", model: "Sabre V2 Pro Ultralight",   status: "driver",   req: 3,
    note: "iCUE protocol — not implemented" },
  { brand: "Corsair", model: "Scimitar Elite Wireless SE",status: "driver",   req: 3,
    note: "iCUE protocol — not implemented" },
  { brand: "Corsair", model: "M65 RGB Elite",             status: "driver",   req: 1,
    note: "iCUE protocol — not implemented" },
  { brand: "Corsair", model: "Scimitar RGB Elite",        status: "driver",   req: 1,
    note: "iCUE protocol — not implemented" },
  { brand: "Corsair", model: "Ironclaw RGB",              status: "driver",   req: 1,
    note: "iCUE protocol — not implemented" },

  // GLORIOUS ────────────────────────────────────────────────────────────
  { brand: "Glorious", model: "Model O 2 Pro Wireless",  status: "driver",   req: 5,
    note: "Glorious CORE protocol — not implemented" },
  { brand: "Glorious", model: "Model O",                 status: "driver",   req: 3,
    note: "Glorious CORE protocol — not implemented" },
  { brand: "Glorious", model: "Model D Wireless",        status: "driver",   req: 2,
    note: "Glorious CORE protocol — not implemented" },
  { brand: "Glorious", model: "Model D",                 status: "driver",   req: 2,
    note: "Glorious CORE protocol — not implemented" },
  { brand: "Glorious", model: "Model O2 Pro 4K/8K",     status: "driver",   req: 2,
    note: "Glorious CORE protocol — not implemented" },
  { brand: "Glorious", model: "Model O Pro",             status: "driver",   req: 1,
    note: "Glorious CORE protocol — not implemented" },
  { brand: "Glorious", model: "Model D2 Pro Wireless 8K",status: "driver",  req: 1,
    note: "Glorious CORE protocol — not implemented" },

  // ENDGAME GEAR ────────────────────────────────────────────────────────
  { brand: "Endgame Gear", model: "XM2w 4K",            status: "supported", req: 3,
    note: "EGG vendor (0x3367) covered by vendor filter" },
  { brand: "Endgame Gear", model: "OP1w 4K v2",         status: "likely",    req: 7,
    note: "EGG driver likely covers this model — test at dev.openmouse.app" },

  // ATK ─────────────────────────────────────────────────────────────────
  { brand: "ATK", model: "F1 V2 Ultra Max",             status: "supported", req: 1,
    note: "ATK vendor (0x373b, usagePage 0xff02) covered" },
  { brand: "ATK", model: "VXE Dragonfly R1 Pro",        status: "likely",    req: 3,
    note: "ATK driver (0x373b) likely covers this — needs hardware test" },
  { brand: "ATK", model: "X1 V2 Ultimate",              status: "likely",    req: 1,
    note: "ATK driver likely covers this — needs hardware test" },
  { brand: "ATK", model: "A9 Air",                      status: "likely",    req: 1,
    note: "ATK driver likely covers this — needs hardware test" },
  { brand: "ATK", model: "F1 Ultimate",                 status: "likely",    req: 1,
    note: "ATK driver likely covers this — needs hardware test" },
  { brand: "ATK", model: "VXE Mad R Major",             status: "likely",    req: 1,
    note: "ATK driver likely covers this — needs hardware test" },
  { brand: "ATK", model: "Zero Normal",                 status: "likely",    req: 1,
    note: "ATK driver likely covers this — needs hardware test" },

  // WLMOUSE ─────────────────────────────────────────────────────────────
  { brand: "WLMouse", model: "Beast X",                 status: "supported", req: 1,
    note: "PID 0xa883 / 0xa884 already in WLMouse driver" },

  // PULSAR ──────────────────────────────────────────────────────────────
  { brand: "Pulsar", model: "Tenz Signature",           status: "likely",    req: 6,
    note: "Pulsar driver exists — PID not yet confirmed" },
  { brand: "Pulsar", model: "X2h",                      status: "likely",    req: 3,
    note: "Pulsar driver exists — PID not yet confirmed" },
  { brand: "Pulsar", model: "X2 V3 ES Mini",            status: "likely",    req: 2,
    note: "Pulsar driver exists — PID not yet confirmed" },
  { brand: "Pulsar", model: "X3 Medium",                status: "likely",    req: 1,
    note: "Pulsar driver exists — PID not yet confirmed" },
  { brand: "Pulsar", model: "X2F",                      status: "likely",    req: 1,
    note: "Pulsar driver exists — PID not yet confirmed" },

  // LAMZU ───────────────────────────────────────────────────────────────
  { brand: "Lamzu", model: "Inca",                      status: "likely",    req: 1,
    note: "Lamzu driver exists — PID not yet confirmed" },
  { brand: "Lamzu", model: "Thorn",                     status: "likely",    req: 1,
    note: "Lamzu driver exists — PID not yet confirmed" },

  // NINJUTSO ────────────────────────────────────────────────────────────
  { brand: "Ninjutso", model: "Sora",                   status: "likely",    req: 1,
    note: "Ninjutso driver exists — PID not yet confirmed" },

  // ASUS ROG ────────────────────────────────────────────────────────────
  { brand: "ASUS ROG", model: "Harpe Ace Aim Lab",      status: "driver",    req: 5,
    note: "Armoury Crate protocol — not implemented" },
  { brand: "ASUS ROG", model: "TUF Gaming M5",          status: "driver",    req: 2,
    note: "Armoury Crate protocol — not implemented" },
  { brand: "ASUS ROG", model: "Gladius II Core",        status: "driver",    req: 1,
    note: "Armoury Crate protocol — not implemented" },
  { brand: "ASUS ROG", model: "Strix Impact III",       status: "driver",    req: 1,
    note: "Armoury Crate protocol — not implemented" },
  { brand: "ASUS ROG", model: "TUF Gaming M3 Gen 1",    status: "driver",    req: 1,
    note: "Armoury Crate protocol — not implemented" },

  // OTHER DRIVER-NEEDED ─────────────────────────────────────────────────
  { brand: "Keychron",      model: "M6",                status: "quickwin",  req: 1,
    note: "Keychron vendor covered; M6 PID not yet in KEYCHRON_PRODUCT_IDS" },
  { brand: "Bloody",        model: "Max W95",           status: "driver",    req: 1,
    note: "A4tech / Bloody protocol — not implemented" },
  { brand: "Fantech",       model: "THOR II X16",       status: "driver",    req: 1,
    note: "Fantech protocol — not implemented" },
  { brand: "Cooler Master", model: "MasterMouse MM720", status: "driver",    req: 1,
    note: "CM protocol — not implemented" },
  { brand: "Cooler Master", model: "MM711",             status: "driver",    req: 1,
    note: "CM protocol — not implemented" },

  // UNKNOWNS ────────────────────────────────────────────────────────────
  { brand: "Hitscan",       model: "Hyperlight",        status: "unknown",   req: 5,
    note: "Protocol unknown — HID capture needed" },
  { brand: "RAWM",          model: "Leviathan V4",      status: "unknown",   req: 5,
    note: "Protocol unknown" },
  { brand: "AJAZZ",         model: "AJ159 Apex",        status: "unknown",   req: 5,
    note: "Protocol unknown" },
  { brand: "Furycube",      model: "G11",               status: "unknown",   req: 5,
    note: "Protocol unknown" },
  { brand: "Mchose",        model: "K7 Ultra",          status: "unknown",   req: 5,
    note: "Protocol unknown" },
  { brand: "Mchose",        model: "L7 Ultra+",         status: "unknown",   req: 3,
    note: "Protocol unknown" },
  { brand: "G-Wolves",      model: "HTX Mini 8K",       status: "unknown",   req: 3,
    note: "Protocol unknown" },
  { brand: "Angry Miao",    model: "Infinity .97",      status: "unknown",   req: 3,
    note: "Protocol unknown" },
  { brand: "Dark Project",  model: "Novus SE",          status: "unknown",   req: 2,
    note: "Protocol unknown — HID capture needed" },
  { brand: "Scyrox",        model: "V8",                status: "unknown",   req: 2,
    note: "Protocol unknown" },
  { brand: "Incott",        model: "G23 V2 Pro",        status: "unknown",   req: 2,
    note: "Protocol unknown" },
  { brand: "Mchose",        model: "AX5",               status: "unknown",   req: 2,
    note: "Protocol unknown" },
  { brand: "AJAZZ",         model: "AJ139 Pro",         status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "AJAZZ",         model: "AJ199",             status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "Gravastar",     model: "Mercury X Pro",     status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "Gravastar",     model: "M1",                status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "Gravastar",     model: "M2",                status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "G-Wolves",      model: "HT-M-H ACE Wireless",status: "unknown", req: 1,
    note: "Protocol unknown" },
  { brand: "Angry Miao",    model: "Infinity Mouse",    status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "VortexSeries",  model: "IGNIX F3",          status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "Darmoshark",    model: "M3S",               status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "RAWM",          model: "MH01 Pro",          status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "Swiftpoint",    model: "Z2",                status: "unknown",   req: 1,
    note: "Has own software — complex macro/haptics protocol" },
  { brand: "Swiftpoint",    model: "Z3",                status: "unknown",   req: 1,
    note: "Has own software — complex macro/haptics protocol" },
  { brand: "Kreo",          model: "Chimera V2 Wireless",status: "unknown",  req: 1,
    note: "Protocol unknown" },
  { brand: "Kreo",          model: "Harpy",             status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "ipi",           model: "Float 3950",        status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "Solakaka",      model: "SM802 Pro",         status: "unknown",   req: 1,
    note: "Has its own web configurator" },
  { brand: "Eyooso",        model: "X-44 Lite",         status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "HAVIT",         model: "Gamenote",          status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "Empire Gaming", model: "RF906 Wireless",    status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "DeadSkull",     model: "Orbit Wired",       status: "unknown",   req: 1,
    note: "Protocol unknown" },
  { brand: "IGM",           model: "IGM-6000",          status: "unknown",   req: 1,
    note: "Protocol unknown" },
];

// ── State ─────────────────────────────────────────────────────────────────
let activeFilter: Status | "all" = "all";
let searchQuery = "";

// ── Helpers ───────────────────────────────────────────────────────────────
function counts(): Record<string, number> {
  const c: Record<string, number> = { all: 0 };
  for (const k of Object.keys(STATUS)) c[k] = 0;
  for (const m of MICE) { c[m.status]++; c.all++; }
  return c;
}

function visibleMice(): Mouse[] {
  return MICE.filter(m => {
    const fOk = activeFilter === "all" || m.status === activeFilter;
    const q = searchQuery.toLowerCase();
    const sOk = !q || m.model.toLowerCase().includes(q) || m.brand.toLowerCase().includes(q) || m.note.toLowerCase().includes(q);
    return fOk && sOk;
  });
}

// ── Render ────────────────────────────────────────────────────────────────
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Root element missing");

const GH_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7A11.5 11.5 0 0 0 8.4 23c.6.1.8-.3.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C15.8 3.7 17 4 17 4c.6 1.5.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.8 5.4-5.5 5.7.4.4.8 1.1.8 2.2v4.3c0 .4.2.7.8.6A11.5 11.5 0 0 0 12 .7Z"/></svg>`;

const supportedCount = MICE.filter(m => m.status === "supported").length;
const totalBrands = new Set(MICE.filter(m => m.status === "supported").map(m => m.brand)).size;

app.innerHTML = `
  <div class="landing-grid" aria-hidden="true"></div>
  <header class="site-header">
    <a class="wordmark" href="/" aria-label="OpenMouse home">OpenMouse</a>
    <div class="header-actions">
      <a class="demo-link" href="/demo.html">UI demo</a>
      <a class="demo-link nav-current" href="/supported.html" aria-current="page">Devices</a>
      <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch color mode"></button>
      <a class="github-link" href="https://github.com/OpenMouse-Project/openmouse" target="_blank" rel="noreferrer" aria-label="OpenMouse on GitHub">
        ${GH_SVG}
        GitHub <span aria-hidden="true">↗</span>
      </a>
    </div>
  </header>

  <main style="padding-bottom:6rem">
    <div class="devices-hero">
      <p class="eyebrow">DEVICE SUPPORT</p>
      <h1>Community<br><em>requests.</em></h1>
      <p class="lead">
        <strong>${supportedCount} models</strong> confirmed working across ${totalBrands} brands.
        Community-requested devices are tracked below — filter by status or search by name.
      </p>
    </div>

    <div class="filter-bar">
      <input class="search-input" type="search" id="s-input" placeholder="Search model or brand…" autocomplete="off">
      <div class="ftabs" id="ftabs" role="tablist"></div>
    </div>

    <div class="stat-row" id="stat-row"></div>
    <div id="device-list"></div>
  </main>

  <footer>
    <span>OpenMouse · One place to manage supported mice.</span>
    <div class="footer-links">
      <a href="https://x.com/openmouseapp" target="_blank" rel="noreferrer">Follow @openmouseapp on X <span aria-hidden="true">↗</span></a>
      <a href="https://github.com/OpenMouse-Project/openmouse" target="_blank" rel="noreferrer">View source on GitHub <span aria-hidden="true">↗</span></a>
    </div>
  </footer>
`;

const themeToggleEl = document.querySelector<HTMLButtonElement>("#theme-toggle");
if (themeToggleEl) {
  updateThemeToggle();
  themeToggleEl.addEventListener("click", () => {
    const cycle: ThemePreference[] = ["system", "light", "dark"];
    themePreference = cycle[(cycle.indexOf(themePreference) + 1) % cycle.length];
    applyTheme();
    updateThemeToggle();
  });
}

document.getElementById("s-input")?.addEventListener("input", e => {
  searchQuery = (e.target as HTMLInputElement).value;
  renderList();
});

function renderTabs(): void {
  const c = counts();
  document.getElementById("ftabs")!.innerHTML = TABS.map(t =>
    `<button class="ftab${activeFilter === t.key ? " on" : ""}" data-key="${t.key}" role="tab" aria-selected="${activeFilter === t.key}">
      ${t.label}<span class="ftab-n">${c[t.key] ?? 0}</span>
    </button>`
  ).join("");
  document.getElementById("ftabs")!.querySelectorAll<HTMLButtonElement>(".ftab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.key as typeof activeFilter;
      renderTabs();
      renderList();
    });
  });
}

function renderStats(): void {
  const c = counts();
  document.getElementById("stat-row")!.innerHTML = (Object.keys(STATUS) as Status[]).map(k =>
    `<span class="stat-chip">
      <span class="sdot sdot-${k}" aria-hidden="true"></span>
      ${STATUS[k].label}: <strong>${c[k]}</strong>
    </span>`
  ).join("");
}

function renderList(): void {
  const data = visibleMice();
  const el = document.getElementById("device-list")!;

  if (!data.length) {
    el.innerHTML = `<p class="no-results">No devices match your search.</p>`;
    return;
  }

  const groups: Record<string, Mouse[]> = {};
  for (const m of data) (groups[m.brand] = groups[m.brand] || []).push(m);

  const sortedBrands = Object.keys(groups).sort((a, b) => {
    const ra = groups[a].reduce((s, m) => s + m.req, 0);
    const rb = groups[b].reduce((s, m) => s + m.req, 0);
    return rb - ra || a.localeCompare(b);
  });

  el.innerHTML = sortedBrands.map(brand => {
    const items = groups[brand].sort((a, b) =>
      STATUS[a.status].order - STATUS[b.status].order || b.req - a.req,
    );
    const totalReq = items.reduce((s, m) => s + m.req, 0);

    const rows = items.map(m =>
      `<div class="device-row">
        <div style="min-width:0">
          <div class="device-name">${m.model}</div>
          <div class="device-note">${m.note}</div>
        </div>
        <span class="spill spill-${m.status}">${STATUS[m.status].label}</span>
        <span class="req-n${m.req >= 3 ? " hot" : ""}">${m.req}&thinsp;req</span>
      </div>`,
    ).join("");

    return `<div class="brand-grp">
      <div class="brand-lbl">${brand} <span class="brand-reqs">${totalReq} request${totalReq === 1 ? "" : "s"}</span></div>
      <div class="device-card">${rows}</div>
    </div>`;
  }).join("");
}

renderTabs();
renderStats();
renderList();
