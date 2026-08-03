import "./control.css";
import {
  EGG_BUTTON_ACTION_OPTIONS,
  EGG_BUTTON_NAMES,
  EggOp1HidClient,
  type EggButtonIndex,
  type EggSpdtMode,
} from "./egg-op1-hid";
import {
  EGG_WE_DISPLAY_NAME,
  eggWeAuthorizedPool,
  eggWeCreate,
  eggWeFromAuthorized,
  eggWeIsSupported,
  eggWeMergeLogicalDevices,
  eggWeOwnsDevice,
  eggWePrepare,
  eggWeResolveConnect,
  eggWeSupportScore,
  isEggWeClient,
  type EggWeHidClient,
} from "./egg-we-control";
import { LogitechHidppClient } from "./logitech-hidpp";
import type { MouseStatus } from "./mouse-types";
import type { EggButtonAction, EggButtonActionKey, EggOp1Status } from "./egg-op1-protocol";
import { PulsarHidClient } from "./pulsar-hid";
import { PulsarProHidClient } from "./pulsar-pro-hid";
import { isLamzuVendor, SUPPORTED_HID_FILTERS } from "./vendors";
import { LamzuHidClient } from "./lamzu-hid";
import { WLMouseHidClient } from "./wlmouse-hid";

const controlApp = document.querySelector<HTMLDivElement>("#control-app");

if (!controlApp) {
  throw new Error("OpenMouse could not find the control application root.");
}

const appRoot = controlApp;

const BATTERY_HISTORY_KEY = "openmouse-battery-history-v1";
const BATTERY_CHECKPOINT_MS = 5 * 60 * 1000;
const BATTERY_MAX_SAMPLE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const BATTERY_MAX_CONTINUOUS_GAP_MS = 10 * 60 * 1000;
const BATTERY_MIN_ESTIMATE_SPAN_MS = 10 * 60 * 1000;
const BATTERY_MAX_SAMPLES_PER_DEVICE = 500;
const INTERFACE_SETTINGS_KEY = "openmouse-interface-settings-v1";
const BUILD_LABEL = `${__BUILD_CHANNEL__.toUpperCase()} · v${__APP_VERSION__}`;
let activeClient: LogitechHidppClient | null = null;
let activePulsarClient: PulsarClient | null = null;
let activeEggClient: EggOp1HidClient | null = null;
let activeEggWeClient: EggWeHidClient | null = null;
let activeWLMouseClient: WLMouseHidClient | null = null;
let activeLamzuClient: LamzuHidClient | null = null;
let refreshTimer: number | null = null;
let refreshInProgress = false;
let dpiOptions: number[] = [];
let settingInProgress = false;
let lastRenderedStatusKey: string | null = null;
let activeDevice: HIDDevice | null = null;
const deviceStatuses = new Map<HIDDevice, MouseStatus>();
/** Prevents overlapping reconnect loops from leaving the UI stuck on "Reconnecting…". */
let reconnectInFlight = false;

type PulsarClient = PulsarHidClient | PulsarProHidClient;
type SupportedClient = LogitechHidppClient | PulsarClient | EggOp1HidClient | EggWeHidClient | WLMouseHidClient | LamzuHidClient;

function activeSettingsClient(): SupportedClient | null {
  return activeClient ?? activePulsarClient ?? activeEggClient ?? activeEggWeClient ?? activeWLMouseClient ?? activeLamzuClient;
}

function hasActiveClient(): boolean {
  return activeSettingsClient() !== null;
}

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
  if (experimental && activeEggClient && !activeEggWeClient) {
    experimental.style.display = interfacePreferences.showExperimental ? "block" : "none";
  }
}

