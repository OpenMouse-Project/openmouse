import "./control.css";
import {
  EGG_BUTTON_MAPPINGS,
  EGG_BUTTON_NAMES,
  EggOp1HidClient,
  type EggButtonIndex,
  type EggButtonMapping,
  type EggSpdtMode,
} from "./egg-op1-hid";
import { LogitechHidppClient } from "./logitech-hidpp";
import type { MouseStatus } from "./mouse-types";
import { PulsarHidClient } from "./pulsar-hid";
import { PulsarProHidClient } from "./pulsar-pro-hid";

const controlApp = document.querySelector<HTMLDivElement>("#control-app");

if (!controlApp) {
  throw new Error("OpenMouse could not find the control application root.");
}

const appRoot = controlApp;

const ACCESS_KEY = "openmouse-control-access-v2";
const BATTERY_HISTORY_KEY = "openmouse-battery-history-v1";
const ACCESS_USERNAME = "snekxs";
const ACCESS_PASSWORD = "3734";
const BATTERY_CHECKPOINT_MS = 5 * 60 * 1000;
const BATTERY_MAX_SAMPLE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const BATTERY_MAX_CONTINUOUS_GAP_MS = 10 * 60 * 1000;
const BATTERY_MIN_ESTIMATE_SPAN_MS = 10 * 60 * 1000;
const BATTERY_MAX_SAMPLES_PER_DEVICE = 500;
const INTERFACE_SETTINGS_KEY = "openmouse-interface-settings-v1";
let activeClient: LogitechHidppClient | null = null;
let activePulsarClient: PulsarClient | null = null;
let activeEggClient: EggOp1HidClient | null = null;
let refreshTimer: number | null = null;
let refreshInProgress = false;
let dpiOptions: number[] = [];
let settingInProgress = false;
let lastRenderedStatusKey: string | null = null;
let activeDevice: HIDDevice | null = null;
const deviceStatuses = new Map<HIDDevice, MouseStatus>();

type PulsarClient = PulsarHidClient | PulsarProHidClient;
type SupportedClient = LogitechHidppClient | PulsarClient | EggOp1HidClient;

type BatteryMode = "charging" | "discharging";
type InterfaceDensity = "Compact" | "Comfortable";
type InterfaceTheme = "Emerald" | "Violet" | "Ice" | "Ember" | "Mono";

interface InterfacePreferences {
  density: InterfaceDensity;
  theme: InterfaceTheme;
  reducedMotion: boolean;
  expandSections: boolean;
  showExperimental: boolean;
}

const DEFAULT_INTERFACE_PREFERENCES: InterfacePreferences = {
  density: "Compact",
  theme: "Emerald",
  reducedMotion: false,
  expandSections: false,
  showExperimental: true,
};
let interfacePreferences = loadInterfacePreferences();

interface BatterySample {
  timestamp: number;
  percent: number;
  mode: BatteryMode;
}

type BatteryHistory = Record<string, BatterySample[]>;

function renderGate(message = ""): void {
  appRoot.innerHTML = `
    <main class="access-gate">
      <a class="demo-wordmark" href="/">OpenMouse</a>
      <p class="overline">PRIVATE CONTROL PANEL</p>
      <h1>Sign in to continue.</h1>
      <p>Private control for supported devices through WebHID.</p>
      <form id="access-form" class="access-form">
        <label for="access-username">Username</label>
        <input id="access-username" type="text" autocomplete="username" autofocus />
        <label for="access-password">Password</label>
        <input id="access-password" type="password" inputmode="numeric" autocomplete="current-password" />
        <button type="submit">Sign in</button>
        <output id="access-error" aria-live="polite">${message}</output>
      </form>
    </main>`;

  document.querySelector<HTMLFormElement>("#access-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = document.querySelector<HTMLInputElement>("#access-username");
    const password = document.querySelector<HTMLInputElement>("#access-password");
    if (username?.value === ACCESS_USERNAME && password?.value === ACCESS_PASSWORD) {
      sessionStorage.setItem(ACCESS_KEY, "granted");
      renderControl();
      return;
    }
    renderGate("Incorrect username or password.");
  });
}

function loadInterfacePreferences(): InterfacePreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(INTERFACE_SETTINGS_KEY) ?? "{}") as Partial<InterfacePreferences>;
    return {
      density: saved.density === "Comfortable" ? "Comfortable" : "Compact",
      theme: ["Emerald", "Violet", "Ice", "Ember", "Mono"].includes(saved.theme ?? "")
        ? saved.theme as InterfaceTheme
        : "Emerald",
      reducedMotion: saved.reducedMotion === true,
      expandSections: saved.expandSections === true,
      showExperimental: saved.showExperimental !== false,
    };
  } catch {
    return { ...DEFAULT_INTERFACE_PREFERENCES };
  }
}

function saveInterfacePreferences(): void {
  localStorage.setItem(INTERFACE_SETTINGS_KEY, JSON.stringify(interfacePreferences));
  applyInterfacePreferences();
}

function applyInterfacePreferences(): void {
  const shell = document.querySelector<HTMLElement>(".control-shell");
  if (!shell) return;
  shell.classList.toggle("density-comfortable", interfacePreferences.density === "Comfortable");
  shell.classList.toggle("reduce-interface-motion", interfacePreferences.reducedMotion);
  shell.dataset.interfaceTheme = interfacePreferences.theme.toLowerCase();
  document.querySelectorAll<HTMLDetailsElement>(".egg-collapsible, .egg-experimental").forEach((details) => {
    details.open = interfacePreferences.expandSections;
  });
  const experimental = document.querySelector<HTMLElement>("#egg-polling-settings");
  if (experimental && activeEggClient) experimental.style.display = interfacePreferences.showExperimental ? "block" : "none";
}

