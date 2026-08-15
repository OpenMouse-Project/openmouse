import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  bridgeApplications,
  bridgeApplicationIconUrl,
  bridgeProfiles,
  bridgeStatus,
  saveBridgeProfiles,
  type BridgeApplication,
  type BridgeProfile,
  type BridgeStatus,
} from "../bridge";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import type { InterfacePreferences } from "../interface-preferences";

interface ThemeSwatch {
  name: string;
  accent: string;
  canvas: string;
  surface: string;
}

const THEME_CHOICES: readonly ThemeSwatch[] = [
  { name: "Emerald", accent: "#69d28d", canvas: "#08090a", surface: "#18181b" },
  { name: "Violet", accent: "#a78bfa", canvas: "#08090a", surface: "#18181b" },
  { name: "Ice", accent: "#67d8ff", canvas: "#08090a", surface: "#18181b" },
  { name: "Ember", accent: "#ff9b62", canvas: "#08090a", surface: "#18181b" },
  { name: "Mono", accent: "#f1f1f3", canvas: "#08090a", surface: "#18181b" },
  { name: "Miku", accent: "#39c5bb", canvas: "#0b1618", surface: "#17292c" },
  { name: "Catppuccin Mocha", accent: "#cba6f7", canvas: "#1e1e2e", surface: "#313244" },
  { name: "Catppuccin Macchiato", accent: "#c6a0f6", canvas: "#24273a", surface: "#363a4f" },
  { name: "Catppuccin Frappé", accent: "#ca9ee6", canvas: "#303446", surface: "#414559" },
  { name: "NieR: Automata", accent: "#d1cdb7", canvas: "#282620", surface: "#36342c" },
  { name: "Liquid Glass", accent: "#f4c95d", canvas: "#080a0c", surface: "#151a1e" },
];