function renderControl(): void {
  appRoot.innerHTML = `
    <style>
      .control-shell { --ui-accent:#69d28d;--ui-accent-ink:#07120b;--ui-accent-soft:rgb(105 210 141 / 16%) }
      .build-identity { display:flex;align-items:center;gap:.65rem;margin-bottom:4rem }
      .build-identity .demo-wordmark { margin-bottom:0 }
      .build-badge { display:inline-flex;align-items:center;min-height:1.35rem;padding:.2rem .45rem;border:1px solid color-mix(in srgb,var(--ui-accent) 35%,transparent);border-radius:999px;background:var(--ui-accent-soft);color:var(--ui-accent);font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.52rem;font-weight:700;letter-spacing:.07em;line-height:1;white-space:nowrap }
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
      .density-comfortable .device-overview.is-hero { min-height:340px }
      .density-comfortable .device-overview.is-hero .summary-stat { padding:1.45rem 1.5rem !important }
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
        <div class="build-identity">
          <a class="demo-wordmark" href="/">OpenMouse</a>
          <span class="build-badge" title="OpenMouse ${BUILD_LABEL}">${BUILD_LABEL}</span>
        </div>
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
          <div class="mouse-stage" id="overview-mouse-stage" hidden>
            <img class="mouse-image" id="overview-mouse-image" src="/maya-x-top.png?v=4" alt="Top view of a Lamzu Maya X gaming mouse" />
            <span class="model-caption" id="overview-model-caption">MAYA X</span>
          </div>
          <div class="quick-stats">
            <article id="battery-summary" class="summary-stat"><span>BATTERY</span><strong id="battery-value">—</strong><small id="battery-detail">Read after connection</small><div class="meter"><i id="battery-meter" style="width:0%"></i></div></article>
            <article class="summary-stat"><span>FIRMWARE</span><strong id="firmware-value">—</strong><small id="firmware-detail">Read after connection</small></article>
            <article class="summary-stat"><span>CONNECTION</span><strong id="connection-value">—</strong><small id="connection-detail">2.4 GHz receiver</small><button id="dongle-led-toggle" type="button" style="align-self:flex-start;margin-top:.45rem;padding:.28rem .5rem;border:1px solid #3a3a3f;border-radius:5px;background:#19191c;color:#d8d8dc;font-size:.61rem;font-weight:600" hidden disabled>Receiver LED</button></article>
          </div>
        </section>
        <section class="settings-grid device-data" aria-label="Mouse status">
          <article class="setting-card dpi-card"><div class="setting-heading"><div><p>DPI</p><h2>Sensitivity</h2></div><div class="dpi-header-actions"><input id="dpi-output" type="text" inputmode="numeric" value="— DPI" aria-label="DPI value" readonly /><button id="custom-dpi" type="button" disabled>Custom</button></div></div><div id="dpi-presets" class="segmented dpi-presets" aria-label="Common DPI values"></div><div id="logitech-axis-controls" style="display:none;margin-top:.6rem;padding-top:.6rem;border-top:1px solid #29292d"><div style="display:grid;grid-template-columns:1fr 1fr auto;gap:.45rem;align-items:end"><label style="color:#77777c;font-size:.6rem">X axis<input id="logitech-dpi-x" type="number" min="100" step="50" style="width:100%;box-sizing:border-box;margin-top:.2rem;padding:.42rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee" /></label><label style="color:#77777c;font-size:.6rem">Y axis<input id="logitech-dpi-y" type="number" min="100" step="50" style="width:100%;box-sizing:border-box;margin-top:.2rem;padding:.42rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee" /></label><button id="apply-logitech-axes" type="button" style="padding:.45rem .6rem;border:1px solid #45454a;border-radius:6px;background:#202023;color:#ececef;font-size:.62rem">Apply</button></div></div><div class="setting-action"><span id="dpi-pending">Choose a DPI value</span></div></article>
          <article class="setting-card"><div class="setting-heading"><div><p>POLLING RATE</p><h2>Report frequency</h2></div></div><div class="segmented rate-options"><button data-rate="125" disabled>125</button><button data-rate="250" disabled>250</button><button data-rate="500" disabled>500</button><button data-rate="1000" disabled>1K</button><button data-rate="2000" disabled>2K</button><button data-rate="4000" disabled>4K</button><button data-rate="8000" disabled>8K</button></div><small id="polling-note" class="setting-note">Higher rates update cursor movement more often, but use more battery.</small></article>
          <article class="setting-card"><div class="setting-heading"><div><p>SENSOR</p><h2>Lift-off distance</h2></div></div><div id="generic-lod-options" class="segmented three"><button data-lod="Low" disabled>0.7 mm</button><button data-lod="Medium" disabled>1 mm</button><button data-lod="High" disabled>2 mm</button></div><select id="egg-lod-select" hidden style="width:100%;padding:.48rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"></select><small class="setting-note">Controls how far you can lift the mouse before tracking stops. Higher values keep tracking a little longer.</small></article>
        </section>
        <section id="logitech-device-details" class="device-data" style="display:none;margin-top:.65rem">
          <details class="egg-collapsible"><summary><span><small>LOGITECH HID++</small>Device details</span><i aria-hidden="true"></i></summary><div class="egg-collapsible-body"><article class="setting-card" style="min-height:0"><div id="logitech-detail-list" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.55rem"></div></article></div></details>
        </section>
        <section id="pulsar-advanced" class="device-data" aria-label="Advanced Pulsar settings" style="display:none;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:.65rem;margin-top:.65rem;padding-bottom:.4rem">
          <article id="signal-settings" class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>WIRELESS</p><h2>Signal strength</h2></div><output id="signal-output">—</output></div><small id="signal-detail" class="setting-note">Receiver signal is unavailable.</small></article>
          <article id="debounce-settings" class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>CLICK</p><h2>Debounce</h2></div><button class="info has-tooltip" type="button" aria-label="About debounce" data-tooltip="How long the mouse waits after a click before it can register another. Lower is snappier; higher helps prevent accidental double-clicks.">?</button></div><select id="debounce-select" style="width:100%;padding:.48rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"></select><small class="setting-note">Lower is faster response. Raise it if you get unintended double-clicks.</small></article>
          <article id="sleep-settings" class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>POWER</p><h2>Auto sleep</h2></div><div style="display:flex;align-items:center;gap:.45rem"><button class="info has-tooltip" type="button" aria-label="About auto sleep" data-tooltip="How long the mouse stays idle before it sleeps to save battery. Shorter saves power; longer keeps it ready to wake instantly.">?</button><button id="sleep-toggle" type="button" role="switch" aria-checked="false" hidden style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div></div><select id="sleep-select" style="width:100%;padding:.48rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"><option value="1">10 seconds</option><option value="3">30 seconds</option><option value="6">1 minute</option><option value="12">2 minutes</option><option value="30">5 minutes</option><option value="60">10 minutes</option><option value="180">30 minutes</option></select><small class="setting-note">Shorter timeouts save battery. Longer keeps the mouse awake longer when idle.</small></article>
          <article id="processing-settings" class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>SENSOR</p><h2>Processing</h2></div></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Motion Sync</span><button id="motion-sync-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Angle snapping</span><button id="angle-snapping-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Ripple control</span><button id="ripple-control-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div id="performance-mode-setting" style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Performance mode</span><button id="performance-mode-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div id="lamzu-angle-tune-row" hidden style="display:none;margin-top:.55rem;padding-top:.55rem;border-top:1px solid #29292d"><div class="angle-tune-panel"><div class="angle-tune-visual" aria-hidden="true"><div class="angle-tune-ring"><span class="angle-tune-axis"></span><img id="lamzu-angle-tune-indicator" class="angle-tune-mouse" src="/maya-x-angle.svg?v=2" alt="" /></div></div><label class="angle-tune-controls" for="lamzu-angle-tune"><span class="angle-tune-label">Angle tune<strong id="lamzu-angle-tune-value">0°</strong></span><input id="lamzu-angle-tune" type="range" min="-30" max="30" step="1" value="0" /><span class="range-labels"><span>−30°</span><span>0°</span><span>+30°</span></span><small class="setting-note">Rotates the sensor coordinate plane to match how you hold the mouse.</small></label></div></div></article>
          <article id="egg-filter-settings" class="setting-card" style="display:none;min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>SENSOR</p><h2>Filters</h2></div></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Slamclick filter</span><button id="slamclick-filter-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Motion-jitter filter</span><button id="motion-jitter-filter-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div></article>
          <article id="egg-sensor-tuning" class="setting-card" style="display:none;min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>PAW3950</p><h2>Sensor tuning</h2></div></div><div id="egg-glass-row" style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Glass Mode</span><button id="egg-glass-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div id="egg-v2-sensor-controls"><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Force max Sensor FPS</span><button id="egg-max-fps-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Disable LED on lift-off</span><button id="egg-led-lift-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><label style="display:block;margin-top:.35rem;color:#77777c;font-size:.62rem">Sensor angle tuning<input id="egg-angle-tuning" type="number" min="-127" max="127" step="1" style="width:100%;box-sizing:border-box;margin-top:.2rem;padding:.4rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee" /></label></div></article>
          <article id="egg-spdt-settings" class="setting-card" style="display:none;min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>CLICK</p><h2>GX switch mode</h2></div></div><label style="display:block;color:#77777c;font-size:.62rem">Left button<select id="left-spdt-select" style="width:100%;margin-top:.2rem;padding:.4rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"><option>Off</option><option>GX Safe</option><option>GX Speed</option></select></label><label style="display:block;margin-top:.45rem;color:#77777c;font-size:.62rem">Right button<select id="right-spdt-select" style="width:100%;margin-top:.2rem;padding:.4rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"><option>Off</option><option>GX Safe</option><option>GX Speed</option></select></label></article>
          <article id="egg-device-actions" class="setting-card" style="display:none;min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>DEVICE</p><h2>Onboard settings</h2></div></div><button id="egg-reload" class="egg-action-button" type="button">Reload from mouse</button><button id="egg-factory-reset" class="egg-action-button" type="button" style="border-color:#6a373a;color:#e7a7aa">Factory reset</button></article>
          <details id="egg-polling-settings" class="egg-experimental" style="display:none;grid-column:1/-1"><summary><span><small>EXPERIMENTAL</small>Experimental settings</span><i aria-hidden="true"></i></summary><div class="egg-experimental-body"><article class="setting-card egg-form-card"><div class="setting-heading"><div><p>POLLING</p><h2>Custom divider</h2></div></div><p class="egg-warning">Nonstandard polling dividers may behave differently across firmware versions.</p><label>8K divider<input id="egg-polling-divider" type="number" min="1" max="255" step="1" /></label><small id="egg-polling-result" class="setting-note">—</small><button id="apply-egg-polling" class="egg-action-button" type="button">Apply divider</button></article></div></details>
          <details id="egg-cpi-settings" class="egg-collapsible" style="display:none;grid-column:1/-1"><summary><span><small>SENSOR</small>CPI stages</span><i aria-hidden="true"></i></summary><div class="egg-collapsible-body"><article class="setting-card"><label style="display:block;max-width:160px;color:#77777c;font-size:.62rem">Enabled stages<select id="egg-cpi-levels"><option value="1">1 stage</option><option value="2">2 stages</option><option value="3">3 stages</option><option value="4">4 stages</option></select></label><div id="egg-cpi-stage-list" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.5rem;margin-top:.55rem"></div></article></div></details>
          <details id="egg-button-settings" class="egg-collapsible" style="display:none;grid-column:1/-1"><summary><span><small>BUTTONS</small>Multiclick and mapping</span><i aria-hidden="true"></i></summary><div class="egg-collapsible-body"><article class="setting-card"><label style="display:flex;align-items:center;gap:.4rem;margin:0 0 .65rem;color:#b3b3b7;font-size:.68rem"><input id="egg-left-handed" type="checkbox" /> Left-handed mode</label><div id="egg-button-list" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:.5rem"></div></article></div></details>
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
  for (let debounce = 0; debounce <= 20; debounce += 1) {
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
  document.querySelector<HTMLInputElement>("#lamzu-angle-tune")?.addEventListener("input", (event) => {
    updateLamzuAngleTuneUi(Number((event.target as HTMLInputElement).value));
  });
  document.querySelector<HTMLInputElement>("#lamzu-angle-tune")?.addEventListener("change", (event) => {
    void applyLamzuAngleTune(Number((event.target as HTMLInputElement).value));
  });
  document.querySelector<HTMLButtonElement>("#sleep-toggle")?.addEventListener("click", (event) => {
    const enabled = (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true";
    void applyPulsarValue("sleep", enabled ? lastSleepSeconds : WLMOUSE_SLEEP_NEVER);
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
  const eggSensorToggles = [
    ["#egg-glass-toggle", "glass"],
    ["#egg-max-fps-toggle", "maxFps"],
    ["#egg-led-lift-toggle", "ledLift"],
  ] as const;
  for (const [selector, setting] of eggSensorToggles) {
    document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", (event) => {
      void applyEggSensorToggle(setting, (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true");
    });
  }
  document.querySelector<HTMLInputElement>("#egg-angle-tuning")?.addEventListener("change", (event) => {
    void applyEggAngleTuning(Number((event.target as HTMLInputElement).value));
  });
  document.querySelector<HTMLButtonElement>("#egg-reload")?.addEventListener("click", () => { void refreshStatus(); });
  document.querySelector<HTMLButtonElement>("#egg-factory-reset")?.addEventListener("click", () => { void applyEggFactoryReset(); });
  document.querySelector<HTMLSelectElement>("#left-spdt-select")?.addEventListener("change", (event) => {
    void applyEggSpdtMode("left", (event.target as HTMLSelectElement).value as EggSpdtMode);
  });
  document.querySelector<HTMLSelectElement>("#right-spdt-select")?.addEventListener("change", (event) => {
    void applyEggSpdtMode("right", (event.target as HTMLSelectElement).value as EggSpdtMode);
  });
  document.querySelector<HTMLSelectElement>("#egg-cpi-levels")?.addEventListener("change", (event) => {
    void applyEggCpiLevels(Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLSelectElement>("#egg-lod-select")?.addEventListener("change", (event) => {
    void applyEggLodIndex(Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLInputElement>("#egg-left-handed")?.addEventListener("change", (event) => {
    void applyEggLeftHanded((event.target as HTMLInputElement).checked);
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

const WLMOUSE_SLEEP_NEVER = 0xffff;
const PULSAR_SLEEP_OPTIONS: ReadonlyArray<readonly [number, string]> = [
  [1, "10 seconds"], [3, "30 seconds"], [6, "1 minute"], [12, "2 minutes"],
  [30, "5 minutes"], [60, "10 minutes"], [180, "30 minutes"],
];
const LAMZU_AURORA_SLEEP_OPTIONS: ReadonlyArray<readonly [number, string]> = [
  [10, "10 seconds"], [30, "30 seconds"], [60, "1 minute"],
  [300, "5 minutes"], [600, "10 minutes"], [1800, "30 minutes"],
];
const WLMOUSE_SLEEP_OPTIONS: ReadonlyArray<readonly [number, string]> = [
  [30, "30 seconds"], [60, "1 minute"], [120, "2 minutes"], [300, "5 minutes"],
  [600, "10 minutes"], [1800, "30 minutes"],
];
const WLMOUSE_SLEEP_DEFAULT = 60;
let lastSleepSeconds = WLMOUSE_SLEEP_DEFAULT;

function fillSleepOptions(options: ReadonlyArray<readonly [number, string]>): void {
  const select = document.querySelector<HTMLSelectElement>("#sleep-select");
  if (!select || select.dataset.options === String(options[0][0])) return;
  select.replaceChildren(...options.map(([value, label]) => new Option(label, String(value))));
  select.dataset.options = String(options[0][0]);
}

function resetDeviceSpecificPanels(): void {
  for (const selector of [
    "#egg-filter-settings",
    "#egg-spdt-settings",
    "#egg-polling-settings",
    "#egg-cpi-settings",
    "#egg-button-settings",
    "#egg-sensor-tuning",
    "#egg-device-actions",
    "#pulsar-pro-settings",
    "#lamzu-angle-tune-row",
  ]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.style.display = "none";
  }
  document.querySelector<HTMLElement>("#pulsar-advanced")?.classList.remove("egg-advanced-layout");
}

function showStatus(status: MouseStatus): void {
  lastRenderedStatusKey = JSON.stringify(status);
  // Driver UI hints (e.g. status.ui.family === "egg-we") avoid brand-specific imports.
  const ui = status.ui;
  const isEgg8k = activeEggClient !== null
    || (status.brand === "Endgame Gear" && Array.isArray(status.eggCpiStages));
  const eggStatus = isEgg8k ? status as EggOp1Status : null;
  const isEggWe = ui?.family === "egg-we" || activeEggWeClient !== null;
  const isEgg = isEgg8k || isEggWe;
  const isWLMouse = ui?.family === "wlmouse" || activeWLMouseClient !== null;
  const isLamzu = ui?.family === "lamzu" || activeLamzuClient !== null;
  const settingsPending = ui?.settingsReady === false;
  const isWired = status.connectionType === "Wired";
  // Always clear device-specific panels first. A status read from the previous
  // mouse may have left these visible when WebHID switches devices.
  resetDeviceSpecificPanels();
  const batterySummary = document.querySelector<HTMLElement>("#battery-summary");
  if (batterySummary) {
    // 8K is wired-only (no battery). Drivers may force the column via ui.forceShowBattery.
    const hideBattery = isEgg8k
      || (isWired && !ui?.forceShowBattery && status.batteryPercent === null);
    batterySummary.hidden = hideBattery;
    batterySummary.style.display = hideBattery ? "none" : "flex";
  }
  const overview = document.querySelector<HTMLElement>(".device-overview");
  const mouseStage = document.querySelector<HTMLElement>("#overview-mouse-stage");
  if (overview) {
    const useHeroOverview = isLamzu;
    overview.classList.toggle("is-hero", useHeroOverview);
    if (mouseStage) {
      mouseStage.hidden = !useHeroOverview;
      mouseStage.style.display = useHeroOverview ? "" : "none";
    }
    if (useHeroOverview) {
      overview.style.gridTemplateColumns = "";
      const caption = document.querySelector("#overview-model-caption");
      if (caption) {
        const product = status.name.replace(/^Lamzu\s+/i, "").trim() || "Maya X";
        caption.textContent = product.toUpperCase();
      }
      const mouseImage = document.querySelector<HTMLImageElement>("#overview-mouse-image");
      if (mouseImage) {
        mouseImage.src = "/maya-x-top.png?v=4";
        mouseImage.alt = `Top view of ${status.name}`;
      }
    } else {
      const showBatteryColumn = !isEgg8k
        && (ui?.forceShowBattery || !isWired || status.batteryPercent !== null);
      overview.style.gridTemplateColumns = showBatteryColumn ? "repeat(3, 1fr)" : "repeat(2, 1fr)";
    }
  }
  setText("#polling-note", ui?.pollingNote
    ?? (isEgg8k
      ? "Higher rates update cursor movement more often and increase CPU/USB processing load."
      : "Higher rates update cursor movement more often, but use more battery."));
  const pollingCard = document.querySelector<HTMLElement>("[data-rate]")?.closest<HTMLElement>(".setting-card");
  if (pollingCard) {
    pollingCard.hidden = false;
    pollingCard.style.display = "";
  }
  const sleepSettings = document.querySelector<HTMLElement>("#sleep-settings");
  if (sleepSettings) {
    sleepSettings.hidden = isEgg
      || (isLamzu && (status.sleepTimeout === null || status.sleepTimeout === undefined));
  }
  const debounceSettings = document.querySelector<HTMLElement>("#debounce-settings");
  if (debounceSettings) {
    const showDebounce = status.debounceMs !== null && status.debounceMs !== undefined
      && (status.brand === "Pulsar" || isWLMouse || isLamzu);
    debounceSettings.hidden = !showDebounce;
  }
  const signalSettings = document.querySelector<HTMLElement>("#signal-settings");
  if (signalSettings) signalSettings.hidden = isEgg || isWLMouse || isLamzu;
  const performanceModeSetting = document.querySelector<HTMLElement>("#performance-mode-setting");
  if (performanceModeSetting) {
    const hidePerformanceMode = isEgg || isWLMouse
      || (isLamzu && (status.performanceMode === null || status.performanceMode === undefined));
    performanceModeSetting.hidden = hidePerformanceMode;
    performanceModeSetting.style.display = hidePerformanceMode ? "none" : "flex";
  }
  const processingCard = document.querySelector<HTMLElement>("#motion-sync-toggle")?.closest<HTMLElement>(".setting-card");
  if (processingCard && processingCard.id !== "egg-filter-settings") {
    processingCard.style.display = ui?.hideProcessingCard ? "none" : "";
  }
  const battery = status.batteryPercent === null ? "—" : `${status.batteryPercent}%`;
  const dpiOutputField = document.querySelector<HTMLInputElement>("#dpi-output");
  if (dpiOutputField?.readOnly) dpiOutputField.value = `${status.dpi.toLocaleString()} DPI`;
  setText("#battery-value", battery);
  setText("#battery-detail", batteryDetail(status));
  setText("#firmware-value", status.firmware[0] ?? "—");
  setText("#firmware-detail", status.firmware.length > 1
    ? status.firmware.slice(1).join(" · ")
    : status.firmware.length === 1
      ? (isLamzu ? "Up to date" : "Firmware reported by mouse")
      : "Not reported");
  setText("#connection-value", status.connectionType ?? "Wireless");
  setText("#connection-detail", isLamzu && status.connectionType === "Wireless"
    ? "2.4 GHz receiver"
    : (status.connectionDetail
      ?? (status.activeProfile ? `2.4 GHz · Profile ${status.activeProfile}` : "2.4 GHz receiver")));
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
    const showAdvanced = status.brand === "Pulsar" || isEgg8k || isWLMouse || isLamzu;
    advanced.style.display = showAdvanced ? "grid" : "none";
    advanced.classList.toggle("egg-advanced-layout", isEgg8k);
  }
  const settingsGrid = document.querySelector<HTMLElement>(".settings-grid.device-data");
  if (settingsGrid) {
    // Keep Lamzu controls visible (disabled) so a wrong-interface connect still
    // shows DPI / polling / LOD instead of an empty Sensor panel.
    settingsGrid.style.display = settingsPending && !isLamzu ? "none" : "";
  }

  const sleepToggle = document.querySelector<HTMLElement>("#sleep-toggle");
  if (sleepToggle) sleepToggle.hidden = !isWLMouse;
  if (isWLMouse) {
    fillSleepOptions(WLMOUSE_SLEEP_OPTIONS);
    if (status.sleepTimeout) lastSleepSeconds = status.sleepTimeout;
    setToggleValue("#sleep-toggle", status.sleepTimeout !== null && status.sleepTimeout !== undefined);
    setControlValue("#debounce-select", status.debounceMs);
    setControlValue("#sleep-select", status.sleepTimeout);
    setToggleValue("#motion-sync-toggle", status.motionSync);
    setToggleValue("#angle-snapping-toggle", status.angleSnapping);
    setToggleValue("#ripple-control-toggle", status.rippleControl);
  }
  if (status.brand === "Pulsar" || status.brand === "Endgame Gear" || isLamzu) {
    fillSleepOptions(ui?.auroraSleepSeconds ? LAMZU_AURORA_SLEEP_OPTIONS : PULSAR_SLEEP_OPTIONS);
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
    const angleTuneRow = document.querySelector<HTMLElement>("#lamzu-angle-tune-row");
    if (angleTuneRow) {
      const showAngle = ui?.showAngleTune === true;
      angleTuneRow.hidden = !showAngle;
      angleTuneRow.style.display = showAngle ? "block" : "none";
      if (showAngle) {
        const degrees = status.angleTuning ?? 0;
        setControlValue("#lamzu-angle-tune", degrees);
        updateLamzuAngleTuneUi(degrees);
      }
    }
    const eggFilterSettings = document.querySelector<HTMLElement>("#egg-filter-settings");
    const eggSpdtSettings = document.querySelector<HTMLElement>("#egg-spdt-settings");
    const eggPollingSettings = document.querySelector<HTMLElement>("#egg-polling-settings");
    const eggCpiSettings = document.querySelector<HTMLElement>("#egg-cpi-settings");
    const eggButtonSettings = document.querySelector<HTMLElement>("#egg-button-settings");
    const eggSensorTuning = document.querySelector<HTMLElement>("#egg-sensor-tuning");
    const eggDeviceActions = document.querySelector<HTMLElement>("#egg-device-actions");
    if (eggFilterSettings) eggFilterSettings.style.display = isEgg8k ? "block" : "none";
    if (eggSpdtSettings) eggSpdtSettings.style.display = isEgg8k ? "block" : "none";
    if (eggPollingSettings) eggPollingSettings.style.display = isEgg8k && interfacePreferences.showExperimental ? "block" : "none";
    if (eggCpiSettings) eggCpiSettings.style.display = isEgg8k ? "block" : "none";
    if (eggButtonSettings) eggButtonSettings.style.display = isEgg8k ? "block" : "none";
    if (eggSensorTuning) {
      eggSensorTuning.style.display = eggStatus
        && (eggStatus.eggSupportsGlassMode === true || eggStatus.eggSupportsV2SensorControls === true)
        ? "block"
        : "none";
    }
    if (eggDeviceActions) eggDeviceActions.style.display = isEgg8k ? "block" : "none";
    if (eggStatus) {
      setToggleValue("#slamclick-filter-toggle", eggStatus.slamclickFilter);
      setToggleValue("#motion-jitter-filter-toggle", eggStatus.motionJitterFilter);
      setControlValue("#left-spdt-select", eggStatus.leftSpdtMode);
      setControlValue("#right-spdt-select", eggStatus.rightSpdtMode);
      setControlValue("#egg-cpi-levels", eggStatus.eggCpiLevels);
      setControlValue("#egg-polling-divider", eggStatus.eggPollingDivider);
      setToggleValue("#egg-glass-toggle", eggStatus.eggGlassMode);
      setToggleValue("#egg-max-fps-toggle", eggStatus.eggForceMaxFps);
      setToggleValue("#egg-led-lift-toggle", eggStatus.eggLedLiftOffDisabled);
      setControlValue("#egg-angle-tuning", eggStatus.eggAngleTuning);
      const glassRow = document.querySelector<HTMLElement>("#egg-glass-row");
      const v2SensorControls = document.querySelector<HTMLElement>("#egg-v2-sensor-controls");
      if (glassRow) glassRow.style.display = eggStatus.eggSupportsGlassMode ? "flex" : "none";
      if (v2SensorControls) v2SensorControls.style.display = eggStatus.eggSupportsV2SensorControls ? "block" : "none";
      const customDivider = document.querySelector<HTMLInputElement>("#egg-polling-divider");
      const applyDivider = document.querySelector<HTMLButtonElement>("#apply-egg-polling");
      if (customDivider) customDivider.disabled = settingsPending || eggStatus.eggGlassMode === true;
      if (applyDivider) applyDivider.disabled = settingsPending || eggStatus.eggGlassMode === true;
      const motionSync = document.querySelector<HTMLButtonElement>("#motion-sync-toggle");
      if (motionSync && status.pollingRateHz === 8000 && eggStatus.eggMotionSyncAt8k === false) {
        motionSync.disabled = true;
        motionSync.title = "The PAW3395 cannot use Motion Sync at 8,000 Hz.";
      } else if (motionSync) {
        motionSync.title = "";
      }
      if (eggStatus.eggGlassMode === true) {
        setText("#polling-note", "Glass Mode is active; mouse firmware controls the polling divider.");
      }
      const leftHanded = document.querySelector<HTMLInputElement>("#egg-left-handed");
      if (leftHanded) leftHanded.checked = eggStatus.eggLeftHanded;
      updateCustomPollingPreview();
      renderEggCpiStages(eggStatus);
      renderEggButtons(eggStatus);
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
  // Same banner copy as other brands — no RE/debug messaging in the chrome.
  setText("#connection-banner", settingsPending && ui?.pollingNote
    ? ui.pollingNote
    : "Connected directly through WebHID. Supported settings can be adjusted here.");
  if (settingsPending) {
    setText("#read-status", ui?.pollingNote
      ? "Settings link not ready — see the note above."
      : (status.batteryPercent === null ? "Connected" : `Battery ${status.batteryPercent}%`));
  } else {
    setText("#read-status", `Current: ${status.dpi.toLocaleString()} DPI · ${status.pollingRateHz.toLocaleString()} Hz`);
  }
  const meter = document.querySelector<HTMLElement>("#battery-meter");
  if (meter) meter.style.width = status.batteryPercent === null ? "0%" : `${status.batteryPercent}%`;
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.remove("is-idle"));
  document.querySelector<HTMLElement>(".control-shell")?.classList.remove("is-empty");
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => button.classList.toggle("selected", Number(button.dataset.rate) === status.pollingRateHz));
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => button.classList.toggle("selected", button.dataset.lod === status.liftOffDistance));
  const genericLodOptions = document.querySelector<HTMLElement>("#generic-lod-options");
  const eggLodSelect = document.querySelector<HTMLSelectElement>("#egg-lod-select");
  if (genericLodOptions) genericLodOptions.hidden = isEgg8k;
  if (eggLodSelect) {
    eggLodSelect.hidden = !isEgg8k;
    eggLodSelect.disabled = settingsPending;
    if (eggStatus) {
      eggLodSelect.replaceChildren(...eggStatus.eggLodOptions.map((label, index) => new Option(label, String(index))));
      eggLodSelect.value = String(eggStatus.eggLodIndex);
    }
  }
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => {
    const rate = Number(button.dataset.rate);
    const supportedRates = status.supportedPollingRates;
    const unsupportedForListed = Array.isArray(supportedRates) && !supportedRates.includes(rate);
    const hideListed = (status.brand === "Logitech" || ui?.hideUnsupportedPollingRates) && unsupportedForListed;
    // Lamzu: keep controls visible/enabled so a click can re-probe the wireless link.
    const block = settingsPending && !isLamzu;
    const hide = hideListed || block;
    button.hidden = hide;
    button.disabled = hide || block || eggStatus?.eggGlassMode === true;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => {
    const hideLow = button.dataset.lod === "Low"
      && (isEgg || ui?.hideLodLow === true);
    button.hidden = hideLow;
    button.disabled = hideLow || (settingsPending && !isLamzu)
      || (status.brand === "Logitech" && button.dataset.lod === "Low");
  });
  document.querySelectorAll<HTMLButtonElement>("[data-dpi]").forEach((button) => {
    button.classList.toggle("selected", Number(button.dataset.dpi) === status.dpi);
    button.disabled = settingsPending && !isLamzu;
  });
  const customDpi = document.querySelector<HTMLButtonElement>("#custom-dpi");
  if (customDpi) customDpi.disabled = settingsPending && !isLamzu;
  if (dpiOutputField && settingsPending && !isLamzu) {
    dpiOutputField.value = "—";
    dpiOutputField.readOnly = true;
  }
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
  if (eggWeIsSupported(device)) return eggWeCreate(device);
  if (PulsarProHidClient.isSupported(device)) return new PulsarProHidClient(device);
  if (PulsarHidClient.isSupported(device)) return new PulsarHidClient(device);
  if (LamzuHidClient.isSupported(device)) return new LamzuHidClient(device);
  if (LogitechHidppClient.isSupported(device)) return new LogitechHidppClient(device);
  if (WLMouseHidClient.isSupported(device)) return new WLMouseHidClient(device);
  return null;
}

async function createSupportedClientFromPool(
  selected: HIDDevice,
  pool?: HIDDevice[],
): Promise<SupportedClient | null> {
  const devices = pool ?? await navigator.hid?.getDevices() ?? [];
  if (isLamzuVendor(selected.vendorId) || LamzuHidClient.isSupported(selected)) {
    const lamzu = LamzuHidClient.fromAuthorizedDevices(
      devices.length > 0 ? devices : [selected],
      selected,
    );
    if (lamzu) return lamzu;
  }
  return createSupportedClient(selected);
}

function deviceBrand(client: SupportedClient): string {
  if (client instanceof EggOp1HidClient || isEggWeClient(client)) return "Endgame Gear";
  if (client instanceof LogitechHidppClient) return "Logitech";
  if (client instanceof WLMouseHidClient) return "WLMouse";
  if (client instanceof LamzuHidClient) return "Lamzu";
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

/** Supported devices for the sidebar; multi-path drivers collapse via their module. */
function listLogicalDevices(devices?: HIDDevice[]): HIDDevice[] {
  const all = devices ?? [];
  const merged = eggWeMergeLogicalDevices(
    all,
    (device) => createSupportedClient(device) !== null,
  );
  const nonLamzu = merged.filter((device) => !isLamzuVendor(device.vendorId));
  const lamzu = LamzuHidClient.mergeLogicalDevices(merged);
  return [...nonLamzu, ...lamzu];
}

async function renderDeviceSidebar(devices?: HIDDevice[]): Promise<void> {
  const list = document.querySelector<HTMLElement>("#sidebar-device-list");
  if (!list) return;
  const all = devices ?? await navigator.hid?.getDevices() ?? [];
  const supportedDevices = listLogicalDevices(all);
  if (supportedDevices.length === 0) {
    list.innerHTML = `<div class="device-select"><span class="device-dot is-idle"></span><span><strong>No device connected</strong><small>Choose a supported device</small></span></div>`;
    return;
  }
  list.innerHTML = supportedDevices.map((device, index) => {
    const client = createSupportedClient(device)!;
    const status = deviceStatuses.get(device);
    const selected = device === activeDevice;
    const name = status?.name
      ?? status?.ui?.defaultDisplayName
      ?? (isEggWeClient(client) ? EGG_WE_DISPLAY_NAME : (device.productName ?? `${deviceBrand(client)} mouse`));
    const detail = status
      ? `${status.brand} · ${status.connectionType ?? "Connected"}`
      : `${deviceBrand(client)} · Available`;
    return `<button class="device-select${selected ? " is-selected" : ""}" type="button" data-device-index="${index}" aria-pressed="${selected}">
      <span class="device-dot${selected ? "" : " is-idle"}"></span>
      <span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></span>
    </button>`;
  }).join("");
}

async function selectAuthorizedDevice(index: number): Promise<void> {
  if (settingInProgress || refreshInProgress) return;
  const all = await navigator.hid?.getDevices() ?? [];
  const devices = listLogicalDevices(all);
  const device = devices[index];
  if (!device || device === activeDevice) return;
  const client = await createSupportedClientFromPool(device, all);
  if (!client) return;
  setText("#device-status", "Switching");
  setText("#read-status", `Reading ${statusNameForClient(client)}.`);
  try {
    await activateClient(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to switch devices.";
    setText("#device-status", "Connection failed");
    setText("#read-status", message);
  }
}

function statusNameForClient(client: SupportedClient): string {
  if (isEggWeClient(client)) return EGG_WE_DISPLAY_NAME;
  return client.device.productName || "the selected mouse";
}

async function activateClient(client: SupportedClient): Promise<void> {
  resetDeviceSpecificPanels();
  activeClient = null;
  activePulsarClient = null;
  activeEggClient = null;
  activeEggWeClient = null;
  activeWLMouseClient = null;
  activeLamzuClient = null;
  activeDevice = client.device;
  lastRenderedStatusKey = null;
  try {
    if (client instanceof WLMouseHidClient) {
      activeWLMouseClient = client;
      const status = await client.readStatus();
      deviceStatuses.set(client.device, status);
      dpiOptions = client.getDpiOptions();
      configureDpiControl(status.dpi);
      showStatus(status);
      await client.startNotifications(() => {
        void refreshStatus();
      }).catch(() => false);
    } else if (client instanceof LamzuHidClient) {
      activeLamzuClient = client;
      const status = await client.readStatus();
      deviceStatuses.set(client.device, status);
      dpiOptions = client.getDpiOptions();
      configureDpiControl(status.dpi);
      showStatus(status);
    } else if (client instanceof EggOp1HidClient) {
      activeEggClient = client;
      client.onDeviceChange = () => { void refreshStatus(); };
      const status = await client.readStatus();
      deviceStatuses.set(client.device, status);
      dpiOptions = client.getDpiOptions();
      configureDpiControl(status.dpi);
      showStatus(status);
    } else if (isEggWeClient(client)) {
      await eggWePrepare(client);
      activeEggWeClient = client;
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
  } catch (error) {
    // A failed read must not leave a half-active client that blocks reconnect.
    if (activeSettingsClient() === client) {
      activeClient = null;
      activePulsarClient = null;
      activeEggClient = null;
      activeEggWeClient = null;
      activeWLMouseClient = null;
      activeLamzuClient = null;
      activeDevice = null;
    }
    await client.close().catch(() => undefined);
    throw error;
  }
  await renderDeviceSidebar();
  startAutomaticRefresh();
  // Always restore the sidebar action after a successful activate.
  setConnectionButtons(false, "Add device");
}

function showDisconnectedState(): void {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  activeClient = null;
  activePulsarClient = null;
  activeEggClient = null;
  activeEggWeClient = null;
  activeWLMouseClient = null;
  activeLamzuClient = null;
  activeDevice = null;
  lastRenderedStatusKey = null;
  resetDeviceSpecificPanels();
  const advanced = document.querySelector<HTMLElement>("#pulsar-advanced");
  if (advanced) advanced.style.display = "none";
  const overview = document.querySelector<HTMLElement>(".device-overview");
  overview?.classList.remove("is-hero");
  if (overview) overview.style.gridTemplateColumns = "";
  const mouseStage = document.querySelector<HTMLElement>("#overview-mouse-stage");
  if (mouseStage) {
    mouseStage.hidden = true;
    mouseStage.style.display = "none";
  }
  document.querySelector<HTMLElement>(".control-shell")?.classList.add("is-empty");
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.add("is-idle"));
  setText("#device-title", "Connect a mouse");
  setText("#device-status", "No device connected");
  setText("#connection-banner", "Connect a supported device to view and change its settings.");
  setText("#read-status", "Add a supported device from the sidebar to read its current status.");
  setConnectionButtons(false, "Add device");
}

function handleHidConnect(event: HIDConnectionEvent): void {
  if (isLamzuVendor(event.device.vendorId) || LamzuHidClient.isSupported(event.device)) {
    void (async () => {
      const all = await navigator.hid?.getDevices() ?? [];
      await renderDeviceSidebar(all);
      const client = await createSupportedClientFromPool(event.device, all);
      if (!client) return;
      // If we already have a higher-scoring Lamzu interface active, ignore utility interfaces.
      if (activeLamzuClient
        && activeLamzuClient.device.productId === event.device.productId
        && LamzuHidClient.supportScore(activeLamzuClient.device) >= LamzuHidClient.supportScore(event.device)
        && activeLamzuClient.device !== event.device) {
        return;
      }
      setText("#device-status", "New device detected");
      setText("#read-status", `Reading ${statusNameForClient(client)}.`);
      await activateClient(client);
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unable to read the connected mouse.";
      setText("#device-status", "Connection failed");
      setText("#read-status", message);
      void renderDeviceSidebar();
    });
    return;
  }

  const client = createSupportedClient(event.device);
  if (!client) {
    void renderDeviceSidebar();
    return;
  }

  if (isEggWeClient(client)) {
    void (async () => {
      const all = await navigator.hid?.getDevices() ?? [];
      await renderDeviceSidebar(all);
      const result = await eggWeResolveConnect(event.device, activeEggWeClient, activeDevice, all);
      if (result.action === "ignore") return;
      if (result.action === "refresh") {
        try {
          const status = await result.client.readStatus();
          deviceStatuses.set(result.client.device, status);
          showStatus(status);
          startAutomaticRefresh();
        } catch {
          /* keep existing UI */
        }
        return;
      }
      setText("#device-status", result.reason === "path" ? "Switching path" : "New device detected");
      setText("#read-status", result.reason === "path"
        ? "Preferring USB over receiver."
        : `Reading ${EGG_WE_DISPLAY_NAME}.`);
      await activateClient(result.client);
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unable to read the connected mouse.";
      setText("#device-status", "Connection failed");
      setText("#read-status", message);
      void renderDeviceSidebar();
    });
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
  // Multi-collection drivers (cmd + notify) treat either handle as the active mouse.
  if (event.device !== activeDevice && !eggWeOwnsDevice(activeEggWeClient, event.device)) {
    void renderDeviceSidebar();
    return;
  }
  showDisconnectedState();
  void (async () => {
    const devices = (await navigator.hid?.getDevices() ?? [])
      .filter((device) => device !== event.device);
    const logical = listLogicalDevices(devices);
    const replacement = logical
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
    filters: SUPPORTED_HID_FILTERS,
  });
  if (devices.length === 0) return null;

  // Dual-collection drivers (e.g. WE) need the full authorized set.
  if (devices.some((device) => eggWeIsSupported(device))) {
    const weClient = eggWeFromAuthorized(await eggWeAuthorizedPool(devices));
    if (weClient) return weClient;
  }

  const authorized = await navigator.hid.getDevices();
  const pool = [...new Map([...authorized, ...devices].map((device) => [device, device])).keys()];

  // Lamzu Compx / Maya X receivers expose multiple interfaces; prefer the control one.
  if (devices.some((device) => isLamzuVendor(device.vendorId) || LamzuHidClient.isSupported(device))) {
    const lamzu = LamzuHidClient.fromAuthorizedDevices(pool, devices[0]);
    if (lamzu) return lamzu;
  }

  const ranked = devices
    .map((device) => ({ device, client: createSupportedClient(device), score: clientSupportScore(device) }))
    .filter((entry) => entry.client !== null)
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (best?.client) {
    if (isEggWeClient(best.client)) await eggWePrepare(best.client);
    return best.client;
  }

  const details = devices.map((device) => describeHidDevice(device)).join(" · ");
  throw new Error(
    `Selected device is not a supported control interface (${details}). `
    + "For Lamzu Maya X, pick “LAMZU MAYA X” or the Maya X 8K dongle (VID 0x373e). "
    + "For original Maya, pick the Compx/vendor interface — not a plain boot mouse.",
  );
}

function clientSupportScore(device: HIDDevice): number {
  if (EggOp1HidClient.isSupported(device)) return 10;
  if (eggWeIsSupported(device)) return eggWeSupportScore(device);
  if (PulsarProHidClient.isSupported(device)) return 8;
  if (PulsarHidClient.isSupported(device)) return 7;
  if (LamzuHidClient.isSupported(device)) return LamzuHidClient.supportScore(device);
  if (LogitechHidppClient.isSupported(device)) return 6;
  if (WLMouseHidClient.isSupported(device)) return 5;
  return 0;
}

function describeHidDevice(device: HIDDevice): string {
  const name = device.productName || "unknown";
  const ids = `VID 0x${device.vendorId.toString(16)} PID 0x${device.productId.toString(16)}`;
  const collections = device.collections.map((collection) => {
    const features = collection.featureReports.map((report) => `0x${report.reportId.toString(16)}`).join(",") || "none";
    return `usage 0x${collection.usagePage.toString(16)}:${collection.usage.toString(16)} feat[${features}]`;
  }).join(" | ") || "no collections";
  return `${name} (${ids}; ${collections})`;
}

async function connect(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("#connect-button");
  if (!button) return;
  setConnectionButtons(true, "Connecting…");
  setText("#device-status", "Requesting permission");
  setText("#read-status", "Select “LAMZU MAYA X” or “Maya X 8K Dongle” in the browser prompt (not a generic Compx 2.4G receiver), then click Connect.");

  try {
    const client = await requestSupportedClient();
    if (!client) {
      setText("#device-status", "Not connected");
      setText("#read-status", "No device was selected in the browser prompt.");
      return;
    }
    setText("#device-status", "Opening device");
    setText("#read-status", `Reading ${statusNameForClient(client)}…`);
    await activateClient(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read the mouse.";
    await activeEggClient?.close().catch(() => undefined);
    activeEggClient = null;
    await activeEggWeClient?.close().catch(() => undefined);
    activeEggWeClient = null;
    setText("#device-status", "Connection failed");
    setText("#connection-banner", message);
    setText("#read-status", message);
  } finally {
    // Always clear the busy label — success used to leave "Connecting…" stuck.
    setConnectionButtons(false, "Add device");
  }
}

async function reconnectAuthorizedDevice(): Promise<void> {
  if (hasActiveClient() || reconnectInFlight) return;
  const button = document.querySelector<HTMLButtonElement>("#connect-button");
  if (!button) return;
  reconnectInFlight = true;
  setConnectionButtons(true, "Reconnecting…");

  let lastError: Error | null = null;
  try {
    // Browsers can restore WebHID authorization a fraction of a second after the
    // page is ready. Poll quickly at first so reloads do not feel stalled, then
    // keep a few wider retries for slower USB enumeration.
    const retryDelays = [0, 40, 60, 75, 100, 150, 225, 350, 500, 750];
    for (const delay of retryDelays) {
      // Another path (HID connect handler) may have already activated a client.
      if (hasActiveClient()) return;
      if (delay) await waitForHidChange(delay);
      if (hasActiveClient()) return;

      const devices = await navigator.hid?.getDevices() ?? [];
      const clients = listLogicalDevices(devices)
        .map((device) => ({
          device,
          score: clientSupportScore(device),
        }))
        .sort((left, right) => right.score - left.score);
      await renderDeviceSidebar(devices);
      if (clients.length === 0) continue;

      for (const entry of clients) {
        if (hasActiveClient()) return;
        const client = await createSupportedClientFromPool(entry.device, devices);
        if (!client) continue;
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
    if (!hasActiveClient()) {
      setText("#device-status", "Not connected");
      if (lastError) setText("#connection-banner", lastError.message);
      setText("#read-status", "Use Add device if the mouse does not reconnect automatically.");
    }
  } finally {
    reconnectInFlight = false;
    // Always restore the button — previously success left "Reconnecting…" forever.
    setConnectionButtons(false, "Add device");
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
  const values = currentDpi > 0 && !common.includes(currentDpi)
    ? [...common, currentDpi].sort((a, b) => a - b)
    : common;
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
  const requestedDpi = Number(input.value.replace(/[^\d]/g, ""));
  if (!Number.isInteger(requestedDpi)) {
    setText("#read-status", "That DPI value is not supported by this mouse.");
    input.focus();
    input.select();
    return;
  }
  const dpi = activeEggClient?.clampDpi(requestedDpi) ?? requestedDpi;
  input.value = String(dpi);
  if (!dpiOptions.includes(dpi)) {
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
  const client = activeSettingsClient();
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
  const client = activeSettingsClient();
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
    const status = await client.readStatus().catch(() => null);
    if (status) showStatus(status);
    setText("#read-status", error instanceof Error ? error.message : "Unable to set polling rate.");
  } finally {
    settingInProgress = false;
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

async function applyLiftOffDistance(lod: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> {
  const client = activeSettingsClient();
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
  const client = activePulsarClient ?? activeEggClient ?? activeWLMouseClient ?? activeLamzuClient;
  if (!client || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `${enabled ? "Enabling" : "Disabling"} ${settingLabel(setting)}…`);
  try {
    if (setting === "motionSync") await client.setMotionSync(enabled);
    if (setting === "angleSnapping") await client.setAngleSnapping(enabled);
    if (setting === "rippleControl") await client.setRippleControl(enabled);
    if (setting === "performanceMode" && !(activePulsarClient || activeLamzuClient)) {
      throw new Error("Performance mode is not exposed by this device's protocol.");
    }
    if (setting === "performanceMode" && activePulsarClient) await activePulsarClient.setPerformanceMode(enabled);
    if (setting === "performanceMode" && activeLamzuClient) await activeLamzuClient.setPerformanceMode(enabled);
    showStatus(await client.readStatus());
  } catch (error) {
    const status = await client.readStatus().catch(() => null);
    if (status) showStatus(status);
    setText("#read-status", error instanceof Error ? error.message : "Unable to change the Pulsar setting.");
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

function renderEggCpiStages(status: EggOp1Status): void {
  const container = document.querySelector<HTMLElement>("#egg-cpi-stage-list");
  const stages = status.eggCpiStages;
  const levels = status.eggCpiLevels ?? 0;
  if (!container || !stages) return;
  container.innerHTML = stages.slice(0, levels).map((stage, index) => {
    const split = stage.x !== stage.y;
    const step = stage.x <= 10_000 ? status.eggCpiStepLow : status.eggCpiStepHigh;
    return `<div style="padding:.55rem;border:1px solid #303034;border-radius:6px">
      <label style="display:flex;align-items:center;gap:.35rem;font-size:.7rem"><input data-active-cpi="${index}" name="egg-active-cpi" type="radio" ${status.eggActiveCpiStage === index ? "checked" : ""} /> Stage ${index + 1}${status.eggActiveCpiStage === index ? " - active" : ""}</label>
      <label style="display:flex;align-items:center;gap:.35rem;margin:.4rem 0;color:#8b8b90;font-size:.62rem"><input data-cpi-split="${index}" type="checkbox" ${split ? "checked" : ""} /> Separate X/Y</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.35rem">
        <label style="color:#77777c;font-size:.58rem">X<input data-cpi-x="${index}" type="number" min="${status.eggCpiMin}" max="${status.eggCpiMax}" step="${step}" value="${stage.x}" style="width:100%;box-sizing:border-box;margin-top:.15rem;padding:.35rem;background:#171719;color:#eee;border:1px solid #343438;border-radius:5px" /></label>
        <label style="color:#77777c;font-size:.58rem">Y<input data-cpi-y="${index}" type="number" min="${status.eggCpiMin}" max="${status.eggCpiMax}" step="${step}" value="${stage.y}" ${split ? "" : "disabled"} style="width:100%;box-sizing:border-box;margin-top:.15rem;padding:.35rem;background:#171719;color:#eee;border:1px solid #343438;border-radius:5px" /></label>
      </div>
      <button data-apply-cpi="${index}" type="button" style="margin-top:.4rem;padding:.3rem .5rem">Apply stage</button>
    </div>`;
  }).join("");
  container.querySelectorAll<HTMLInputElement>("[data-active-cpi]").forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) void applyEggActiveCpiStage(Number(radio.dataset.activeCpi));
    });
  });
  container.querySelectorAll<HTMLInputElement>("[data-cpi-split]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const index = checkbox.dataset.cpiSplit;
      const y = container.querySelector<HTMLInputElement>(`[data-cpi-y="${index}"]`);
      if (y) y.disabled = !checkbox.checked;
    });
  });
  container.querySelectorAll<HTMLInputElement>("[data-cpi-x], [data-cpi-y]").forEach((input) => {
    input.addEventListener("change", () => { clampEggDpiInput(input); });
  });
  container.querySelectorAll<HTMLButtonElement>("[data-apply-cpi]").forEach((button) => {
    button.addEventListener("click", () => {
      const level = Number(button.dataset.applyCpi);
      const xInput = container.querySelector<HTMLInputElement>(`[data-cpi-x="${level}"]`);
      const x = xInput ? clampEggDpiInput(xInput) : Number.NaN;
      const split = container.querySelector<HTMLInputElement>(`[data-cpi-split="${level}"]`)?.checked === true;
      const yInput = container.querySelector<HTMLInputElement>(`[data-cpi-y="${level}"]`);
      const y = split && yInput ? clampEggDpiInput(yInput) : x;
      void applyEggCpiStage(level, x, y);
    });
  });
}

function renderEggButtons(status: EggOp1Status): void {
  const container = document.querySelector<HTMLElement>("#egg-button-list");
  const filters = status.eggMulticlickFilters;
  const mappings = status.eggButtonMappings;
  const actions = status.eggButtonActions;
  if (!container || !filters || !mappings || !actions) return;
  const groupedOptions = [...new Set(EGG_BUTTON_ACTION_OPTIONS.map((option) => option.group))].map((group) =>
    `<optgroup label="${group}">${EGG_BUTTON_ACTION_OPTIONS.filter((option) => option.group === group).map((option) =>
      `<option value="${option.key}">${option.label}</option>`).join("")}</optgroup>`).join("");
  container.innerHTML = EGG_BUTTON_NAMES.map((name, index) => {
    const gxActive = index === 0 ? status.leftSpdtMode !== "Off" : index === 1 ? status.rightSpdtMode !== "Off" : false;
    const fixedPrimary = (index === 0 && !status.eggLeftHanded) || (index === 1 && status.eggLeftHanded);
    const action = actions[index];
    const unsupported = action.key === "raw" ? `<option value="raw" selected disabled>${escapeHtml(mappings[index])}</option>` : "";
    const multiclick = filters[index] === null || filters[index] === undefined ? "" : `<label style="display:block;margin-top:.35rem;color:#77777c;font-size:.58rem">Multiclick filter
        <input data-multiclick="${index}" type="number" min="0" max="25" step="1" value="${filters[index]}" ${gxActive ? "disabled" : ""} style="width:100%;box-sizing:border-box;margin-top:.15rem;padding:.35rem;background:#171719;color:#eee;border:1px solid #343438;border-radius:5px" />
      </label>`;
    const keyboard = action.key === "keyboard"
      ? `<button data-capture-key="${index}" class="egg-action-button" type="button">${escapeHtml(mappings[index])} - change</button>`
      : "";
    const fixedCpi = action.key === "fixed-cpi"
      ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:.3rem;margin-top:.35rem"><input data-fixed-x="${index}" type="number" min="${status.eggCpiMin}" max="${status.eggCpiMax}" value="${action.x}" aria-label="Fixed X CPI" /><input data-fixed-y="${index}" type="number" min="${status.eggCpiMin}" max="${status.eggCpiMax}" value="${action.y}" aria-label="Fixed Y CPI" /></div><button data-apply-fixed="${index}" class="egg-action-button" type="button">Apply fixed CPI</button>`
      : "";
    return `<div style="padding:.55rem;border:1px solid #303034;border-radius:6px">
      <strong style="font-size:.7rem">${name}</strong>
      ${multiclick}
      <label style="display:block;margin-top:.35rem;color:#77777c;font-size:.58rem">Mapping
        <select data-button-mapping="${index}" ${fixedPrimary ? "disabled" : ""} style="width:100%;margin-top:.15rem;padding:.35rem;background:#171719;color:#eee;border:1px solid #343438;border-radius:5px">${unsupported}${groupedOptions}</select>
      </label>
      ${fixedPrimary ? `<small style="display:block;margin-top:.3rem;color:#77777c">Fixed primary click</small>` : ""}
      ${keyboard}${fixedCpi}
    </div>`;
  }).join("");
  actions.forEach((action, index) => {
    const select = container.querySelector<HTMLSelectElement>(`[data-button-mapping="${index}"]`);
    if (select && action.key !== "raw") select.value = action.key;
  });
  container.querySelectorAll<HTMLInputElement>("[data-multiclick]").forEach((input) => {
    input.addEventListener("change", () => void applyEggMulticlick(Number(input.dataset.multiclick) as EggButtonIndex, Number(input.value)));
  });
  container.querySelectorAll<HTMLSelectElement>("[data-button-mapping]").forEach((select) => {
    select.addEventListener("change", () => {
      const button = Number(select.dataset.buttonMapping) as EggButtonIndex;
      const key = select.value as EggButtonActionKey;
      if (key === "keyboard") void captureEggShortcut(button);
      else if (key === "fixed-cpi") void applyEggButtonMapping(button, { key, x: status.dpi, y: status.dpi });
      else void applyEggButtonMapping(button, { key });
    });
  });
  container.querySelectorAll<HTMLButtonElement>("[data-capture-key]").forEach((button) => {
    button.addEventListener("click", () => void captureEggShortcut(Number(button.dataset.captureKey) as EggButtonIndex));
  });
  container.querySelectorAll<HTMLInputElement>("[data-fixed-x], [data-fixed-y]").forEach((input) => {
    input.addEventListener("change", () => { clampEggDpiInput(input); });
  });
  container.querySelectorAll<HTMLButtonElement>("[data-apply-fixed]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.applyFixed) as EggButtonIndex;
      const xInput = container.querySelector<HTMLInputElement>(`[data-fixed-x="${index}"]`);
      const yInput = container.querySelector<HTMLInputElement>(`[data-fixed-y="${index}"]`);
      const x = xInput ? clampEggDpiInput(xInput) : Number.NaN;
      const y = yInput ? clampEggDpiInput(yInput) : Number.NaN;
      void applyEggButtonMapping(index, { key: "fixed-cpi", x, y });
    });
  });
}