function renderControl(): void {
  appRoot.innerHTML = `
    <style>
      .control-shell { --ui-accent:#69d28d;--ui-accent-ink:#07120b;--ui-accent-soft:rgb(105 210 141 / 16%) }
      .control-shell[data-interface-theme="violet"] { --ui-accent:#a78bfa;--ui-accent-ink:#130b25;--ui-accent-soft:rgb(167 139 250 / 17%) }
      .control-shell[data-interface-theme="ice"] { --ui-accent:#67d8ff;--ui-accent-ink:#06161d;--ui-accent-soft:rgb(103 216 255 / 16%) }
      .control-shell[data-interface-theme="ember"] { --ui-accent:#ff9b62;--ui-accent-ink:#211006;--ui-accent-soft:rgb(255 155 98 / 17%) }
      .control-shell[data-interface-theme="mono"] { --ui-accent:#f1f1f3;--ui-accent-ink:#09090b;--ui-accent-soft:rgb(241 241 243 / 13%) }
      .control-shell .sidebar-action::before { color:var(--ui-accent) }
      .sidebar-device-list { display:grid;gap:.45rem }
      .sidebar-device-list .device-select { width:100%;color:inherit }
      .sidebar-device-list button.device-select { cursor:pointer;transition:border-color .18s ease,background .18s ease }
      .sidebar-device-list button.device-select:hover { border-color:#4a4a4f;background:#1b1b1e }
      .sidebar-device-list button.device-select.is-selected { border-color:#55555b;background:#202023 }
      .control-shell .device-dot:not(.is-idle), .control-shell .device-status > .status-dot:not(.is-idle), .control-shell .panel-footer .live-status-label i { background:var(--ui-accent);box-shadow:0 0 0 3px var(--ui-accent-soft) }
      .control-shell .segmented button.selected, .control-shell .setting-action button:not(:disabled), .control-shell .dpi-header-actions button:not(:disabled) { border-color:var(--ui-accent);background:var(--ui-accent);color:var(--ui-accent-ink) }
      .control-shell .dpi-header-actions { display:flex;align-items:center;gap:.45rem }
      .control-shell .dpi-header-actions button { padding:.38rem .6rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#b3b3b7;font-size:.62rem;font-weight:700;white-space:nowrap }
      .control-shell .dpi-header-actions button:disabled { cursor:default;opacity:.45 }
      .control-shell .dpi-header-actions input { width:4.7rem;box-sizing:border-box;padding:.38rem .48rem;border:1px solid #343438;border-radius:6px;background:#111113;color:#ececef;font:600 .62rem "JetBrains Mono",monospace;text-align:center }
      .control-shell .dpi-header-actions input:not([readonly]) { border-color:var(--ui-accent);background:#171719 }
      .control-shell .dpi-card .setting-action { margin-top:.55rem }
      .control-shell.is-empty .empty-state { width:min(100%,760px);min-height:0;flex:0 0 auto;align-self:center;box-sizing:border-box;margin:auto;padding:clamp(2rem,5vw,4rem) !important }
      .control-shell.is-empty .empty-state::before { right:-5% !important;width:42% !important;opacity:.65 }
      .control-shell.is-empty .empty-state::after { right:2.5rem !important;bottom:1.75rem !important;font-size:clamp(6rem,12vw,10rem) !important }
      .control-shell.is-empty .empty-state h2 { max-width:480px !important;font-size:clamp(2.5rem,4vw,4rem);line-height:.96 }
      .control-shell.is-empty .empty-state > p:not(.overline) { max-width:440px;margin:.95rem 0 .45rem !important;font-size:.88rem }
      .control-shell.is-empty .empty-state small { display:block;max-width:420px }
      .empty-connect-action { width:max-content;margin-top:1.5rem;padding:.7rem 1rem;border:1px solid var(--ui-accent);border-radius:7px;background:var(--ui-accent);color:var(--ui-accent-ink);font-size:.72rem;font-weight:750 }
      .empty-connect-action::before { margin-right:.45rem;content:"+" }
      .empty-connect-action:hover { filter:brightness(1.07);transform:translateY(-1px) }
      .empty-connect-action:disabled { cursor:wait;opacity:.6;transform:none }
      .control-shell button:focus-visible, .control-shell select:focus-visible, .control-shell input:focus-visible { outline:2px solid var(--ui-accent);outline-offset:2px }
      #pulsar-advanced input[type="number"], #pulsar-advanced select { width:100%;box-sizing:border-box;margin-top:.2rem;padding:.48rem .55rem;border:1px solid #343438;border-radius:6px;outline:none;background:#171719;color:#eee;font:inherit;color-scheme:dark }
      #pulsar-advanced input[type="number"]:focus, #pulsar-advanced select:focus { border-color:#77777c;box-shadow:0 0 0 2px rgb(255 255 255 / 4%) }
      #pulsar-advanced input:disabled, #pulsar-advanced select:disabled { cursor:not-allowed;opacity:.45 }
      #pulsar-advanced input[type="checkbox"] { width:.85rem;height:.85rem;margin:0;accent-color:#69d28d }
      .egg-action-button, #egg-cpi-stage-list [data-apply-cpi] { margin-top:.5rem;padding:.42rem .62rem;border:1px solid #45454a;border-radius:6px;background:#202023;color:#ececef;font-size:.62rem;font-weight:650;transition:border-color .18s ease,background .18s ease,transform .18s ease }
      .egg-action-button:hover, #egg-cpi-stage-list [data-apply-cpi]:hover { border-color:#77777c;background:#29292d;transform:translateY(-1px) }
      .egg-experimental { overflow:hidden;border:1px solid #343438;border-radius:9px;background:#111113 }
      .egg-experimental summary { display:flex;align-items:center;justify-content:space-between;padding:.8rem .9rem;cursor:pointer;color:#d8d8dc;font-size:.76rem;font-weight:650;list-style:none }
      .egg-experimental summary::-webkit-details-marker { display:none }
      .egg-experimental summary small { display:block;margin-bottom:.18rem;color:#d49b62;font-family:"JetBrains Mono",monospace;font-size:.52rem;letter-spacing:.09em }
      .egg-experimental summary i { width:.45rem;height:.45rem;border-right:1px solid #96969b;border-bottom:1px solid #96969b;transform:rotate(45deg);transition:transform .18s ease }
      .egg-experimental[open] summary i { transform:rotate(225deg) }
      .egg-experimental-body { padding:0 .65rem .65rem;border-top:1px solid #29292d }
      .egg-experimental .egg-form-card { min-height:0;margin-top:.65rem;padding:.8rem }
      .egg-experimental .egg-form-card label { display:block;max-width:220px;color:#77777c;font-size:.62rem }
      .egg-warning { margin:-.15rem 0 .65rem;color:#a28b75;font-size:.63rem;line-height:1.45 }
      .egg-experimental #egg-polling-result { display:block;margin-top:.4rem }
      .egg-collapsible { overflow:hidden;border:1px solid #343438;border-radius:9px;background:#111113 }
      .egg-collapsible summary { display:flex;align-items:center;justify-content:space-between;padding:.72rem .85rem;cursor:pointer;color:#d8d8dc;font-size:.74rem;font-weight:650;list-style:none }
      .egg-collapsible summary::-webkit-details-marker { display:none }
      .egg-collapsible summary span small { display:block;margin-bottom:.12rem;color:#77777c;font-family:"JetBrains Mono",monospace;font-size:.5rem;letter-spacing:.09em }
      .egg-collapsible summary i { width:.42rem;height:.42rem;border-right:1px solid #96969b;border-bottom:1px solid #96969b;transform:rotate(45deg);transition:transform .18s ease }
      .egg-collapsible[open] summary i { transform:rotate(225deg) }
      .egg-collapsible-body { padding:.6rem;border-top:1px solid #29292d }
      .egg-collapsible-body > .setting-card { min-height:0 !important;padding:.7rem !important }
      .control-panel { scrollbar-width:none }
      .control-panel::-webkit-scrollbar { display:none;width:0;height:0 }
      #pulsar-advanced.egg-advanced-layout { grid-template-columns:repeat(3,minmax(0,1fr)) !important;gap:.55rem !important }
      #pulsar-advanced.egg-advanced-layout > .setting-card { min-height:0 !important;padding:.72rem !important }
      #egg-cpi-stage-list { grid-template-columns:repeat(4,minmax(0,1fr)) !important }
      #egg-button-list { grid-template-columns:repeat(5,minmax(0,1fr)) !important }
      #egg-cpi-stage-list > div, #egg-button-list > div { min-width:0;padding:.48rem !important }
      @media (max-width:1100px) {
        #egg-cpi-stage-list { grid-template-columns:repeat(2,minmax(0,1fr)) !important }
        #egg-button-list { grid-template-columns:repeat(3,minmax(0,1fr)) !important }
      }
      @media (max-width:720px) {
        #pulsar-advanced.egg-advanced-layout { grid-template-columns:1fr !important }
        #egg-cpi-stage-list, #egg-button-list { grid-template-columns:1fr !important }
      }
      .interface-settings-button::before { content:"⚙";font-size:.72rem }
      .interface-settings-page { position:absolute;z-index:20;inset:0;display:none;padding:1rem 0 2rem;overflow:auto;background:#0b0b0d;scrollbar-width:none }
      .interface-settings-page::-webkit-scrollbar { display:none }
      .interface-settings-page.is-open { display:block }
      .interface-settings-header { display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;padding:1rem 0 1.2rem;border-bottom:1px solid #29292d }
      .interface-settings-header h2 { margin:.25rem 0 0;font-size:2rem;font-weight:500;letter-spacing:-.035em }
      .interface-settings-back { padding:.48rem .7rem;border:1px solid #3b3b40;border-radius:7px;background:#18181b;color:#e6e6e9;font-size:.68rem;font-weight:650 }
      .interface-settings-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem;margin-top:.75rem }
      .interface-setting-card { min-height:120px;padding:1rem;border:1px solid #2f2f34;border-radius:10px;background:#111113 }
      .interface-setting-card > span { color:#77777c;font-family:"JetBrains Mono",monospace;font-size:.55rem;letter-spacing:.09em }
      .interface-setting-card h3 { margin:.35rem 0 .3rem;font-size:1rem;font-weight:550 }
      .interface-setting-card p { margin:0 0 .8rem;color:#85858a;font-size:.68rem;line-height:1.45 }
      .interface-setting-card select { width:100%;padding:.52rem;border:1px solid #39393e;border-radius:7px;background:#18181b;color:#eee;color-scheme:dark }
      .theme-preview { display:flex;gap:.32rem;margin-top:.65rem }
      .theme-preview i { width:1.25rem;height:.28rem;border-radius:999px;background:var(--ui-accent);opacity:.2 }
      .theme-preview i:nth-child(2) { opacity:.35 }.theme-preview i:nth-child(3) { opacity:.55 }.theme-preview i:nth-child(4) { opacity:.75 }.theme-preview i:nth-child(5) { opacity:1 }
      .interface-switch-row { display:flex;align-items:center;justify-content:space-between;gap:.8rem;margin-top:.7rem;color:#c5c5c9;font-size:.72rem }
      .interface-switch-row input {
        appearance:none;
        width:2.25rem;
        height:1.25rem;
        flex:0 0 auto;
        margin:0;
        border:1px solid #414147;
        border-radius:999px;
        outline:none;
        background-color:#242428;
        background-image:radial-gradient(circle at .56rem 50%,#a0a0a5 0 .34rem,transparent .36rem);
        cursor:pointer;
        transition:border-color .18s ease,background-color .18s ease,background-position .18s ease,box-shadow .18s ease;
      }
      .interface-switch-row input:checked {
        border-color:var(--ui-accent);
        background-color:var(--ui-accent);
        background-image:radial-gradient(circle at calc(100% - .56rem) 50%,#07120b 0 .34rem,transparent .36rem);
      }
      .interface-switch-row input:focus-visible { box-shadow:0 0 0 3px var(--ui-accent-soft) }
      .interface-reset { margin-top:.75rem;padding:.55rem .75rem;border:1px solid #4a3436;border-radius:7px;background:#1c1315;color:#e7a7aa;font-size:.68rem;font-weight:650 }
      .density-comfortable #pulsar-advanced.egg-advanced-layout { gap:.8rem !important }
      .density-comfortable #pulsar-advanced.egg-advanced-layout > .setting-card { padding:1rem !important }
      .density-comfortable .settings-grid { gap:.9rem !important }
      .density-comfortable .settings-grid .setting-card { padding:1.1rem !important }
      .density-comfortable .device-overview .summary-stat { padding:1rem 1.2rem !important }
      .density-comfortable .egg-collapsible summary, .density-comfortable .egg-experimental summary { padding:.95rem 1rem }
      .reduce-interface-motion *, .reduce-interface-motion *::before, .reduce-interface-motion *::after { scroll-behavior:auto !important;transition:none !important;animation:none !important }
      #logitech-device-details { flex:0 0 auto }
      #logitech-device-details .setting-card { min-height:0 }
      @media (min-width:900px) {
        .control-shell .settings-grid { grid-template-rows:minmax(220px,auto) }
        .control-shell .settings-grid > .setting-card { min-height:220px }
      }
      @media (max-width:720px) { .interface-settings-grid { grid-template-columns:1fr } }
    </style>
    <div class="control-shell is-empty">
      <aside class="sidebar">
        <a class="demo-wordmark" href="/">OpenMouse</a>
        <div class="device-label">CONNECTED DEVICES</div>
        <div id="sidebar-device-list" class="sidebar-device-list">
          <div class="device-select">
            <span class="device-dot is-idle"></span>
            <span><strong>No device connected</strong><small>Choose a supported device</small></span>
          </div>
        </div>
        <button id="connect-button" class="sidebar-action" type="button">Add device</button>
        <button id="interface-settings-button" class="sidebar-action interface-settings-button" type="button">Interface settings</button>
        <div class="sidebar-footer"><span>WebHID device control</span><a href="/">Back to website</a></div>
      </aside>

      <main class="control-panel" style="position:relative;overflow-y:auto">
        <div class="preview-banner"><span>WEBHID</span><p id="connection-banner">Connect a supported device to view and change its settings.</p></div>
        <header class="panel-header">
          <div><p class="overline">DEVICE CONTROL</p><h1 id="device-title">Connect a mouse</h1></div>
          <div class="device-status"><span class="status-dot is-idle"></span><span id="device-status">No device connected</span></div>
        </header>
        <section class="empty-state" aria-labelledby="empty-state-title">
          <p class="overline">READY WHEN YOU ARE</p>
          <h2 id="empty-state-title">Connect a supported mouse.</h2>
          <p>Choose your mouse in the browser prompt to view and adjust its onboard settings.</p>
          <small>Your browser will only show compatible WebHID devices.</small>
          <button id="empty-connect-button" class="empty-connect-action" type="button">Add device</button>
        </section>
        <section class="device-overview device-data" aria-label="Device status">
          <article id="battery-summary" class="summary-stat"><span>BATTERY</span><strong id="battery-value">—</strong><small id="battery-detail">Read after connection</small><div class="meter"><i id="battery-meter" style="width:0%"></i></div></article>
          <article class="summary-stat"><span>FIRMWARE</span><strong id="firmware-value">—</strong><small id="firmware-detail">Read after connection</small></article>
          <article class="summary-stat"><span>CONNECTION</span><strong id="connection-value">—</strong><small id="connection-detail">2.4 GHz receiver</small><button id="dongle-led-toggle" type="button" style="align-self:flex-start;margin-top:.45rem;padding:.28rem .5rem;border:1px solid #3a3a3f;border-radius:5px;background:#19191c;color:#d8d8dc;font-size:.61rem;font-weight:600" hidden disabled>Receiver LED</button></article>
        </section>
        <section class="settings-grid device-data" aria-label="Mouse status">
          <article class="setting-card dpi-card"><div class="setting-heading"><div><p>DPI</p><h2>Sensitivity</h2></div><div class="dpi-header-actions"><input id="dpi-output" type="text" inputmode="numeric" value="— DPI" aria-label="DPI value" readonly /><button id="custom-dpi" type="button" disabled>Custom</button></div></div><div id="dpi-presets" class="segmented dpi-presets" aria-label="Common DPI values"></div><div id="logitech-axis-controls" style="display:none;margin-top:.6rem;padding-top:.6rem;border-top:1px solid #29292d"><div style="display:grid;grid-template-columns:1fr 1fr auto;gap:.45rem;align-items:end"><label style="color:#77777c;font-size:.6rem">X axis<input id="logitech-dpi-x" type="number" min="100" step="50" style="width:100%;box-sizing:border-box;margin-top:.2rem;padding:.42rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee" /></label><label style="color:#77777c;font-size:.6rem">Y axis<input id="logitech-dpi-y" type="number" min="100" step="50" style="width:100%;box-sizing:border-box;margin-top:.2rem;padding:.42rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee" /></label><button id="apply-logitech-axes" type="button" style="padding:.45rem .6rem;border:1px solid #45454a;border-radius:6px;background:#202023;color:#ececef;font-size:.62rem">Apply</button></div></div><div class="setting-action"><span id="dpi-pending">Choose a DPI value</span></div></article>
          <article class="setting-card"><div class="setting-heading"><div><p>POLLING RATE</p><h2>Report frequency</h2></div></div><div class="segmented rate-options"><button data-rate="125" disabled>125</button><button data-rate="250" disabled>250</button><button data-rate="500" disabled>500</button><button data-rate="1000" disabled>1K</button><button data-rate="2000" disabled>2K</button><button data-rate="4000" disabled>4K</button><button data-rate="8000" disabled>8K</button></div><small id="polling-note" class="setting-note">Higher rates update cursor movement more often, but use more battery.</small></article>
          <article class="setting-card"><div class="setting-heading"><div><p>SENSOR</p><h2>Lift-off distance</h2></div></div><div class="segmented three"><button data-lod="Low" disabled>0.7 mm</button><button data-lod="Medium" disabled>1 mm</button><button data-lod="High" disabled>2 mm</button></div><small class="setting-note">Controls how far you can lift the mouse before tracking stops. Higher values keep tracking a little longer.</small></article>
        </section>
        <section id="logitech-device-details" class="device-data" style="display:none;margin-top:.65rem">
          <details class="egg-collapsible"><summary><span><small>LOGITECH HID++</small>Device details</span><i aria-hidden="true"></i></summary><div class="egg-collapsible-body"><article class="setting-card" style="min-height:0"><div id="logitech-detail-list" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.55rem"></div></article></div></details>
        </section>
        <section id="pulsar-advanced" class="device-data" aria-label="Advanced Pulsar settings" style="display:none;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:.65rem;margin-top:.65rem;padding-bottom:.4rem">
          <article id="signal-settings" class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>WIRELESS</p><h2>Signal strength</h2></div><output id="signal-output">—</output></div><small id="signal-detail" class="setting-note">Receiver signal is unavailable.</small></article>
          <article id="debounce-settings" class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>CLICK</p><h2>Debounce</h2></div></div><select id="debounce-select" style="width:100%;padding:.48rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"></select></article>
          <article id="sleep-settings" class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>POWER</p><h2>Auto sleep</h2></div></div><select id="sleep-select" style="width:100%;padding:.48rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"><option value="1">10 seconds</option><option value="3">30 seconds</option><option value="6">1 minute</option><option value="12">2 minutes</option><option value="30">5 minutes</option><option value="60">10 minutes</option><option value="180">30 minutes</option></select></article>
          <article class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>SENSOR</p><h2>Processing</h2></div></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Motion Sync</span><button id="motion-sync-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Angle snapping</span><button id="angle-snapping-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Ripple control</span><button id="ripple-control-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div id="performance-mode-setting" style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Performance mode</span><button id="performance-mode-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div></article>
          <article id="egg-filter-settings" class="setting-card" style="display:none;min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>SENSOR</p><h2>Filters</h2></div></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Slamclick filter</span><button id="slamclick-filter-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Motion-jitter filter</span><button id="motion-jitter-filter-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div></article>
          <article id="egg-spdt-settings" class="setting-card" style="display:none;min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>CLICK</p><h2>GX switch mode</h2></div></div><label style="display:block;color:#77777c;font-size:.62rem">Left button<select id="left-spdt-select" style="width:100%;margin-top:.2rem;padding:.4rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"><option>Off</option><option>GX Safe</option><option>GX Speed</option></select></label><label style="display:block;margin-top:.45rem;color:#77777c;font-size:.62rem">Right button<select id="right-spdt-select" style="width:100%;margin-top:.2rem;padding:.4rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"><option>Off</option><option>GX Safe</option><option>GX Speed</option></select></label></article>
          <details id="egg-polling-settings" class="egg-experimental" style="display:none;grid-column:1/-1"><summary><span><small>EXPERIMENTAL</small>Experimental settings</span><i aria-hidden="true"></i></summary><div class="egg-experimental-body"><article class="setting-card egg-form-card"><div class="setting-heading"><div><p>POLLING</p><h2>Custom divider</h2></div></div><p class="egg-warning">Nonstandard polling dividers may behave differently across firmware versions.</p><label>8K divider<input id="egg-polling-divider" type="number" min="1" max="255" step="1" /></label><small id="egg-polling-result" class="setting-note">—</small><button id="apply-egg-polling" class="egg-action-button" type="button">Apply divider</button></article></div></details>
          <details id="egg-cpi-settings" class="egg-collapsible" style="display:none;grid-column:1/-1"><summary><span><small>SENSOR</small>CPI stages</span><i aria-hidden="true"></i></summary><div class="egg-collapsible-body"><article class="setting-card"><label style="display:block;max-width:160px;color:#77777c;font-size:.62rem">Enabled stages<select id="egg-cpi-levels"><option value="1">1 stage</option><option value="2">2 stages</option><option value="3">3 stages</option><option value="4">4 stages</option></select></label><div id="egg-cpi-stage-list" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.5rem;margin-top:.55rem"></div></article></div></details>
          <details id="egg-button-settings" class="egg-collapsible" style="display:none;grid-column:1/-1"><summary><span><small>BUTTONS</small>Multiclick and mapping</span><i aria-hidden="true"></i></summary><div class="egg-collapsible-body"><article class="setting-card"><div id="egg-button-list" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:.5rem"></div></article></div></details>
          <article id="pulsar-pro-settings" class="setting-card" style="display:none;min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>PRO</p><h2>Advanced</h2></div></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Wheel acceleration</span><button id="wheel-acceleration-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><label style="display:block;margin-top:.35rem;color:#77777c;font-size:.62rem">Angle tuning<select id="angle-tuning-select" style="width:100%;margin-top:.2rem;padding:.4rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"></select></label><label style="display:block;margin-top:.35rem;color:#77777c;font-size:.62rem">Onboard profile<select id="profile-select" style="width:100%;margin-top:.2rem;padding:.4rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"><option value="1">Profile 1</option><option value="2">Profile 2</option><option value="3">Profile 3</option><option value="4">Profile 4</option><option value="5">Profile 5</option><option value="6">Profile 6</option></select></label></article>
        </section>
        <footer class="panel-footer device-data"><span class="live-status-label"><i></i>LIVE STATUS</span><span id="read-status">Add a supported device from the sidebar to read its current status.</span></footer>
        <section id="interface-settings-page" class="interface-settings-page" aria-labelledby="interface-settings-title">
          <header class="interface-settings-header"><div><p class="overline">OPENMOUSE</p><h2 id="interface-settings-title">Interface settings</h2></div><button id="close-interface-settings" class="interface-settings-back" type="button">Back to device</button></header>
          <div class="interface-settings-grid">
            <article class="interface-setting-card"><span>LAYOUT</span><h3>Interface density</h3><p>Choose tighter controls or add more breathing room throughout the panel.</p><select id="interface-density"><option>Compact</option><option>Comfortable</option></select></article>
            <article class="interface-setting-card"><span>APPEARANCE</span><h3>Accent theme</h3><p>Customize active controls, status lights, switches, and focus highlights.</p><select id="interface-theme"><option>Emerald</option><option>Violet</option><option>Ice</option><option>Ember</option><option>Mono</option></select><div class="theme-preview" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></article>
            <article class="interface-setting-card"><span>MOTION</span><h3>Animation</h3><p>Disable interface transitions and animated state changes.</p><label class="interface-switch-row"><span>Reduce motion</span><input id="interface-reduced-motion" type="checkbox" /></label></article>
            <article class="interface-setting-card"><span>SECTIONS</span><h3>Advanced editors</h3><p>Choose whether CPI, button mapping, and experimental sections begin expanded.</p><label class="interface-switch-row"><span>Expand by default</span><input id="interface-expand-sections" type="checkbox" /></label></article>
            <article class="interface-setting-card"><span>EXPERIMENTAL</span><h3>Experimental controls</h3><p>Show or completely hide controls that may vary between firmware versions.</p><label class="interface-switch-row"><span>Show experimental settings</span><input id="interface-show-experimental" type="checkbox" /></label></article>
          </div>
          <button id="reset-interface-settings" class="interface-reset" type="button">Reset interface preferences</button>
        </section>
      </main>
    </div>`;

  document.querySelector<HTMLButtonElement>("#connect-button")?.addEventListener("click", () => {
    void connect();
  });
  document.querySelector<HTMLButtonElement>("#empty-connect-button")?.addEventListener("click", () => {
    void connect();
  });
  document.querySelector<HTMLElement>("#sidebar-device-list")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-device-index]");
    if (!button) return;
    void selectAuthorizedDevice(Number(button.dataset.deviceIndex));
  });
  document.querySelector<HTMLButtonElement>("#interface-settings-button")?.addEventListener("click", openInterfaceSettings);
  document.querySelector<HTMLButtonElement>("#close-interface-settings")?.addEventListener("click", closeInterfaceSettings);
  document.querySelector<HTMLSelectElement>("#interface-density")?.addEventListener("change", (event) => {
    interfacePreferences.density = (event.target as HTMLSelectElement).value as InterfaceDensity;
    saveInterfacePreferences();
  });
  document.querySelector<HTMLSelectElement>("#interface-theme")?.addEventListener("change", (event) => {
    interfacePreferences.theme = (event.target as HTMLSelectElement).value as InterfaceTheme;
    saveInterfacePreferences();
  });
  document.querySelector<HTMLInputElement>("#interface-reduced-motion")?.addEventListener("change", (event) => {
    interfacePreferences.reducedMotion = (event.target as HTMLInputElement).checked;
    saveInterfacePreferences();
  });
  document.querySelector<HTMLInputElement>("#interface-expand-sections")?.addEventListener("change", (event) => {
    interfacePreferences.expandSections = (event.target as HTMLInputElement).checked;
    saveInterfacePreferences();
  });
  document.querySelector<HTMLInputElement>("#interface-show-experimental")?.addEventListener("change", (event) => {
    interfacePreferences.showExperimental = (event.target as HTMLInputElement).checked;
    saveInterfacePreferences();
  });
  document.querySelector<HTMLButtonElement>("#reset-interface-settings")?.addEventListener("click", () => {
    interfacePreferences = { ...DEFAULT_INTERFACE_PREFERENCES };
    saveInterfacePreferences();
    populateInterfaceSettings();
  });
  document.querySelector<HTMLButtonElement>("#custom-dpi")?.addEventListener("click", () => {
    void chooseCustomDpi();
  });
  document.querySelector<HTMLButtonElement>("#apply-logitech-axes")?.addEventListener("click", () => {
    void applyLogitechAxisDpi();
  });
  document.querySelector<HTMLInputElement>("#dpi-output")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void chooseCustomDpi();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      finishCustomDpiEditing();
    }
  });
  document.querySelector<HTMLButtonElement>("#dongle-led-toggle")?.addEventListener("click", () => {
    void toggleDongleLed();
  });
  for (let debounce = 0; debounce <= 15; debounce += 1) {
    document.querySelector<HTMLSelectElement>("#debounce-select")?.add(new Option(`${debounce} ms`, String(debounce)));
  }
  for (let angle = -30; angle <= 30; angle += 1) {
    document.querySelector<HTMLSelectElement>("#angle-tuning-select")?.add(new Option(`${angle}°`, String(angle)));
  }
  document.querySelector<HTMLSelectElement>("#debounce-select")?.addEventListener("change", (event) => {
    void applyPulsarValue("debounce", Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLSelectElement>("#sleep-select")?.addEventListener("change", (event) => {
    void applyPulsarValue("sleep", Number((event.target as HTMLSelectElement).value));
  });
  const toggles = [
    ["#motion-sync-toggle", "motionSync"],
    ["#angle-snapping-toggle", "angleSnapping"],
    ["#ripple-control-toggle", "rippleControl"],
    ["#performance-mode-toggle", "performanceMode"],
  ] as const;
  for (const [selector, setting] of toggles) {
    document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", (event) => {
      void applyPulsarToggle(setting, (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true");
    });
  }
  const eggFilterToggles = [
    ["#slamclick-filter-toggle", "slamclick"],
    ["#motion-jitter-filter-toggle", "motionJitter"],
  ] as const;
  for (const [selector, setting] of eggFilterToggles) {
    document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", (event) => {
      void applyEggFilter(setting, (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true");
    });
  }
  document.querySelector<HTMLSelectElement>("#left-spdt-select")?.addEventListener("change", (event) => {
    void applyEggSpdtMode("left", (event.target as HTMLSelectElement).value as EggSpdtMode);
  });
  document.querySelector<HTMLSelectElement>("#right-spdt-select")?.addEventListener("change", (event) => {
    void applyEggSpdtMode("right", (event.target as HTMLSelectElement).value as EggSpdtMode);
  });
  document.querySelector<HTMLSelectElement>("#egg-cpi-levels")?.addEventListener("change", (event) => {
    void applyEggCpiLevels(Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLInputElement>("#egg-polling-divider")?.addEventListener("input", updateCustomPollingPreview);
  document.querySelector<HTMLButtonElement>("#apply-egg-polling")?.addEventListener("click", () => {
    const divider = Number(document.querySelector<HTMLInputElement>("#egg-polling-divider")?.value);
    void applyEggPollingDivider(divider);
  });
  document.querySelector<HTMLButtonElement>("#wheel-acceleration-toggle")?.addEventListener("click", (event) => {
    void applyProSetting("wheelAcceleration", (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true");
  });
  document.querySelector<HTMLSelectElement>("#angle-tuning-select")?.addEventListener("change", (event) => {
    void applyProSetting("angleTuning", Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLSelectElement>("#profile-select")?.addEventListener("change", (event) => {
    void applyProSetting("profile", Number((event.target as HTMLSelectElement).value));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => {
    button.addEventListener("click", () => {
      void applyPollingRate(Number(button.dataset.rate));
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => {
    button.addEventListener("click", () => {
      const lod = button.dataset.lod as MouseStatus["liftOffDistance"];
      if (lod) void applyLiftOffDistance(lod);
    });
  });
  const shell = document.querySelector<HTMLElement>(".control-shell");
  const panel = document.querySelector<HTMLElement>(".control-panel");
  shell?.addEventListener("wheel", (event) => {
    if (!panel || panel.contains(event.target as Node) || event.deltaY === 0) return;
    panel.scrollTop += event.deltaY;
    event.preventDefault();
  }, { passive: false });
  populateInterfaceSettings();
  applyInterfacePreferences();
  navigator.hid?.addEventListener("connect", handleHidConnect);
  navigator.hid?.addEventListener("disconnect", handleHidDisconnect);
  void reconnectAuthorizedDevice();
}

function openInterfaceSettings(): void {
  populateInterfaceSettings();
  document.querySelector<HTMLElement>("#interface-settings-page")?.classList.add("is-open");
  document.querySelector<HTMLElement>(".control-panel")?.scrollTo({ top: 0 });
}

function closeInterfaceSettings(): void {
  document.querySelector<HTMLElement>("#interface-settings-page")?.classList.remove("is-open");
}

function populateInterfaceSettings(): void {
  setControlValue("#interface-density", interfacePreferences.density);
  setControlValue("#interface-theme", interfacePreferences.theme);
  const reducedMotion = document.querySelector<HTMLInputElement>("#interface-reduced-motion");
  const expandSections = document.querySelector<HTMLInputElement>("#interface-expand-sections");
  const showExperimental = document.querySelector<HTMLInputElement>("#interface-show-experimental");
  if (reducedMotion) reducedMotion.checked = interfacePreferences.reducedMotion;
  if (expandSections) expandSections.checked = interfacePreferences.expandSections;
  if (showExperimental) showExperimental.checked = interfacePreferences.showExperimental;
}

function setText(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function batteryMode(state: MouseStatus["batteryState"]): BatteryMode | null {
  if (state === "Charging" || state === "Charging slowly" || state === "Almost full") return "charging";
  if (state === "Discharging") return "discharging";
  return null;
}

function loadBatteryHistory(): BatteryHistory {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BATTERY_HISTORY_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as BatteryHistory : {};
  } catch {
    return {};
  }
}

function saveBatterySample(deviceName: string, percent: number, mode: BatteryMode, now = Date.now()): BatterySample[] {
  const history = loadBatteryHistory();
  const cutoff = now - BATTERY_MAX_SAMPLE_AGE_MS;
  const storedSamples = Array.isArray(history[deviceName]) ? history[deviceName] : [];
  const samples = storedSamples.filter((sample) =>
    Number.isFinite(sample.timestamp)
    && Number.isFinite(sample.percent)
    && sample.timestamp >= cutoff
    && sample.percent >= 0
    && sample.percent <= 100
    && (sample.mode === "charging" || sample.mode === "discharging"));
  const previous = samples.at(-1);
  const shouldSave = !previous
    || previous.mode !== mode
    || previous.percent !== percent
    || now - previous.timestamp >= BATTERY_CHECKPOINT_MS;

  if (shouldSave) samples.push({ timestamp: now, percent, mode });
  const retainedSamples = samples.slice(-BATTERY_MAX_SAMPLES_PER_DEVICE);
  history[deviceName] = retainedSamples;
  if (shouldSave || retainedSamples.length !== storedSamples.length) {
    try {
      localStorage.setItem(BATTERY_HISTORY_KEY, JSON.stringify(history));
    } catch {
      // Estimates remain optional when browser storage is unavailable or full.
    }
  }
  return retainedSamples;
}

function formatEstimate(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60000));
  if (minutes < 60) return `~${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `~${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hr`;
  const days = hours / 24;
  return `~${days < 10 ? days.toFixed(1) : Math.round(days)} days`;
}

function estimateBatteryTime(samples: BatterySample[], percent: number, mode: BatteryMode, now = Date.now()): string | null {
  const continuous: BatterySample[] = [];
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    const newer = continuous[0];
    if (sample.mode !== mode || (newer && newer.timestamp - sample.timestamp > BATTERY_MAX_CONTINUOUS_GAP_MS)) break;
    continuous.unshift(sample);
  }

  const first = continuous[0];
  const last = continuous.at(-1);
  if (!first || !last || now - last.timestamp > BATTERY_MAX_CONTINUOUS_GAP_MS) return null;
  const elapsed = last.timestamp - first.timestamp;
  const change = mode === "charging" ? last.percent - first.percent : first.percent - last.percent;
  if (elapsed < BATTERY_MIN_ESTIMATE_SPAN_MS || change < 1) return null;

  const remainingPercent = mode === "charging" ? 100 - percent : percent;
  if (remainingPercent <= 0) return null;
  return formatEstimate(remainingPercent / (change / elapsed));
}

function batteryDetail(status: MouseStatus): string {
  const voltage = status.batteryVoltageMv ? `${(status.batteryVoltageMv / 1000).toFixed(3)} V` : null;
  const withVoltage = (detail: string): string => voltage ? `${detail} · ${voltage}` : detail;
  if (status.batteryPercent === null) return withVoltage(status.batteryState);
  if (status.batteryState === "Full") return withVoltage("Fully charged");
  const mode = batteryMode(status.batteryState);
  if (!mode) return withVoltage(status.batteryState);
  const now = Date.now();
  const samples = saveBatterySample(status.name, status.batteryPercent, mode, now);
  const estimate = estimateBatteryTime(samples, status.batteryPercent, mode, now);
  const label = mode === "charging" ? "until full" : "remaining";
  return withVoltage(estimate ? `${status.batteryState} · ${estimate} ${label}` : `${status.batteryState} · Calculating estimate`);
}

function resetDeviceSpecificPanels(): void {
  for (const selector of [
    "#egg-filter-settings",
    "#egg-spdt-settings",
    "#egg-polling-settings",
    "#egg-cpi-settings",
    "#egg-button-settings",
    "#pulsar-pro-settings",
  ]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.style.display = "none";
  }
  document.querySelector<HTMLElement>("#pulsar-advanced")?.classList.remove("egg-advanced-layout");
}

function showStatus(status: MouseStatus): void {
  lastRenderedStatusKey = JSON.stringify(status);
  const isEgg = status.brand === "Endgame Gear";
  const isWired = status.connectionType === "Wired";
  // Always clear device-specific panels first. A status read from the previous
  // mouse may have left these visible when WebHID switches devices.
  resetDeviceSpecificPanels();
  const batterySummary = document.querySelector<HTMLElement>("#battery-summary");
  if (batterySummary) {
    batterySummary.hidden = isWired;
    batterySummary.style.display = isWired ? "none" : "flex";
  }
  const overview = document.querySelector<HTMLElement>(".device-overview");
  if (overview) overview.style.gridTemplateColumns = isWired ? "repeat(2, 1fr)" : "repeat(3, 1fr)";
  setText("#polling-note", isEgg
    ? "Higher rates update cursor movement more often and increase CPU/USB processing load."
    : "Higher rates update cursor movement more often, but use more battery.");
  for (const selector of ["#signal-settings", "#debounce-settings", "#sleep-settings"]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.hidden = isEgg;
  }
  const performanceModeSetting = document.querySelector<HTMLElement>("#performance-mode-setting");
  if (performanceModeSetting) {
    performanceModeSetting.hidden = isEgg;
    performanceModeSetting.style.display = isEgg ? "none" : "flex";
  }
  const battery = status.batteryPercent === null ? "—" : `${status.batteryPercent}%`;
  const dpiOutput = document.querySelector<HTMLInputElement>("#dpi-output");
  if (dpiOutput?.readOnly) dpiOutput.value = `${status.dpi.toLocaleString()} DPI`;
  setText("#battery-value", battery);
  setText("#battery-detail", batteryDetail(status));
  setText("#firmware-value", status.firmware[0] ?? "—");
  setText("#firmware-detail", status.firmware.slice(1).join(" · ") || "Firmware reported by mouse");
  setText("#connection-value", status.connectionType ?? "Wireless");
  setText("#connection-detail", status.connectionDetail
    ?? (status.activeProfile ? `2.4 GHz · Profile ${status.activeProfile}` : "2.4 GHz receiver"));
  const dongleLedButton = document.querySelector<HTMLButtonElement>("#dongle-led-toggle");
  if (dongleLedButton) {
    const supported = status.brand === "Pulsar" && status.dongleLedEnabled !== null && status.dongleLedEnabled !== undefined;
    dongleLedButton.hidden = !supported;
    dongleLedButton.disabled = !supported;
    dongleLedButton.dataset.enabled = status.dongleLedEnabled ? "true" : "false";
    dongleLedButton.textContent = status.dongleLedEnabled ? "Receiver LED: On" : "Receiver LED: Off";
  }
  const advanced = document.querySelector<HTMLElement>("#pulsar-advanced");
  if (advanced) {
    advanced.style.display = status.brand === "Pulsar" || status.brand === "Endgame Gear" ? "grid" : "none";
    advanced.classList.toggle("egg-advanced-layout", isEgg);
  }
  if (status.brand === "Pulsar" || status.brand === "Endgame Gear") {
    const strength = status.signalStrength;
    setText("#signal-output", strength === null || strength === undefined ? "—" : `${strength}/4`);
    setText("#signal-detail", strength === null || strength === undefined
      ? "Receiver signal is unavailable."
      : ["Very weak", "Weak", "Fair", "Good", "Excellent"][strength] ?? `Level ${strength}`);
    setControlValue("#debounce-select", status.debounceMs);
    setControlValue("#sleep-select", status.sleepTimeout);
    setToggleValue("#motion-sync-toggle", status.motionSync);
    setToggleValue("#angle-snapping-toggle", status.angleSnapping);
    setToggleValue("#ripple-control-toggle", status.rippleControl);
    setToggleValue("#performance-mode-toggle", status.performanceMode);
    const eggFilterSettings = document.querySelector<HTMLElement>("#egg-filter-settings");
    const eggSpdtSettings = document.querySelector<HTMLElement>("#egg-spdt-settings");
    const eggPollingSettings = document.querySelector<HTMLElement>("#egg-polling-settings");
    const eggCpiSettings = document.querySelector<HTMLElement>("#egg-cpi-settings");
    const eggButtonSettings = document.querySelector<HTMLElement>("#egg-button-settings");
    if (eggFilterSettings) eggFilterSettings.style.display = isEgg ? "block" : "none";
    if (eggSpdtSettings) eggSpdtSettings.style.display = isEgg ? "block" : "none";
    if (eggPollingSettings) eggPollingSettings.style.display = isEgg && interfacePreferences.showExperimental ? "block" : "none";
    if (eggCpiSettings) eggCpiSettings.style.display = isEgg ? "block" : "none";
    if (eggButtonSettings) eggButtonSettings.style.display = isEgg ? "block" : "none";
    if (isEgg) {
      setToggleValue("#slamclick-filter-toggle", status.slamclickFilter);
      setToggleValue("#motion-jitter-filter-toggle", status.motionJitterFilter);
      setControlValue("#left-spdt-select", status.leftSpdtMode);
      setControlValue("#right-spdt-select", status.rightSpdtMode);
      setControlValue("#egg-cpi-levels", status.eggCpiLevels);
      setControlValue("#egg-polling-divider", status.eggPollingDivider);
      updateCustomPollingPreview();
      renderEggCpiStages(status);
      renderEggButtons(status);
    }
    const proSettings = document.querySelector<HTMLElement>("#pulsar-pro-settings");
    const isPro = status.connectionDetail?.includes("Pulsar Pro protocol") === true;
    if (proSettings) proSettings.style.display = isPro ? "block" : "none";
    if (isPro) {
      setToggleValue("#wheel-acceleration-toggle", status.wheelAcceleration);
      setControlValue("#angle-tuning-select", status.angleTuning);
      setControlValue("#profile-select", status.activeProfile);
    }
  }
  setText("#device-title", status.name);
  if (activeDevice) {
    deviceStatuses.set(activeDevice, status);
    void renderDeviceSidebar();
  }
  setText("#device-status", "Connected");
  setText("#connection-banner", "Connected directly through WebHID. Supported settings can be adjusted here.");
  setText("#read-status", `Current: ${status.dpi.toLocaleString()} DPI · ${status.pollingRateHz.toLocaleString()} Hz`);
  const meter = document.querySelector<HTMLElement>("#battery-meter");
  if (meter) meter.style.width = status.batteryPercent === null ? "0%" : `${status.batteryPercent}%`;
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.remove("is-idle"));
  document.querySelector<HTMLElement>(".control-shell")?.classList.remove("is-empty");
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => button.classList.toggle("selected", Number(button.dataset.rate) === status.pollingRateHz));
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => button.classList.toggle("selected", button.dataset.lod === status.liftOffDistance));
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => {
    const rate = Number(button.dataset.rate);
    const unsupportedForEgg = isEgg && rate < 1000;
    const unsupportedForLogitech = status.brand === "Logitech"
      && Array.isArray(status.supportedPollingRates)
      && !status.supportedPollingRates.includes(rate);
    button.hidden = unsupportedForEgg || unsupportedForLogitech;
    button.disabled = unsupportedForEgg || unsupportedForLogitech;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => {
    const unsupportedForEgg = isEgg && button.dataset.lod === "Low";
    button.hidden = unsupportedForEgg;
    button.disabled = unsupportedForEgg || (status.brand === "Logitech" && button.dataset.lod === "Low");
  });
  document.querySelectorAll<HTMLButtonElement>("[data-dpi]").forEach((button) => button.classList.toggle("selected", Number(button.dataset.dpi) === status.dpi));
  const axisControls = document.querySelector<HTMLElement>("#logitech-axis-controls");
  if (axisControls) axisControls.style.display = status.brand === "Logitech" && status.supportsSeparateDpiAxes ? "block" : "none";
  const dpiX = document.querySelector<HTMLInputElement>("#logitech-dpi-x");
  const dpiY = document.querySelector<HTMLInputElement>("#logitech-dpi-y");
  if (dpiX) dpiX.value = String(status.dpi);
  if (dpiY) dpiY.value = String(status.dpiY ?? status.dpi);
  const logitechDetails = document.querySelector<HTMLElement>("#logitech-device-details");
  if (logitechDetails) logitechDetails.style.display = status.brand === "Logitech" ? "block" : "none";
  if (status.brand === "Logitech") renderLogitechDetails(status);
}

function renderLogitechDetails(status: MouseStatus): void {
  const list = document.querySelector<HTMLElement>("#logitech-detail-list");
  if (!list) return;
  const transports = Object.entries(status.transportIds ?? {})
    .map(([name, id]) => `${name}: ${id}`)
    .join(" · ") || "Not reported";
  const rates = status.supportedPollingRates?.map((rate) => `${rate >= 1000 ? `${rate / 1000}K` : rate} Hz`).join(", ") || "Not reported";
  const items = [
    ["Mode", status.deviceMode ?? "Unknown"],
    ["Active profile", status.activeProfile === null ? "None in host mode" : `Profile ${status.activeProfile}`],
    ["Model ID", status.modelId ?? "Not reported"],
    ["Unit ID", status.unitId ?? "Not reported"],
    ["Transport IDs", transports],
    ["Advertised polling", rates],
    ["DPI axes", status.supportsSeparateDpiAxes ? `X ${status.dpi} · Y ${status.dpiY ?? status.dpi}` : "Linked X/Y"],
  ];
  list.innerHTML = items.map(([label, value]) =>
    `<div style="padding:.55rem;border:1px solid #29292d;border-radius:7px;background:#141416"><small style="display:block;margin-bottom:.25rem;color:#77777c;font-size:.52rem;letter-spacing:.08em">${label.toUpperCase()}</small><span style="color:#d8d8dc;font:600 .67rem 'JetBrains Mono',monospace;overflow-wrap:anywhere">${value}</span></div>`).join("");
}

function setControlValue(selector: string, value: number | string | null | undefined): void {
  const control = document.querySelector<HTMLSelectElement>(selector);
  if (!control) return;
  control.disabled = value === null || value === undefined;
  if (control.disabled) return;
  control.value = String(value);
}

function setToggleValue(selector: string, value: boolean | null | undefined): void {
  const control = document.querySelector<HTMLButtonElement>(selector);
  if (!control) return;
  control.disabled = value === null || value === undefined;
  if (control.disabled) {
    control.textContent = "N/A";
    control.style.background = "#202023";
    control.style.borderColor = "#3a3a3f";
    control.style.color = "#66666b";
    return;
  }
  control.setAttribute("aria-checked", String(value));
  control.textContent = value ? "On" : "Off";
  control.style.background = value ? "var(--ui-accent)" : "#202023";
  control.style.borderColor = value ? "var(--ui-accent)" : "#3a3a3f";
  control.style.color = value ? "var(--ui-accent-ink)" : "#8b8b90";
}

function formatHex(value: number, width = 2): string {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

async function showPulsarExplorer(client: PulsarClient): Promise<void> {
  await client.open();
  const device = client.device;
  setText("#connection-value", "Connected");
  setText("#connection-detail", "Reading Pulsar receiver identity");
  setText("#device-title", device.productName || "Pulsar Mouse");
  setText("#device-status", "Connected");
  setText("#connection-banner", "Pulsar vendor HID connected. Reading verified settings.");
  setText("#read-status", client.describeCollections());
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.remove("is-idle"));
  document.querySelector<HTMLElement>(".control-shell")?.classList.remove("is-empty");
  const info = await client.readDeviceInfo();
  setText("#connection-value", info.connection);
  setText("#connection-detail", `CID 0x${formatHex(info.cid)} · MID 0x${formatHex(info.mid)} · Type ${info.type} · Dongle ${info.dongleType}`);
  const status = await client.readStatus();
  dpiOptions = client.getDpiOptions();
  configureDpiControl(status.dpi);
  showStatus(status);
  startAutomaticRefresh();
}

function createSupportedClient(device: HIDDevice): SupportedClient | null {
  if (EggOp1HidClient.isSupported(device)) return new EggOp1HidClient(device);
  if (PulsarProHidClient.isSupported(device)) return new PulsarProHidClient(device);
  if (PulsarHidClient.isSupported(device)) return new PulsarHidClient(device);
  if (LogitechHidppClient.isSupported(device)) return new LogitechHidppClient(device);
  return null;
}

function deviceBrand(client: SupportedClient): string {
  if (client instanceof EggOp1HidClient) return "Endgame Gear";
  if (client instanceof LogitechHidppClient) return "Logitech";
  return "Pulsar";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}

async function renderDeviceSidebar(devices?: HIDDevice[]): Promise<void> {
  const list = document.querySelector<HTMLElement>("#sidebar-device-list");
  if (!list) return;
  const supportedDevices = (devices ?? await navigator.hid?.getDevices() ?? [])
    .filter((device) => createSupportedClient(device) !== null);
  if (supportedDevices.length === 0) {
    list.innerHTML = `<div class="device-select"><span class="device-dot is-idle"></span><span><strong>No device connected</strong><small>Choose a supported device</small></span></div>`;
    return;
  }
  list.innerHTML = supportedDevices.map((device, index) => {
    const client = createSupportedClient(device)!;
    const status = deviceStatuses.get(device);
    const selected = device === activeDevice;
    const name = status?.name ?? device.productName ?? `${deviceBrand(client)} mouse`;
    const detail = status ? `${status.brand} · Connected` : `${deviceBrand(client)} · Available`;
    return `<button class="device-select${selected ? " is-selected" : ""}" type="button" data-device-index="${index}" aria-pressed="${selected}">
      <span class="device-dot${selected ? "" : " is-idle"}"></span>
      <span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></span>
    </button>`;
  }).join("");
}

async function selectAuthorizedDevice(index: number): Promise<void> {
  if (settingInProgress || refreshInProgress) return;
  const devices = (await navigator.hid?.getDevices() ?? [])
    .filter((device) => createSupportedClient(device) !== null);
  const device = devices[index];
  if (!device || device === activeDevice) return;
  const client = createSupportedClient(device);
  if (!client) return;
  setText("#device-status", "Switching");
  setText("#read-status", `Reading ${device.productName || "the selected mouse"}.`);
  try {
    await activateClient(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to switch devices.";
    setText("#device-status", "Connection failed");
    setText("#read-status", message);
  }
}

async function activateClient(client: SupportedClient): Promise<void> {
  resetDeviceSpecificPanels();
  activeClient = null;
  activePulsarClient = null;
  activeEggClient = null;
  activeDevice = client.device;
  lastRenderedStatusKey = null;
  if (client instanceof EggOp1HidClient) {
    activeEggClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (client instanceof LogitechHidppClient) {
    activeClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = await client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else {
    activePulsarClient = client;
    await showPulsarExplorer(client);
  }
  await renderDeviceSidebar();
  startAutomaticRefresh();
}

function showDisconnectedState(): void {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  activeClient = null;
  activePulsarClient = null;
  activeEggClient = null;
  activeDevice = null;
  lastRenderedStatusKey = null;
  document.querySelector<HTMLElement>(".control-shell")?.classList.add("is-empty");
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.add("is-idle"));
  setText("#device-title", "Connect a mouse");
  setText("#device-status", "No device connected");
  setText("#connection-banner", "Connect a supported device to view and change its settings.");
  setText("#read-status", "Add a supported device from the sidebar to read its current status.");
  setConnectionButtons(false, "Add device");
}

function handleHidConnect(event: HIDConnectionEvent): void {
  const client = createSupportedClient(event.device);
  if (!client) {
    void renderDeviceSidebar();
    return;
  }
  setText("#device-status", "New device detected");
  setText("#read-status", `Reading ${event.device.productName || "the connected mouse"}.`);
  void activateClient(client).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unable to read the connected mouse.";
    setText("#device-status", "Connection failed");
    setText("#read-status", message);
    void renderDeviceSidebar();
  });
}

function handleHidDisconnect(event: HIDConnectionEvent): void {
  deviceStatuses.delete(event.device);
  if (event.device !== activeDevice) {
    void renderDeviceSidebar();
    return;
  }
  showDisconnectedState();
  void (async () => {
    const devices = (await navigator.hid?.getDevices() ?? [])
      .filter((device) => device !== event.device);
    const replacement = devices
      .map(createSupportedClient)
      .find((client): client is SupportedClient => client !== null);
    if (replacement) {
      await activateClient(replacement);
    } else {
      await renderDeviceSidebar(devices);
    }
  })().catch((error: unknown) => {
    setText("#read-status", error instanceof Error ? error.message : "Unable to switch to another connected mouse.");
    void renderDeviceSidebar();
  });
}

async function requestSupportedClient(): Promise<SupportedClient | null> {
  if (!navigator.hid) throw new Error("WebHID is unavailable. Use Chrome or Edge on desktop.");
  const devices = await navigator.hid.requestDevice({
    filters: [
      { vendorId: 0x3710 },
      { vendorId: 0x3367 },
      { vendorId: 0x046d, productId: 0xc54d, usagePage: 0xff00, usage: 0x0001 },
    ],
  });
  for (const device of devices) {
    const client = createSupportedClient(device);
    if (client) return client;
  }
  return null;
}

async function connect(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("#connect-button");
  if (!button) return;
  setConnectionButtons(true, "Connecting…");
  setText("#device-status", "Requesting permission");
  setText("#read-status", "Choose your device in the browser prompt.");

  try {
    const client = await requestSupportedClient();
    if (!client) {
      setText("#device-status", "Not connected");
      setText("#read-status", "No supported device was selected.");
      return;
    }
    await activateClient(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read the mouse.";
    await activeEggClient?.close().catch(() => undefined);
    activeEggClient = null;
    setText("#device-status", "Connection failed");
    setText("#connection-banner", message);
    setText("#read-status", message);
  } finally {
    if (!activeClient && !activePulsarClient && !activeEggClient) {
      setConnectionButtons(false, "Add device");
    }
  }
}

async function reconnectAuthorizedDevice(): Promise<void> {
  if (activeClient || activePulsarClient || activeEggClient) return;
  const button = document.querySelector<HTMLButtonElement>("#connect-button");
  if (!button) return;
  setConnectionButtons(true, "Reconnecting…");

  let lastError: Error | null = null;
  try {
    // Browsers can restore WebHID authorization a fraction of a second after the
    // page is ready. Poll quickly at first so reloads do not feel stalled, then
    // keep a few wider retries for slower USB enumeration.
    const retryDelays = [0, 40, 60, 75, 100, 150, 225, 350, 500, 750];
    for (const delay of retryDelays) {
      if (delay) await waitForHidChange(delay);
      const devices = await navigator.hid?.getDevices() ?? [];
      const clients = devices.map(createSupportedClient).filter((candidate): candidate is SupportedClient => candidate !== null);
      await renderDeviceSidebar(devices);
      for (const client of clients) {
        try {
          setText("#device-status", "Reconnecting");
          setText("#read-status", "Reading the previously authorized device.");
          await activateClient(client);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Unable to reconnect to the mouse.");
          await client.close().catch(() => undefined);
        }
      }
    }
    setText("#device-status", "Not connected");
    if (lastError) setText("#connection-banner", lastError.message);
    setText("#read-status", "Use Add device if the mouse does not reconnect automatically.");
  } finally {
    if (!activeClient && !activePulsarClient && !activeEggClient) {
      setConnectionButtons(false, "Add device");
    }
  }
}

function setConnectionButtons(disabled: boolean, label: string): void {
  document.querySelectorAll<HTMLButtonElement>("#connect-button, #empty-connect-button").forEach((button) => {
    button.disabled = disabled;
    button.textContent = label;
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function waitForHidChange(milliseconds: number): Promise<void> {
  const hid = navigator.hid;
  if (!hid) return wait(milliseconds);
  return new Promise((resolve) => {
    const finish = (): void => {
      window.clearTimeout(timer);
      hid.removeEventListener("connect", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, milliseconds);
    hid.addEventListener("connect", finish, { once: true });
  });
}

function configureDpiControl(currentDpi: number): void {
  const presets = document.querySelector<HTMLElement>("#dpi-presets");
  const custom = document.querySelector<HTMLButtonElement>("#custom-dpi");
  if (!presets || !custom || dpiOptions.length === 0) return;
  const common = [400, 800, 1600, 3200, 6400, 8000].filter((dpi) => dpiOptions.includes(dpi));
  const values = common.includes(currentDpi) ? common : [...common, currentDpi].sort((a, b) => a - b);
  presets.innerHTML = values.map((dpi) => `<button type="button" data-dpi="${dpi}" class="${dpi === currentDpi ? "selected" : ""}">${dpi.toLocaleString()}</button>`).join("");
  presets.querySelectorAll<HTMLButtonElement>("[data-dpi]").forEach((button) => {
    button.addEventListener("click", () => void applyDpiValue(Number(button.dataset.dpi)));
  });
  custom.disabled = false;
}

async function chooseCustomDpi(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#dpi-output");
  const button = document.querySelector<HTMLButtonElement>("#custom-dpi");
  if (!input || !button) return;
  if (input.readOnly) {
    input.dataset.previousValue = input.value;
    input.readOnly = false;
    input.value = input.value.replace(/[^\d]/g, "");
    button.textContent = "Apply";
    input.focus();
    input.select();
    return;
  }
  const dpi = Number(input.value.replace(/[^\d]/g, ""));
  if (!Number.isInteger(dpi) || !dpiOptions.includes(dpi)) {
    setText("#read-status", "That DPI value is not supported by this mouse.");
    input.focus();
    input.select();
    return;
  }
  if (await applyDpiValue(dpi)) finishCustomDpiEditing(dpi);
}

function finishCustomDpiEditing(dpi?: number): void {
  const input = document.querySelector<HTMLInputElement>("#dpi-output");
  const button = document.querySelector<HTMLButtonElement>("#custom-dpi");
  if (!input || !button) return;
  const fallback = Number((input.dataset.previousValue ?? input.value).replace(/[^\d]/g, "")) || dpiOptions[0] || 800;
  input.readOnly = true;
  input.value = `${(dpi ?? fallback).toLocaleString()} DPI`;
  delete input.dataset.previousValue;
  button.textContent = "Custom";
}

async function applyDpiValue(dpi: number): Promise<boolean> {
  const client = activeClient ?? activePulsarClient ?? activeEggClient;
  if (!client || !dpiOptions.includes(dpi) || refreshInProgress || settingInProgress) return false;
  settingInProgress = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-dpi], #custom-dpi");
  buttons.forEach((button) => { button.disabled = true; });
  setText("#read-status", `Setting ${dpi.toLocaleString()} DPI…`);
  try {
    await client.setDpi(dpi);
    showStatus(await client.readStatus());
    setText("#dpi-pending", `Confirmed at ${dpi.toLocaleString()} DPI`);
    return true;
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to set DPI.");
    return false;
  } finally {
    settingInProgress = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function applyLogitechAxisDpi(): Promise<void> {
  if (!activeClient || refreshInProgress || settingInProgress) return;
  const dpiX = Number(document.querySelector<HTMLInputElement>("#logitech-dpi-x")?.value);
  const dpiY = Number(document.querySelector<HTMLInputElement>("#logitech-dpi-y")?.value);
  if (!dpiOptions.includes(dpiX) || !dpiOptions.includes(dpiY)) {
    setText("#read-status", "Both axis values must be advertised DPI values.");
    return;
  }
  settingInProgress = true;
  setText("#read-status", `Setting X ${dpiX.toLocaleString()} · Y ${dpiY.toLocaleString()} DPI…`);
  try {
    await activeClient.setDpi(dpiX, dpiY);
    showStatus(await activeClient.readStatus());
    setText("#dpi-pending", `Confirmed X ${dpiX.toLocaleString()} · Y ${dpiY.toLocaleString()} DPI`);
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to set axis DPI.");
  } finally {
    settingInProgress = false;
  }
}

async function applyPollingRate(rate: number): Promise<void> {
  const client = activeClient ?? activePulsarClient ?? activeEggClient;
  if (!client || refreshInProgress || settingInProgress) return;
  settingInProgress = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-rate]");
  buttons.forEach((button) => {
    button.disabled = true;
  });
  setText("#read-status", `Setting ${rate.toLocaleString()} Hz…`);
  try {
    await client.setPollingRate(rate);
    showStatus(await client.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to set polling rate.");
  } finally {
    settingInProgress = false;
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

async function applyLiftOffDistance(lod: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> {
  const client = activeClient ?? activePulsarClient ?? activeEggClient;
  if (!client || refreshInProgress || settingInProgress) return;
  settingInProgress = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-lod]");
  buttons.forEach((button) => { button.disabled = true; });
  setText("#read-status", `Setting ${lod.toLowerCase()} lift-off distance…`);
  try {
    await client.setLiftOffDistance(lod);
    showStatus(await client.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to set lift-off distance.");
  } finally {
    settingInProgress = false;
    buttons.forEach((button) => {
      button.disabled = activeClient !== null && button.dataset.lod === "Low";
    });
  }
}

async function toggleDongleLed(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("#dongle-led-toggle");
  if (!button || !activePulsarClient || settingInProgress) return;
  const enabled = button.dataset.enabled !== "true";
  settingInProgress = true;
  button.disabled = true;
  setText("#read-status", `${enabled ? "Enabling" : "Disabling"} the receiver LED…`);
  try {
    await activePulsarClient.setDongleLed(enabled);
    showStatus(await activePulsarClient.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to change the receiver LED.");
  } finally {
    settingInProgress = false;
    button.disabled = false;
  }
}

type PulsarToggleSetting = "motionSync" | "angleSnapping" | "rippleControl" | "performanceMode";

async function applyPulsarToggle(setting: PulsarToggleSetting, enabled: boolean): Promise<void> {
  const client = activePulsarClient ?? activeEggClient;
  if (!client || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `${enabled ? "Enabling" : "Disabling"} ${settingLabel(setting)}…`);
  try {
    if (setting === "motionSync") await client.setMotionSync(enabled);
    if (setting === "angleSnapping") await client.setAngleSnapping(enabled);
    if (setting === "rippleControl") await client.setRippleControl(enabled);
    if (setting === "performanceMode" && client instanceof EggOp1HidClient) throw new Error("Performance mode is not exposed by the OP1 8K protocol.");
    if (setting === "performanceMode" && !(client instanceof EggOp1HidClient)) await client.setPerformanceMode(enabled);
    showStatus(await client.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to change the Pulsar setting.");
    const status = await client.readStatus().catch(() => null);
    if (status) showStatus(status);
  } finally {
    settingInProgress = false;
  }
}

function settingLabel(setting: PulsarToggleSetting): string {
  return ({
    motionSync: "Motion Sync",
    angleSnapping: "angle snapping",
    rippleControl: "ripple control",
    performanceMode: "performance mode",
  } as const)[setting];
}

async function applyEggFilter(setting: "slamclick" | "motionJitter", enabled: boolean): Promise<void> {
  if (!activeEggClient || settingInProgress) return;
  settingInProgress = true;
  const label = setting === "slamclick" ? "slamclick filter" : "motion-jitter filter";
  setText("#read-status", `${enabled ? "Enabling" : "Disabling"} ${label}…`);
  try {
    if (setting === "slamclick") await activeEggClient.setSlamclickFilter(enabled);
    else await activeEggClient.setMotionJitterFilter(enabled);
    showStatus(await activeEggClient.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : `Unable to change the ${label}.`);
    const status = await activeEggClient.readStatus().catch(() => null);
    if (status) showStatus(status);
  } finally {
    settingInProgress = false;
  }
}

async function applyEggSpdtMode(button: "left" | "right", mode: EggSpdtMode): Promise<void> {
  if (!activeEggClient || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `Setting the ${button} button to ${mode}…`);
  try {
    await activeEggClient.setSpdtMode(button, mode);
    showStatus(await activeEggClient.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : `Unable to change the ${button} button GX mode.`);
    const status = await activeEggClient.readStatus().catch(() => null);
    if (status) showStatus(status);
  } finally {
    settingInProgress = false;
  }
}

function updateCustomPollingPreview(): void {
  const divider = Number(document.querySelector<HTMLInputElement>("#egg-polling-divider")?.value);
  setText("#egg-polling-result", Number.isInteger(divider) && divider > 0 && divider <= 255
    ? `Result: ${(8000 / divider).toLocaleString(undefined, { maximumFractionDigits: 2 })} Hz`
    : "Enter a divider from 1 to 255.");
}

function renderEggCpiStages(status: MouseStatus): void {
  const container = document.querySelector<HTMLElement>("#egg-cpi-stage-list");
  const stages = status.eggCpiStages;
  const levels = status.eggCpiLevels ?? 0;
  if (!container || !stages) return;
  container.innerHTML = stages.slice(0, levels).map((stage, index) => {
    const split = stage.x !== stage.y;
    return `<div style="padding:.55rem;border:1px solid #303034;border-radius:6px">
      <strong style="font-size:.7rem">Stage ${index + 1}</strong>
      <label style="display:flex;align-items:center;gap:.35rem;margin:.4rem 0;color:#8b8b90;font-size:.62rem"><input data-cpi-split="${index}" type="checkbox" ${split ? "checked" : ""} /> Separate X/Y</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.35rem">
        <label style="color:#77777c;font-size:.58rem">X<input data-cpi-x="${index}" type="number" min="50" max="26000" step="50" value="${stage.x}" style="width:100%;box-sizing:border-box;margin-top:.15rem;padding:.35rem;background:#171719;color:#eee;border:1px solid #343438;border-radius:5px" /></label>
        <label style="color:#77777c;font-size:.58rem">Y<input data-cpi-y="${index}" type="number" min="50" max="26000" step="50" value="${stage.y}" ${split ? "" : "disabled"} style="width:100%;box-sizing:border-box;margin-top:.15rem;padding:.35rem;background:#171719;color:#eee;border:1px solid #343438;border-radius:5px" /></label>
      </div>
      <button data-apply-cpi="${index}" type="button" style="margin-top:.4rem;padding:.3rem .5rem">Apply stage</button>
    </div>`;
  }).join("");
  container.querySelectorAll<HTMLInputElement>("[data-cpi-split]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const index = checkbox.dataset.cpiSplit;
      const y = container.querySelector<HTMLInputElement>(`[data-cpi-y="${index}"]`);
      if (y) y.disabled = !checkbox.checked;
    });
  });
  container.querySelectorAll<HTMLButtonElement>("[data-apply-cpi]").forEach((button) => {
    button.addEventListener("click", () => {
      const level = Number(button.dataset.applyCpi);
      const x = Number(container.querySelector<HTMLInputElement>(`[data-cpi-x="${level}"]`)?.value);
      const split = container.querySelector<HTMLInputElement>(`[data-cpi-split="${level}"]`)?.checked === true;
      const y = split ? Number(container.querySelector<HTMLInputElement>(`[data-cpi-y="${level}"]`)?.value) : x;
      void applyEggCpiStage(level, x, y);
    });
  });
}

function renderEggButtons(status: MouseStatus): void {
  const container = document.querySelector<HTMLElement>("#egg-button-list");
  const filters = status.eggMulticlickFilters;
  const mappings = status.eggButtonMappings;
  if (!container || !filters || !mappings) return;
  container.innerHTML = EGG_BUTTON_NAMES.map((name, index) => {
    const gxActive = index === 0 ? status.leftSpdtMode !== "Off" : index === 1 ? status.rightSpdtMode !== "Off" : false;
    const mappingOptions = EGG_BUTTON_MAPPINGS.map((mapping) =>
      `<option ${mappings[index] === mapping ? "selected" : ""}>${mapping}</option>`).join("");
    const unsupported = EGG_BUTTON_MAPPINGS.includes(mappings[index] as EggButtonMapping)
      ? "" : `<option selected disabled>${mappings[index]}</option>`;
    return `<div style="padding:.55rem;border:1px solid #303034;border-radius:6px">
      <strong style="font-size:.7rem">${name}</strong>
      <label style="display:block;margin-top:.35rem;color:#77777c;font-size:.58rem">Multiclick filter
        <input data-multiclick="${index}" type="number" min="0" max="25" step="1" value="${filters[index]}" ${gxActive ? "disabled" : ""} style="width:100%;box-sizing:border-box;margin-top:.15rem;padding:.35rem;background:#171719;color:#eee;border:1px solid #343438;border-radius:5px" />
      </label>
      <label style="display:block;margin-top:.35rem;color:#77777c;font-size:.58rem">Mapping
        <select data-button-mapping="${index}" style="width:100%;margin-top:.15rem;padding:.35rem;background:#171719;color:#eee;border:1px solid #343438;border-radius:5px">${unsupported}${mappingOptions}</select>
      </label>
    </div>`;
  }).join("");
  container.querySelectorAll<HTMLInputElement>("[data-multiclick]").forEach((input) => {
    input.addEventListener("change", () => void applyEggMulticlick(Number(input.dataset.multiclick) as EggButtonIndex, Number(input.value)));
  });
  container.querySelectorAll<HTMLSelectElement>("[data-button-mapping]").forEach((select) => {
    select.addEventListener("change", () => void applyEggButtonMapping(Number(select.dataset.buttonMapping) as EggButtonIndex, select.value as EggButtonMapping));
  });
}

async function applyEggCpiLevels(levels: number): Promise<void> {
  await applyEggChange("CPI stage count", async (client) => client.setCpiLevels(levels));
}

async function applyEggCpiStage(level: number, x: number, y: number): Promise<void> {
  await applyEggChange(`CPI stage ${level + 1}`, async (client) => client.setCpiStage(level, x, y));
}

async function applyEggPollingDivider(divider: number): Promise<void> {
  await applyEggChange("custom polling divider", async (client) => client.setCustomPollingDivider(divider));
}

async function applyEggMulticlick(button: EggButtonIndex, value: number): Promise<void> {
  await applyEggChange(`${EGG_BUTTON_NAMES[button]} multiclick filter`, async (client) => client.setMulticlickFilter(button, value));
}

async function applyEggButtonMapping(button: EggButtonIndex, mapping: EggButtonMapping): Promise<void> {
  await applyEggChange(`${EGG_BUTTON_NAMES[button]} mapping`, async (client) => client.setButtonMapping(button, mapping));
}

async function applyEggChange(label: string, change: (client: EggOp1HidClient) => Promise<void>): Promise<void> {
  if (!activeEggClient || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `Changing ${label}…`);
  try {
    await change(activeEggClient);
    showStatus(await activeEggClient.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : `Unable to change ${label}.`);
    const status = await activeEggClient.readStatus().catch(() => null);
    if (status) showStatus(status);
  } finally {
    settingInProgress = false;
  }
}

async function applyPulsarValue(setting: "debounce" | "sleep", value: number): Promise<void> {
  if (!activePulsarClient || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `Setting ${setting === "debounce" ? `${value} ms debounce` : "auto sleep"}…`);
  try {
    if (setting === "debounce") await activePulsarClient.setDebounceTime(value);
    else await activePulsarClient.setSleepTimeout(value);
    showStatus(await activePulsarClient.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to change the Pulsar setting.");
  } finally {
    settingInProgress = false;
  }
}

async function applyProSetting(setting: "wheelAcceleration" | "angleTuning" | "profile", value: boolean | number): Promise<void> {
  if (!(activePulsarClient instanceof PulsarProHidClient) || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `Changing ${setting === "wheelAcceleration" ? "wheel acceleration" : setting === "angleTuning" ? "angle tuning" : "onboard profile"}…`);
  try {
    if (setting === "wheelAcceleration") await activePulsarClient.setWheelAcceleration(Boolean(value));
    if (setting === "angleTuning") await activePulsarClient.setAngleTuning(Number(value));
    if (setting === "profile") await activePulsarClient.setProfile(Number(value));
    showStatus(await activePulsarClient.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to change the Pulsar Pro setting.");
  } finally {
    settingInProgress = false;
  }
}

function startAutomaticRefresh(): void {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    void refreshStatus();
  }, 5000);
}

async function refreshStatus(): Promise<void> {
  const client = activeClient ?? activePulsarClient ?? activeEggClient;
  if (!client || refreshInProgress || settingInProgress) return;
  refreshInProgress = true;
  try {
    const status = await client.readStatus();
    const currentClient = activeClient ?? activePulsarClient ?? activeEggClient;
    if (client !== currentClient || client.device !== activeDevice) return;
    if (JSON.stringify(status) !== lastRenderedStatusKey) showStatus(status);
  } catch (error) {
    lastRenderedStatusKey = null;
    const message = error instanceof Error ? error.message : "Unable to refresh the mouse status.";
    setText("#device-status", "Waiting to refresh");
    setText("#read-status", message);
  } finally {
    refreshInProgress = false;
  }
}

window.addEventListener("beforeunload", () => {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  navigator.hid?.removeEventListener("connect", handleHidConnect);
  navigator.hid?.removeEventListener("disconnect", handleHidDisconnect);
  void activeClient?.close();
  void activePulsarClient?.close();
  void activeEggClient?.close();
});

if (sessionStorage.getItem(ACCESS_KEY) === "granted") {
  renderControl();
} else {
  renderGate();
}
