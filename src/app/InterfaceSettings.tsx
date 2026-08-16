import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  bridgeDevices,
  bridgeGames,
  bridgeHandshake,
  bridgeProfiles,
  bridgeStatus,
  saveBridgeProfiles,
  saveBridgeDefaultProfile,
  setBridgeDriver,
  type BridgeDevice,
  type BridgeGame,
  type BridgeProfile,
  type BridgeStatus,
} from "../bridge";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import type { InterfacePreferences } from "../interface-preferences";
import { compareVersions, latestRelease, type GitHubRelease } from "../updates";

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

const ARCH_UDEV_COMMAND = `echo 'KERNEL=="hidraw*", SUBSYSTEM=="hidraw", TAG+="uaccess"' | sudo tee /etc/udev/rules.d/99-openmouse.rules >/dev/null && sudo udevadm control --reload-rules && sudo udevadm trigger`;

function UpdateRelease({ name, current, release }: {
  name: string;
  current: string | null;
  release: GitHubRelease | null;
}): ReactNode {
  const state = current && release ? compareVersions(current, release.version) : "unknown";
  const label = !release
    ? "No stable release published"
    : !current
      ? `Latest v${release.version}`
      : state === "update-available"
        ? `Update available · v${release.version}`
        : state === "ahead"
          ? `Development build · latest stable v${release.version}`
          : state === "up-to-date"
            ? `Up to date · v${current}`
            : `Current v${current} · latest v${release.version}`;
  return (
    <section className="openmouse-update-release" data-update={state === "update-available"}>
      <div>
        <strong>{name}</strong>
        <small>{label}</small>
      </div>
      {release ? (
        <details>
          <summary>What’s new</summary>
          <pre>{release.notes}</pre>
          <a href={release.url} target="_blank" rel="noreferrer">
            {state === "update-available" ? "View update" : "View release"}
          </a>
        </details>
      ) : null}
    </section>
  );
}

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
  const [bridgeProfilesList, setBridgeProfilesList] = useState<BridgeProfile[]>([]);
  const [bridgeGamesList, setBridgeGamesList] = useState<BridgeGame[]>([]);
  const [bridgeDeviceList, setBridgeDeviceList] = useState<BridgeDevice[]>([]);
  const [bridgeDeviceBusy, setBridgeDeviceBusy] = useState<string | null>(null);
  const [selectedGameName, setSelectedGameName] = useState("");
  const [bridgeConnectionRequested, setBridgeConnectionRequested] = useState(true);
  const [bridgeChecking, setBridgeChecking] = useState(false);
  const [bridgeMessage, setBridgeMessage] = useState("");
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const [bridgeRelease, setBridgeRelease] = useState<GitHubRelease | null>(null);
  const set = <K extends keyof InterfacePreferences>(key: K) => (value: InterfacePreferences[K]): void =>
    control.setPreference(key, value);
  const checkForUpdates = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setUpdateChecking(true);
    setUpdateMessage("");
    try {
      const bridgeUpdate = await latestRelease("OpenMouse-Project/OpenMouse-Bridge", signal);
      setBridgeRelease(bridgeUpdate);
      setUpdateMessage("Release information is current.");
    } catch (error) {
      if (!signal?.aborted) {
        setUpdateMessage(error instanceof Error ? error.message : "Could not check for updates.");
      }
    } finally {
      if (!signal?.aborted) setUpdateChecking(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (sessionStorage.getItem("openmouse-update-check") !== "done") {
      sessionStorage.setItem("openmouse-update-check", "done");
      void checkForUpdates(controller.signal);
    }
    return () => controller.abort();
  }, [checkForUpdates]);
  const checkBridge = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setBridgeChecking(true);
    try {
      await bridgeHandshake(signal);
      const [status, profiles, games, devices] = await Promise.all([
        bridgeStatus(signal),
        bridgeProfiles(signal),
        bridgeGames(signal),
        bridgeDevices(signal).catch(() => [] as BridgeDevice[]),
      ]);
      setBridge(status);
      setBridgeProfilesList(profiles);
      setBridgeGamesList(games);
      // Leave the list untouched while a polling write is settling so the
      // control does not flicker back to the pre-write value mid-request.
      setBridgeDeviceBusy((busy) => {
        if (busy === null) setBridgeDeviceList(devices);
        return busy;
      });
      setSelectedGameName((current) => current || status.activeGames[0] || games[0]?.name || "");
      setBridgeMessage("");
    } catch {
      if (!signal?.aborted) {
        setBridge(null);
        setBridgeProfilesList([]);
        setBridgeGamesList([]);
        setBridgeDeviceList([]);
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
      if (reconnecting) return;
      reconnecting = true;
      void checkBridge(controller.signal).finally(() => {
        reconnecting = false;
      });
    };
    reconnect();
    const heartbeat = window.setInterval(reconnect, 5_000);
    window.addEventListener("focus", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    return () => {
      controller.abort();
      window.clearInterval(heartbeat);
      window.removeEventListener("focus", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
    };
  }, [bridgeConnectionRequested, checkBridge]);

  const changeDriver = useCallback(async (action: "install" | "uninstall"): Promise<void> => {
    setBridgeDeviceBusy(`driver-${action}`);
    setBridgeMessage(action === "install"
      ? "Approve the Windows prompt to enable native control…"
      : "Approve the Windows prompt to remove the driver…");
    try {
      await setBridgeDriver(action);
      setBridgeMessage(action === "install"
        ? "Driver installed. Reconnect the mouse if it does not appear as controllable."
        : "Driver removed. The mouse is back to its normal driver.");
      await checkBridge();
    } catch (error) {
      setBridgeMessage(error instanceof Error ? error.message : "The driver change did not complete.");
    } finally {
      setBridgeDeviceBusy(null);
    }
  }, [checkBridge]);

  const selectedGame = bridgeGamesList.find((game) => game.name === selectedGameName) ?? null;
  const status = snapshot.status;
  const deviceId = status ? `${status.brand}:${status.name}` : "";
  const bridgeConnected = bridge !== null;
  useEffect(() => {
    if (!bridgeConnected || !status) return;
    void saveBridgeDefaultProfile({
      application: { name: status.name, executable: "", path: "" },
      device: { id: deviceId, name: status.name },
      settings: {
        // 0 means "not readable" (e.g. the browser-read-only Attack Shark X11),
        // so store null rather than a bogus 0 DPI / 0 Hz profile.
        dpi: status.dpi || null,
        pollingRateHz: status.pollingRateHz || null,
      },
    }).catch(() => undefined);
  }, [bridgeConnected, deviceId, status?.dpi, status?.name, status?.pollingRateHz]);
  const selectedProfile = selectedGame
    ? bridgeProfilesList.find((profile) =>
      profile.application.name === selectedGame.name && profile.device.id === deviceId) ?? null
    : null;
  const captureApplicationProfile = async (): Promise<void> => {
    if (!selectedGame || !status) return;
    const profile: BridgeProfile = {
      application: {
        name: selectedGame.name,
        executable: selectedGame.executables[0] ?? selectedGame.name,
        path: `openmouse-game:${selectedGame.name}`,
      },
      device: { id: deviceId, name: status.name },
      settings: {
        // 0 means "not readable" (e.g. the browser-read-only Attack Shark X11),
        // so store null rather than a bogus 0 DPI / 0 Hz profile.
        dpi: status.dpi || null,
        pollingRateHz: status.pollingRateHz || null,
      },
    };
    const next = [
      ...bridgeProfilesList.filter((entry) =>
        entry.application.name !== selectedGame.name || entry.device.id !== deviceId),
      profile,
    ];
    try {
      await saveBridgeProfiles(next);
      setBridgeProfilesList(next);
      setBridgeMessage(`Saved ${selectedGame.name} for ${status.name}.`);
    } catch (error) {
      setBridgeMessage(error instanceof Error ? error.message : "Could not save the application profile.");
    }
  };
  const deleteProfile = async (profile: BridgeProfile): Promise<void> => {
    const next = bridgeProfilesList.filter((entry) => entry !== profile);
    try {
      await saveBridgeProfiles(next);
      setBridgeProfilesList(next);
      setBridgeMessage(`Removed ${profile.application.name} for ${profile.device.name}.`);
    } catch (error) {
      setBridgeMessage(error instanceof Error ? error.message : "Could not remove the profile.");
    }
  };
  const availableUpdates = [
    bridge && bridgeRelease && compareVersions(bridge.version, bridgeRelease.version) === "update-available" ? "Bridge" : null,
  ].filter((name): name is string => name !== null);
  const isArchLinux = bridge?.linuxDistribution?.split(/\s+/).includes("arch") ?? false;

  return (
    <>
    {availableUpdates.length > 0 && !snapshot.interfaceSettingsOpen ? (
      <button className="openmouse-update-toast" type="button" onClick={control.openInterfaceSettings}>
        <strong>Update available</strong>
        <span>{availableUpdates.join(" and ")} · View changelog</span>
      </button>
    ) : null}
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
        <article className="interface-setting-card openmouse-update-card">
          <div className="openmouse-update-heading">
            <div>
              <span>LATEST UPDATES</span>
              <h3>OpenMouse Bridge release status</h3>
              <p>Checks the latest Bridge version and changelog. Updates are never downloaded or installed automatically.</p>
            </div>
            <button type="button" disabled={updateChecking} onClick={() => void checkForUpdates()}>
              {updateChecking ? "Checking…" : "Check for updates"}
            </button>
          </div>
          <div className="openmouse-update-list">
            <UpdateRelease name="OpenMouse Bridge" current={bridge?.version ?? null} release={bridgeRelease} />
          </div>
          {updateMessage ? <small className="openmouse-update-message">{updateMessage}</small> : null}
        </article>
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
              {bridgeRelease ? (
                <a className="openmouse-bridge-download" href={bridgeRelease.url} target="_blank" rel="noreferrer">
                  Download Bridge v{bridgeRelease.version}
                </a>
              ) : (
                <button type="button" disabled>Release unavailable</button>
              )}
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
                  ? `${bridgeGamesList.length} games tracked · ${bridge.profileCount} profiles · battery alerts at ${bridge.batteryThresholdPercent}%`
                  : "Install OpenMouse Bridge before connecting it to this control panel."}
              </small>
            </div>
            {isArchLinux ? (
              <aside className="openmouse-arch-udev">
                <div>
                  <strong>Arch Linux needs a WebHID udev rule</strong>
                  <small>Run this once, then unplug and reconnect the mouse.</small>
                </div>
                <code>{ARCH_UDEV_COMMAND}</code>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(ARCH_UDEV_COMMAND).then(
                    () => setBridgeMessage("Copied the Arch Linux udev command."),
                    () => setBridgeMessage("Could not copy automatically. Select the command manually."),
                  )}
                >
                  Copy command
                </button>
              </aside>
            ) : null}
            {bridge ? (
              <div className="openmouse-bridge-devices">
                <div className="openmouse-bridge-app-heading">
                  <div>
                    <span>NATIVE DEVICES</span>
                    <h4>Mice the Bridge reaches directly, bypassing the browser</h4>
                  </div>
                </div>
                {bridgeDeviceList.length === 0 ? (
                  <p className="openmouse-bridge-message" role="status">
                    No Bridge-controlled mice detected. Plug in an Attack Shark X11 — it needs the Bridge because its
                    settings channel is not reachable from a browser.
                  </p>
                ) : (
                  <ul className="openmouse-bridge-device-list">
                    {bridgeDeviceList.map((device) => (
                      <li key={device.id} className="openmouse-bridge-device" data-controllable={device.controllable}>
                        <div className="openmouse-bridge-device-head">
                          <strong>{device.name}</strong>
                          <span className="openmouse-bridge-device-meta">
                            {device.connection === "wireless" ? "Wireless" : "Wired"}
                            {device.batteryPercent !== null ? ` · ${device.batteryPercent}% battery` : ""}
                            {device.controllable ? "" : " · needs setup"}
                          </span>
                        </div>
                        {device.controllable ? (
                          <small className="openmouse-bridge-device-note">
                            Ready. It appears in the sidebar — select it to change DPI and polling
                            rate under Overview and Performance, like any other mouse.
                          </small>
                        ) : (
                          <small className="openmouse-bridge-device-note">{device.note}</small>
                        )}
                        {bridge?.platform === "windows" ? (
                          <div className="openmouse-bridge-device-actions">
                            {device.controllable ? (
                              <button
                                type="button"
                                className="openmouse-bridge-device-secondary"
                                disabled={bridgeDeviceBusy !== null}
                                onClick={() => void changeDriver("uninstall")}
                              >
                                Remove driver
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="openmouse-bridge-device-enable"
                                disabled={bridgeDeviceBusy !== null}
                                onClick={() => void changeDriver("install")}
                              >
                                {bridgeDeviceBusy === "driver-install" ? "Enabling…" : "Enable native control"}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
            {bridge ? (
              <div className="openmouse-bridge-applications">
                <div className="openmouse-bridge-app-heading">
                  <div>
                    <span>GAME PROFILES</span>
                    <h4>Create and manage every Bridge profile here</h4>
                  </div>
                  <small>{bridgeProfilesList.length} saved</small>
                </div>
                <div className="openmouse-profile-manager">
                  <label>
                    <span>Supported game</span>
                    <select value={selectedGameName} onChange={(event) => setSelectedGameName(event.currentTarget.value)}>
                      {bridgeGamesList.map((game) => (
                        <option key={game.name} value={game.name}>
                          {game.name}{bridge.activeGames.includes(game.name) ? " · Running" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {selectedGame ? (
                  <div className="openmouse-bridge-profile-editor">
                    <div>
                      <strong>{selectedGame.name}</strong>
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
                {bridgeProfilesList.length > 0 ? (
                  <div className="openmouse-saved-profiles">
                    {bridgeProfilesList.map((profile) => (
                      <article key={`${profile.application.path}:${profile.device.id}`}>
                        <div>
                          <strong>{profile.application.name}</strong>
                          <small>{profile.device.name} · {profile.settings.dpi ?? "—"} DPI · {profile.settings.pollingRateHz ?? "—"} Hz</small>
                        </div>
                        <button type="button" onClick={() => void deleteProfile(profile)}>Delete</button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p>No game profiles yet. Choose any supported game above and capture the selected mouse settings.</p>
                )}
                {bridge.activeProfile ? (
                  <p className="openmouse-bridge-message" role="status">
                    Active profile: {bridge.activeProfile.application.name} · {bridge.activeProfile.settings.dpi ?? "—"} DPI · {bridge.activeProfile.settings.pollingRateHz ?? "—"} Hz
                  </p>
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
    </>
  );
}