function eggKeyboardUsage(code: string): number | null {
  if (/^Key[A-Z]$/.test(code)) return 0x04 + code.charCodeAt(3) - 65;
  if (/^Digit[1-9]$/.test(code)) return 0x1e + Number(code.slice(5)) - 1;
  if (code === "Digit0") return 0x27;
  if (/^F([1-9]|1[0-2])$/.test(code)) return 0x3a + Number(code.slice(1)) - 1;
  if (/^Numpad[1-9]$/.test(code)) return 0x59 + Number(code.slice(6)) - 1;
  return ({
    Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c,
    Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f, BracketRight: 0x30,
    Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
    Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39,
    PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49,
    Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e,
    ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
    NumLock: 0x53, NumpadDivide: 0x54, NumpadMultiply: 0x55, NumpadSubtract: 0x56,
    NumpadAdd: 0x57, NumpadEnter: 0x58, Numpad0: 0x62, NumpadDecimal: 0x63,
  } as Record<string, number>)[code] ?? null;
}

async function captureEggShortcut(button: EggButtonIndex): Promise<void> {
  if (!activeEggClient || settingInProgress) return;
  setText("#read-status", `Press the keyboard shortcut for ${EGG_BUTTON_NAMES[button]}...`);
  const action = await new Promise<EggButtonAction | null>((resolve) => {
    const finish = (value: EggButtonAction | null): void => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (/^(Control|Shift|Alt|Meta)/.test(event.code)) return;
      const usage = eggKeyboardUsage(event.code);
      if (usage === null) {
        setText("#read-status", `${event.code} is not a supported mouse shortcut key. Try another key.`);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const modifiers = (event.ctrlKey ? 1 : 0) | (event.shiftKey ? 2 : 0)
        | (event.altKey ? 4 : 0) | (event.metaKey ? 8 : 0);
      finish({ key: "keyboard", modifiers, usage });
    };
    const timer = window.setTimeout(() => finish(null), 15_000);
    window.addEventListener("keydown", onKey, true);
  });
  if (action) await applyEggButtonMapping(button, action);
  else setText("#read-status", "Keyboard shortcut capture timed out.");
}