function SwitchCard({
  overline,
  title,
  blurb,
  label,
  id,
  checked,
  onChange,
}: {
  overline: string;
  title: string;
  blurb: string;
  label: string;
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): ReactNode {
  return (
    <article className="interface-setting-card">
      <span>{overline}</span>
      <h3>{title}</h3>
      <p>{blurb}</p>
      <label className="interface-switch-row">
        <span>{label}</span>
        <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      </label>
    </article>
  );
}

export function InterfaceSettings({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const preferences = snapshot.preferences;
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [bridgeApplicationsList, setBridgeApplicationsList] = useState<BridgeApplication[]>([]);
  const [bridgeProfilesList, setBridgeProfilesList] = useState<BridgeProfile[]>([]);
  const [selectedApplicationPath, setSelectedApplicationPath] = useState("");
  const [bridgeConnectionRequested, setBridgeConnectionRequested] = useState(false);
  const [bridgeChecking, setBridgeChecking] = useState(false);
  const [bridgeMessage, setBridgeMessage] = useState("");
  const set = <K extends keyof InterfacePreferences>(key: K) => (value: InterfacePreferences[K]): void =>
    control.setPreference(key, value);
  const checkBridge = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setBridgeChecking(true);
    try {
      const [status, applications, profiles] = await Promise.all([
        bridgeStatus(signal),
        bridgeApplications(signal),
        bridgeProfiles(signal),
      ]);
      setBridge(status);
      setBridgeApplicationsList(applications);
      setBridgeProfilesList(profiles);
      setSelectedApplicationPath((current) => current
        || applications.find((application) => application.foreground)?.path
        || applications[0]?.path
        || "");
      setBridgeMessage("");
    } catch {
      if (!signal?.aborted) {
        setBridge(null);
        setBridgeApplicationsList([]);
        setBridgeProfilesList([]);
      }
    } finally {
      if (!signal?.aborted) setBridgeChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!bridgeConnectionRequested) return;
    const controller = new AbortController();
    let reconnecting = false;
    const reconnect = (): void => {
      if (document.visibilityState !== "visible" || reconnecting) return;
      reconnecting = true;
      void checkBridge(controller.signal).finally(() => {
        reconnecting = false;
      });
    };
    reconnect();
    window.addEventListener("focus", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    return () => {
      controller.abort();
      window.removeEventListener("focus", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
    };
  }, [bridgeConnectionRequested, checkBridge]);

  const selectedApplication = bridgeApplicationsList.find(
    (application) => application.path === selectedApplicationPath,
  ) ?? null;
  const status = snapshot.status;
  const deviceId = status ? `${status.brand}:${status.name}` : "";
  const selectedProfile = selectedApplication
    ? bridgeProfilesList.find((profile) =>
      profile.application.path === selectedApplication.path && profile.device.id === deviceId) ?? null
    : null;
  const captureApplicationProfile = async (): Promise<void> => {
    if (!selectedApplication || !status) return;
    const profile: BridgeProfile = {
      application: {
        name: selectedApplication.name,
        executable: selectedApplication.executable,
        path: selectedApplication.path,
      },
      device: { id: deviceId, name: status.name },
      settings: {
        dpi: status.dpi ?? null,
        pollingRateHz: status.pollingRateHz ?? null,
      },
    };
    const next = [
      ...bridgeProfilesList.filter((entry) =>
        entry.application.path !== selectedApplication.path || entry.device.id !== deviceId),
      profile,
    ];
    try {
      await saveBridgeProfiles(next);
      setBridgeProfilesList(next);
      setBridgeMessage(`Saved ${selectedApplication.name} for ${status.name}.`);
    } catch (error) {
      setBridgeMessage(error instanceof Error ? error.message : "Could not save the application profile.");
    }
  };

  return (
    <section
      id="interface-settings-page"
      className={`interface-settings-page${snapshot.interfaceSettingsOpen ? " is-open" : ""}`}
      aria-labelledby="interface-settings-title"
    >
      <header className="interface-settings-header">
        <div>
          <p className="overline">OPENMOUSE</p>
          <h2 id="interface-settings-title">Settings</h2>
        </div>
        <button
          id="close-interface-settings"
          className="interface-settings-back"
          type="button"
          onClick={control.closeInterfaceSettings}
        >
          Back to device
        </button>
      </header>

      <div className="interface-settings-grid">
        {snapshot.previewEnabled ? (
          <article className="interface-setting-card openmouse-bridge-card">
            <div className="openmouse-bridge-copy">
              <span>OPENMOUSE BRIDGE</span>
              <h3>Automatic game detection and battery alerts</h3>
              <p>
                OpenMouse Bridge is a lightweight background service that works with the OpenMouse
                control panel to detect when games start and send battery notifications for your mice.
              </p>
              <ul>
                <li>Runs quietly in the background</li>
                <li>Detects active games automatically</li>
                <li>Sends mouse battery notifications</li>
              </ul>
            </div>
            <div className="openmouse-bridge-action">
              <span>{bridge ? `VERSION ${bridge.version}` : "IN DEVELOPMENT"}</span>
              <div className="openmouse-bridge-status" role="status" data-connected={bridge !== null}>
                <i aria-hidden="true" />
                <span>
                  {bridgeChecking
                    ? "Checking for Bridge…"
                    : bridge
                      ? `${bridge.platform} · ${bridge.activeGames.length > 0 ? bridge.activeGames.join(", ") : "No game detected"}`
                      : "Bridge not connected"}
                </span>
              </div>
              <button type="button" disabled>Download coming soon</button>
              <button
                className="openmouse-bridge-connect"
                type="button"
                disabled={bridgeChecking}
                onClick={() => {
                  if (bridgeConnectionRequested) void checkBridge();
                  else setBridgeConnectionRequested(true);
                }}
              >
                {bridge ? "Refresh Bridge" : "Connect Bridge"}
              </button>
              <small>
                {bridge
                  ? `${bridge.trackedGameCount} games tracked · battery alerts at ${bridge.batteryThresholdPercent}%`
                  : "Install OpenMouse Bridge before connecting it to this control panel."}
              </small>
            </div>
            {bridge ? (
              <div className="openmouse-bridge-applications">
                <div className="openmouse-bridge-app-heading">
                  <div>
                    <span>VISIBLE APPLICATIONS</span>
                    <h4>Choose what should use a custom mouse profile</h4>
                  </div>
                  <small>{bridgeApplicationsList.length} open</small>
                </div>
                {bridgeApplicationsList.length > 0 ? (
                  <div className="openmouse-bridge-app-grid">
                    {bridgeApplicationsList.map((application) => {
                      const assigned = bridgeProfilesList.some((profile) =>
                        profile.application.path === application.path && profile.device.id === deviceId);
                      return (
                        <button
                          key={application.path}
                          type="button"
                          className={selectedApplicationPath === application.path ? "is-selected" : ""}
                          onClick={() => setSelectedApplicationPath(application.path)}
                        >
                          <i aria-hidden="true">
                            <span>{application.name.slice(0, 1).toUpperCase()}</span>
                            <img
                              src={bridgeApplicationIconUrl(application)}
                              alt=""
                              onLoad={(event) => event.currentTarget.parentElement?.classList.add("has-icon")}
                              onError={(event) => event.currentTarget.parentElement?.classList.remove("has-icon")}
                            />
                          </i>
                          <span><strong>{application.name}</strong><small>{application.executable}</small></span>
                          <em>{application.foreground ? "Active" : assigned ? "Profile saved" : "Open"}</em>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p>Bridge has not found any visible Windows applications yet.</p>
                )}
                {selectedApplication ? (
                  <div className="openmouse-bridge-profile-editor">
                    <div>
                      <strong>{selectedApplication.name}</strong>
                      <small>
                        {selectedProfile
                          ? `${selectedProfile.settings.dpi ?? "—"} DPI · ${selectedProfile.settings.pollingRateHz ?? "—"} Hz`
                          : status
                            ? `Capture ${status.dpi ?? "—"} DPI · ${status.pollingRateHz ?? "—"} Hz from ${status.name}`
                            : "Connect a mouse to create a profile."}
                      </small>
                    </div>
                    <button type="button" disabled={!status} onClick={() => void captureApplicationProfile()}>
                      {selectedProfile ? "Update profile" : "Create profile"}
                    </button>
                  </div>
                ) : null}
                {bridgeMessage ? <p className="openmouse-bridge-message" role="status">{bridgeMessage}</p> : null}
              </div>
            ) : null}
          </article>
        ) : null}

        <article className="interface-setting-card interface-theme-card">
          <span>APPEARANCE</span>
          <h3>Accent theme</h3>
          <p>Each tile is painted in its own theme.</p>
          <fieldset id="interface-theme" className="theme-tiles" aria-label="Accent theme">
            {THEME_CHOICES.map(({ name, accent, canvas, surface }) => (
              <label
                key={name}
                className="theme-tile"
                style={{ "--tile-accent": accent, "--tile-canvas": canvas, "--tile-surface": surface }}
              >
                <input
                  type="radio"
                  name="interface-theme"
                  value={name}
                  checked={preferences.theme === name}
                  onChange={() => control.setInterfaceTheme(name)}
                />
                <i className="theme-tile-proof" aria-hidden="true">
                  <b /><b /><b />
                </i>
                <span>{name}</span>
              </label>
            ))}
          </fieldset>
        </article>

        {preferences.theme === "Liquid Glass" ? (
          <article className="interface-setting-card">
            <span>LIQUID GLASS</span>
            <h3>Glass intensity</h3>
            <p>Dial the frosted material from fully transparent panels to the full acrylic finish.</p>
            <div className="glass-intensity-row">
              <span className={`glass-intensity-caption${preferences.glassIntensity <= 25 ? " is-active" : ""}`}>Transparent</span>
              <span className="glass-slider-rail">
                <input
                  id="interface-glass-intensity"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={preferences.glassIntensity}
                  style={{ "--fill": `${preferences.glassIntensity}%` }}
                  onChange={(event) => set("glassIntensity")(Number(event.currentTarget.value))}
                />
              </span>
              <span className={`glass-intensity-caption${preferences.glassIntensity >= 75 ? " is-active" : ""}`}>Acrylic</span>
            </div>
          </article>
        ) : null}

        <SwitchCard
          overline="MOTION"
          title="Animation"
          blurb="Disable interface transitions and animated state changes."
          label="Reduce motion"
          id="interface-reduced-motion"
          checked={preferences.reducedMotion}
          onChange={set("reducedMotion")}
        />
        <SwitchCard
          overline="WRITES"
          title="Instant flash"
          blurb="Write each change to the mouse as soon as you make it, instead of staging it for the flash bar."
          label="Flash immediately"
          id="interface-instant-flash"
          checked={preferences.instantFlash}
          onChange={set("instantFlash")}
        />
        <SwitchCard
          overline="SECTIONS"
          title="Advanced editors"
          blurb="Choose whether CPI, button mapping, and experimental sections begin expanded."
          label="Expand by default"
          id="interface-expand-sections"
          checked={preferences.expandSections}
          onChange={set("expandSections")}
        />
        <SwitchCard
          overline="EXPERIMENTAL"
          title="Experimental controls"
          blurb="Show or completely hide controls that may vary between firmware versions."
          label="Show experimental settings"
          id="interface-show-experimental"
          checked={preferences.showExperimental}
          onChange={set("showExperimental")}
        />
      </div>

      {snapshot.previewEnabled && snapshot.previewEntries.length > 0 ? (
        <section id="preview-launcher" className="preview-launcher" aria-labelledby="preview-launcher-title">
          <div className="interface-setting-card">
            <span>DEVELOPMENT</span>
            <h3 id="preview-launcher-title">Driver previews</h3>
            <p>
              Render any supported driver without its hardware, to check a change against every brand.
              Nothing is written to a device.
            </p>
            <div id="preview-launcher-list" className="preview-launcher-list">
              {snapshot.previewEntries.map(([key, label]) => (
                <a
                  key={key}
                  className={`preview-launcher-link${snapshot.previewMode === key ? " is-active" : ""}`}
                  href={`?preview=${key}`}
                >
                  {label}
                  <small>{key}</small>
                </a>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <button
        id="reset-interface-settings"
        className="interface-reset"
        type="button"
        onClick={control.resetInterfacePreferences}
      >
        Reset interface preferences
      </button>
    </section>
  );
}
