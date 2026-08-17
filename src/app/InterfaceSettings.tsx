import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  bridgeGames,
  bridgeHandshake,
  bridgeProfiles,
  bridgeStatus,
  saveBridgeBattery,
  saveBridgeProfiles,
  saveBridgeDefaultProfile,
  type BridgeBatteryReading,
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

const DEFAULT_POLLING_RATES = [125, 250, 500, 1000] as const;

function uniqueSorted(values: Array<number | null>): number[] {
  return [...new Set(values.filter((value): value is number => value !== null))].sort((a, b) => a - b);
}

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
  const [bridgeConnectionRequested, setBridgeConnectionRequested] = useState(true);
  const [bridgeChecking, setBridgeChecking] = useState(false);
  const [bridgeMessage, setBridgeMessage] = useState("");
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const [bridgeRelease, setBridgeRelease] = useState<GitHubRelease | null>(null);
  // Latest mouse battery, kept in a ref so the []-dependency checkBridge loop
  // always reads the current value without being re-created on every reading.
  const batteryRef = useRef<BridgeBatteryReading | null>(null);
  const mouse = snapshot.status;
  batteryRef.current =
    mouse && mouse.batteryPercent != null
      ? {
          deviceId: `${mouse.brand}:${mouse.name}`,
          deviceName: mouse.name,
          percent: mouse.batteryPercent,
          charging:
            mouse.batteryState === "Charging" ||
            mouse.batteryState === "Charging slowly" ||
            mouse.batteryState === "Almost full",
        }
      : null;
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
      const [status, profiles, games] = await Promise.all([
        bridgeStatus(signal),
        bridgeProfiles(signal),
        bridgeGames(signal),
      ]);
      setBridge(status);
      setBridgeProfilesList(profiles);
      setBridgeGamesList(games);
      setBridgeMessage("");
      // Best-effort: push the current battery so Bridge can show it and warn
      // on low charge. A failure here must not mark the Bridge disconnected.
      const battery = batteryRef.current;
      if (battery) {
        try {
          await saveBridgeBattery(battery, signal);
        } catch {
          /* ignore — battery sync is optional */
        }
      }
    } catch {
      if (!signal?.aborted) {
        setBridge(null);
        setBridgeProfilesList([]);
        setBridgeGamesList([]);
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

  const status = snapshot.status;
  const deviceId = status ? `${status.brand}:${status.name}` : "";
  const bridgeConnected = bridge !== null;
  useEffect(() => {
    if (!bridgeConnected || !status) return;
    void saveBridgeDefaultProfile({
      application: { name: status.name, executable: "", path: "" },
      device: { id: deviceId, name: status.name },
      settings: {
        dpi: status.dpi ?? null,
        pollingRateHz: status.pollingRateHz ?? null,
      },
    }).catch(() => undefined);
  }, [bridgeConnected, deviceId, status?.dpi, status?.name, status?.pollingRateHz]);
  const profileForGame = (gameName: string): BridgeProfile | null =>
    bridgeProfilesList.find((profile) =>
      profile.application.name === gameName && profile.device.id === deviceId) ?? null;
  const gameNames = new Set(bridgeGamesList.map((game) => game.name));
  const activeGameName = bridge?.activeProfile && gameNames.has(bridge.activeProfile.application.name)
    ? bridge.activeProfile.application.name
    : null;
  const defaultActive = bridge?.activeProfile != null && activeGameName === null;
  const otherDeviceProfiles = bridgeProfilesList.filter((profile) => profile.device.id !== deviceId);
  const dpiChoices = uniqueSorted([...snapshot.dpiOptions, status?.dpi ?? null]);
  const pollingChoices = uniqueSorted([
    ...(status?.supportedPollingRates ?? DEFAULT_POLLING_RATES),
    status?.pollingRateHz ?? null,
  ]);
  const saveGameProfile = async (
    game: BridgeGame,
    settings: { dpi: number | null; pollingRateHz: number | null },
  ): Promise<void> => {
    if (!status) return;
    const profile: BridgeProfile = {
      application: {
        name: game.name,
        executable: game.executables[0] ?? game.name,
        path: `openmouse-game:${game.name}`,
      },
      device: { id: deviceId, name: status.name },
      settings,
    };
    const next = [
      ...bridgeProfilesList.filter((entry) =>
        entry.application.name !== game.name || entry.device.id !== deviceId),
      profile,
    ];
    try {
      await saveBridgeProfiles(next);
      setBridgeProfilesList(next);
      setBridgeMessage(`Saved ${game.name} · ${settings.dpi ?? "—"} DPI · ${settings.pollingRateHz ?? "—"} Hz for ${status.name}.`);
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
              <div className="openmouse-bridge-applications">
                <div className="openmouse-bridge-app-heading">
                  <div>
                    <span>GAME PROFILES</span>
                    <h4>Per-game DPI and polling, switched automatically</h4>
                  </div>
                  <small>
                    {bridgeProfilesList.length} saved
                    {status ? ` · ${status.name}` : ""}
                  </small>
                </div>

                <p className="bridge-profile-legend" aria-hidden="true">
                  <span data-state="active">Active now</span>
                  <span data-state="running">Game running</span>
                  <span data-state="saved">Profile saved</span>
                  <span data-state="empty">No profile</span>
                </p>

                <article className="bridge-profile-card is-default" data-state={defaultActive ? "active" : "saved"}>
                  <span className="bridge-profile-dot" />
                  <div className="bridge-profile-body">
                    <strong>
                      Default
                      {defaultActive ? <em className="is-active">Active</em> : null}
                    </strong>
                    <small>
                      {status
                        ? `Applied when no game matches · ${status.dpi ?? "—"} DPI · ${status.pollingRateHz ?? "—"} Hz`
                        : "Connect a mouse to set the fallback settings."}
                    </small>
                  </div>
                  <span className="bridge-profile-auto-tag">Auto · tracks live mouse</span>
                </article>

                <div className="bridge-profile-grid">
                  {bridgeGamesList.map((game) => {
                    const saved = profileForGame(game.name);
                    const running = bridge.activeGames.includes(game.name);
                    const active = activeGameName === game.name;
                    const state = active ? "active" : running ? "running" : saved ? "saved" : "empty";
                    const dpiValue = saved ? saved.settings.dpi : status?.dpi ?? null;
                    const pollValue = saved ? saved.settings.pollingRateHz : status?.pollingRateHz ?? null;
                    const dpiOptions = uniqueSorted([...dpiChoices, dpiValue]);
                    const pollOptions = uniqueSorted([...pollingChoices, pollValue]);
                    return (
                      <article key={game.name} className="bridge-profile-card" data-state={state}>
                        <span className="bridge-profile-dot" />
                        <div className="bridge-profile-head">
                          <strong>
                            {game.name}
                            {active ? <em className="is-active">Active</em> : running ? <em>Running</em> : null}
                          </strong>
                          <small>
                            {!status
                              ? "Connect a mouse to edit this profile"
                              : saved
                                ? "Saved · applied automatically when this game runs"
                                : "Not saved — pick values or match your mouse"}
                          </small>
                        </div>
                        <div className="bridge-profile-editor">
                          <label className="bridge-field">
                            <span>DPI</span>
                            <select
                              value={dpiValue === null ? "" : String(dpiValue)}
                              disabled={!status}
                              onChange={(event) => {
                                const raw = event.currentTarget.value;
                                if (raw === "") return;
                                void saveGameProfile(game, { dpi: Number(raw), pollingRateHz: pollValue });
                              }}
                            >
                              {dpiValue === null ? <option value="">—</option> : null}
                              {dpiOptions.map((dpi) => <option key={dpi} value={dpi}>{dpi.toLocaleString()}</option>)}
                            </select>
                          </label>
                          <label className="bridge-field">
                            <span>Polling</span>
                            <select
                              value={pollValue === null ? "" : String(pollValue)}
                              disabled={!status}
                              onChange={(event) => {
                                const raw = event.currentTarget.value;
                                if (raw === "") return;
                                void saveGameProfile(game, { dpi: dpiValue, pollingRateHz: Number(raw) });
                              }}
                            >
                              {pollValue === null ? <option value="">—</option> : null}
                              {pollOptions.map((rate) => <option key={rate} value={rate}>{rate.toLocaleString()} Hz</option>)}
                            </select>
                          </label>
                          <button
                            type="button"
                            className="bridge-match"
                            disabled={!status}
                            title="Copy the mouse's current DPI and polling into this profile"
                            onClick={() => void saveGameProfile(game, {
                              dpi: status?.dpi ?? null,
                              pollingRateHz: status?.pollingRateHz ?? null,
                            })}
                          >
                            Match mouse
                          </button>
                          {saved ? (
                            <button
                              type="button"
                              className="is-danger"
                              aria-label={`Delete the ${game.name} profile`}
                              title="Remove this game profile"
                              onClick={() => void deleteProfile(saved)}
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>

                {otherDeviceProfiles.length > 0 ? (
                  <details className="bridge-other-profiles">
                    <summary>{otherDeviceProfiles.length} profile{otherDeviceProfiles.length === 1 ? "" : "s"} for other mice</summary>
                    <div>
                      {otherDeviceProfiles.map((profile) => (
                        <article key={`${profile.application.path}:${profile.device.id}`}>
                          <div>
                            <strong>{profile.application.name}</strong>
                            <small>{profile.device.name} · {profile.settings.dpi ?? "—"} DPI · {profile.settings.pollingRateHz ?? "—"} Hz</small>
                          </div>
                          <button type="button" className="is-danger" onClick={() => void deleteProfile(profile)}>Delete</button>
                        </article>
                      ))}
                    </div>
                  </details>
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