function clampEggDpiInput(input: HTMLInputElement): number {
  const requested = Number(input.value);
  const clamped = activeEggClient?.clampDpi(requested) ?? requested;
  input.value = String(clamped);
  return clamped;
}

async function applyEggCpiLevels(levels: number): Promise<void> {
  await applyEggChange("CPI stage count", async (client) => client.setCpiLevels(levels));
}

async function applyEggActiveCpiStage(level: number): Promise<void> {
  await applyEggChange(`active CPI stage ${level + 1}`, async (client) => client.setActiveCpiStage(level));
}

async function applyEggLodIndex(index: number): Promise<void> {
  await applyEggChange("lift-off distance", async (client) => client.setEggLodIndex(index));
}

async function applyEggLeftHanded(enabled: boolean): Promise<void> {
  await applyEggChange("left-handed mode", async (client) => client.setLeftHanded(enabled));
}

async function applyEggCpiStage(level: number, x: number, y: number): Promise<void> {
  await applyEggChange(`CPI stage ${level + 1}`, async (client) => {
    await client.setCpiStage(level, client.clampDpi(x), client.clampDpi(y));
  });
}

async function applyEggPollingDivider(divider: number): Promise<void> {
  await applyEggChange("custom polling divider", async (client) => client.setCustomPollingDivider(divider));
}

