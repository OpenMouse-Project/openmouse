export function controlTemplate(buildLabel: string): string {
  return `
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
          <span class="build-badge" title="OpenMouse ${buildLabel}">${buildLabel}</span>
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
        <div class="sidebar-footer"><span>WebHID device control</span><span>OpenMouse Control</span></div>
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
          <article id="sleep-settings" class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>POWER</p><h2>Auto sleep</h2></div><button id="sleep-toggle" type="button" role="switch" aria-checked="false" hidden style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><select id="sleep-select" style="width:100%;padding:.48rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"><option value="1">10 seconds</option><option value="3">30 seconds</option><option value="6">1 minute</option><option value="12">2 minutes</option><option value="30">5 minutes</option><option value="60">10 minutes</option><option value="180">30 minutes</option></select></article>
          <article id="processing-settings" class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>SENSOR</p><h2>Processing</h2></div></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Motion Sync</span><button id="motion-sync-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Angle snapping</span><button id="angle-snapping-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Ripple control</span><button id="ripple-control-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div id="performance-mode-setting" style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Performance mode</span><button id="performance-mode-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div></article>
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
}
