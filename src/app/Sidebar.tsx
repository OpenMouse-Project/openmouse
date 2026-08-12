import { useState, type ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import { BatteryIcon } from "./ui";

function DiscordIcon(): ReactNode {
  return (
    <svg viewBox="0 0 126.644 96" aria-hidden="true">
      <path fill="currentColor" d="M81.15,0c-1.2376,2.1973-2.3489,4.4704-3.3591,6.794-9.5975-1.4396-19.3718-1.4396-28.9945,0-.985-2.3236-2.1216-4.5967-3.3591-6.794-9.0166,1.5407-17.8059,4.2431-26.1405,8.0568C2.779,32.5304-1.6914,56.3725.5312,79.8863c9.6732,7.1476,20.5083,12.603,32.0505,16.0884,2.6014-3.4854,4.8998-7.1981,6.8698-11.0623-3.738-1.3891-7.3497-3.1318-10.8098-5.1523.9092-.6567,1.7932-1.3386,2.6519-1.9953,20.281,9.547,43.7696,9.547,64.0758,0,.8587.7072,1.7427,1.3891,2.6519,1.9953-3.4601,2.0457-7.0718,3.7632-10.835,5.1776,1.97,3.8642,4.2683,7.5769,6.8698,11.0623,11.5419-3.4854,22.3769-8.9156,32.0509-16.0631,2.626-27.2771-4.496-50.9172-18.817-71.8548C98.9811,4.2684,90.1918,1.5659,81.1752.0505l-.0252-.0505ZM42.2802,65.4144c-6.2383,0-11.4159-5.6575-11.4159-12.6535s4.9755-12.6788,11.3907-12.6788,11.5169,5.708,11.4159,12.6788c-.101,6.9708-5.026,12.6535-11.3907,12.6535ZM84.3576,65.4144c-6.2637,0-11.3907-5.6575-11.3907-12.6535s4.9755-12.6788,11.3907-12.6788,11.4917,5.708,11.3906,12.6788c-.101,6.9708-5.026,12.6535-11.3906,12.6535Z" />
    </svg>
  );
}

function TwitterIcon(): ReactNode {
  return (
    <svg viewBox="0 0 1200 1227" aria-hidden="true">
      <path fill="currentColor" d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z" />
    </svg>
  );
}

function GitHubIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function Sidebar({ snapshot, onOpenSupportRequests }: { snapshot: ControlSnapshot; onOpenSupportRequests: () => void }): ReactNode {
  const { status, deviceArtwork, preferences } = snapshot;
  const [unreachable, setUnreachable] = useState<ReadonlySet<string>>(new Set());
  const showArtwork = deviceArtwork !== null && !unreachable.has(deviceArtwork);
  const showBattery = status !== null && status.batteryPercent !== null;

  return (
    <aside className="sidebar">
      <span className="demo-wordmark">
        <img src="/logo.png" alt="" width={181} height={268} />
        OpenMouse
        <span className="brand-links">
          <a href="https://discord.gg/yxC9jzMdw6" target="_blank" rel="noreferrer" title="Discord" aria-label="OpenMouse on Discord">
            <DiscordIcon />
          </a>
          <a href="https://x.com/openmouseapp" target="_blank" rel="noreferrer" title="Twitter" aria-label="OpenMouse on Twitter">
            <TwitterIcon />
          </a>
          <a href="https://github.com/OpenMouse-Project/openmouse" target="_blank" rel="noreferrer" title="GitHub" aria-label="OpenMouse on GitHub">
            <GitHubIcon />
          </a>
        </span>
      </span>
      <div className="miku-waveform" aria-hidden="true">
        <i /><i /><i /><i /><i />
      </div>

      <section className="sidebar-product device-data" aria-label="Selected device">
        <div className="sidebar-product-heading">
          <span>SELECTED DEVICE</span>
          <strong id="sidebar-device-title">{status?.name ?? "Connected mouse"}</strong>
        </div>
        <article id="device-thumbnail" className="device-thumbnail" hidden={!showArtwork}>
          {deviceArtwork ? (
            <img
              id="device-thumbnail-image"
              src={deviceArtwork}
              alt={status?.name ?? ""}
              onError={() => setUnreachable((seen) => new Set(seen).add(deviceArtwork))}
            />
          ) : null}
        </article>
        {preferences.theme === "Miku" ? (
          <img id="miku-mascot" className="miku-mascot" src="/miku-mascot.gif" alt="" aria-hidden="true" />
        ) : null}
        <div className="sidebar-product-status">
          <span className={`status-dot${status ? "" : " is-idle"}`} />
          <span>Connected</span>
          {showBattery ? (
            <span id="sidebar-battery" className="sidebar-battery">
              <span id="sidebar-battery-icon">
                <BatteryIcon percent={status.batteryPercent} state={status.batteryState} />
              </span>
              <span id="sidebar-battery-value">{status.batteryPercent}%</span>
            </span>
          ) : null}
        </div>
      </section>

      <div className="device-label">CONNECTED DEVICES</div>
      <div className="device-panel">
        <div id="sidebar-device-list" className="sidebar-device-list" role="group" aria-label="Connected devices">
          {snapshot.previewMode !== null && !snapshot.hasActiveDevice && status ? (
            <div className="device-row is-selected">
              <span className="device-dot" />
              <span className="device-row-copy">
                <strong>{status.name}</strong>
                <small>{status.brand} · Preview</small>
              </span>
            </div>
          ) : (
            snapshot.devices.map((device) => (
              <button
                key={device.index}
                type="button"
                className={`device-row${device.selected ? " is-selected" : ""}`}
                aria-current={device.selected}
                onClick={() => {
                  control.closeInterfaceSettings();
                  void control.selectAuthorizedDevice(device.index);
                }}
              >
                <span className={`device-dot${device.selected ? "" : " is-idle"}`} />
                <span className="device-row-copy">
                  <strong>{device.name}</strong>
                  <small>{device.detail}</small>
                </span>
              </button>
            ))
          )}
        </div>
        <button
          id="connect-button"
          className="device-add"
          type="button"
          disabled={snapshot.connectDisabled}
          onClick={() => {
            control.closeInterfaceSettings();
            void control.connect();
          }}
        >
          {snapshot.connectLabel}
        </button>
      </div>

      <nav aria-label="Sections">
        <button
          id="interface-settings-button"
          className="nav-item interface-settings-button"
          type="button"
          aria-current={snapshot.interfaceSettingsOpen}
          onClick={control.openInterfaceSettings}
        >
          Interface settings
        </button>
        <a className="nav-item" href="/check.html">Mouse Check</a>
        <button className="nav-item mouse-request-button" type="button" onClick={onOpenSupportRequests}>Request a mouse</button>
      </nav>
      <span className="build-badge" title={`OpenMouse ${snapshot.buildLabel}`}>{snapshot.buildLabel}</span>
      <small className="build-note">Development build - not the final product</small>
    </aside>
  );
}