async function applyEggMulticlick(button: EggButtonIndex, value: number): Promise<void> {
  await applyEggChange(`${EGG_BUTTON_NAMES[button]} multiclick filter`, async (client) => client.setMulticlickFilter(button, value));
}

async function applyEggButtonMapping(button: EggButtonIndex, action: EggButtonAction): Promise<void> {
  await applyEggChange(`${EGG_BUTTON_NAMES[button]} mapping`, async (client) => {
    const normalized = action.key === "fixed-cpi"
      ? { ...action, x: client.clampDpi(action.x ?? 0), y: client.clampDpi(action.y ?? action.x ?? 0) }
      : action;
    await client.setButtonMapping(button, normalized);
  });
}

type EggSensorToggle = "glass" | "maxFps" | "ledLift";

async function applyEggSensorToggle(setting: EggSensorToggle, enabled: boolean): Promise<void> {
  const label = setting === "glass"
    ? "Glass Mode"
    : setting === "maxFps"
      ? "Force max Sensor FPS"
      : "lift-off LED behavior";
  await applyEggChange(label, async (client) => {
    if (setting === "glass") await client.setGlassMode(enabled);
    if (setting === "maxFps") await client.setForceMaxSensorFps(enabled);
    if (setting === "ledLift") await client.setLedLiftOffDisabled(enabled);
  });
}

async function applyEggAngleTuning(value: number): Promise<void> {
  await applyEggChange("Sensor Angle Tuning", async (client) => client.setSensorAngleTuning(value));
}

async function applyEggFactoryReset(): Promise<void> {
  if (!activeEggClient || settingInProgress) return;
  if (!window.confirm("Reset every onboard setting on this mouse to its factory default?")) return;
  await applyEggChange("factory defaults", async (client) => client.factoryReset());
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

function updateLamzuAngleTuneUi(degrees: number): void {
  setText("#lamzu-angle-tune-value", `${degrees}°`);
  const indicator = document.querySelector<HTMLElement>("#lamzu-angle-tune-indicator");
  if (indicator) indicator.style.transform = `rotate(${degrees}deg)`;
}

async function applyLamzuAngleTune(degrees: number): Promise<void> {
  if (!activeLamzuClient || settingInProgress) return;
  settingInProgress = true;
  updateLamzuAngleTuneUi(degrees);
  setText("#read-status", `Setting angle tune to ${degrees}°…`);
  try {
    await activeLamzuClient.setAngleTuning(degrees);
    showStatus(await activeLamzuClient.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to set angle tune.");
  } finally {
    settingInProgress = false;
  }
}

async function applyPulsarValue(setting: "debounce" | "sleep", value: number): Promise<void> {
  const client = activePulsarClient ?? activeWLMouseClient ?? activeLamzuClient;
  if (!client || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `Setting ${setting === "debounce" ? `${value} ms debounce` : "auto sleep"}…`);
  try {
    if (setting === "debounce") await client.setDebounceTime(value);
    else await client.setSleepTimeout(value);
    showStatus(await client.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to change that setting.");
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
  const client = activeSettingsClient();
  const interval = client && "pollIntervalMs" in client
    ? Number((client as { pollIntervalMs: number }).pollIntervalMs)
    : 5000;
  if (!interval || interval <= 0) {
    refreshTimer = null;
    return;
  }
  refreshTimer = window.setInterval(() => {
    void refreshStatus();
  }, interval);
}

async function refreshStatus(): Promise<void> {
  const client = activeSettingsClient();
  if (!client || refreshInProgress || settingInProgress) return;
  if ("pollIntervalMs" in client && Number((client as { pollIntervalMs: number }).pollIntervalMs) <= 0) {
    return;
  }
  refreshInProgress = true;
  try {
    const status = activeWLMouseClient && client === activeWLMouseClient
      ? await activeWLMouseClient.readStatus(true)
      : await client.readStatus();
    const currentClient = activeSettingsClient();
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
  void activeEggWeClient?.close();
  void activeWLMouseClient?.close();
  void activeLamzuClient?.close();
});

renderControl();
