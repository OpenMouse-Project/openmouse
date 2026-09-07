import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  bridgeDevices,
  bridgeGames,
  bridgeHandshake,
  bridgeProfiles,
  bridgeStatus,
  latestRelease,
  saveBridgeBattery,
  saveBridgeProfiles,
  saveBridgeDefaultProfile,
  setBridgeDriver,
  type BridgeBatteryReading,
  type BridgeDevice,
  type BridgeGame,
  type BridgeProfile,
  type BridgeStatus,
  type GitHubRelease,
} from "../bridge";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import { LOCALE_NAME_KEYS, t } from "../i18n";
import type { InterfacePreferences } from "../interface-preferences";
import { Segmented } from "./ui";

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

const ARCH_UDEV_COMMAND = `echo 'KERNEL=="hidraw*", ATTRS{idVendor}=="3554", MODE="0666"' | sudo tee /etc/udev/rules.d/99-openmouse.rules && sudo udevadm control --reload-rules && sudo udevadm trigger`;

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

export function ProfileKeyFields({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const [importText, setImportText] = useState("");
  const [copied, setCopied] = useState(false);
  const locale = snapshot.preferences.locale;
  const key = snapshot.hasActiveDevice ? control.exportProfileKey() : null;

  return (
    <>
      <label className="profile-key-field">
        <span>{t(locale, "set.yourKey")}</span>
        <textarea
          readOnly
          rows={3}
          value={key ?? t(locale, "set.noKey")}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <button
        type="button"
        className="profile-key-action"
        disabled={!key}
        onClick={() => {
          if (!key) return;
          void navigator.clipboard.writeText(key).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? t(locale, "set.copied") : t(locale, "set.copyKey")}
      </button>
      <label className="profile-key-field">
        <span>{t(locale, "set.importKey")}</span>
        <textarea
          rows={3}
          placeholder={t(locale, "set.importPlaceholder")}
          value={importText}
          onChange={(event) => setImportText(event.currentTarget.value)}
        />
      </label>
      <button
        type="button"
        className="profile-key-action"
        disabled={!importText.trim() || !snapshot.hasActiveDevice}
        onClick={() => {
          control.importProfileKey(importText);
          setImportText("");
        }}
      >
        {t(locale, "set.import")}
      </button>
      <small className="setting-note">
        {t(locale, "set.importNote")}
      </small>
    </>
  );
}

function ProfileKeyCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;
  return (
    <article className="interface-setting-card profile-key-card">
      <span>{t(locale, "set.profiles")}</span>
      <h3>{t(locale, "set.profileKey")}</h3>
      <p>{t(locale, "set.profileKeyBody")}</p>
      <ProfileKeyFields snapshot={snapshot} />
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

  const locale = preferences.locale;
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
      setBridgeDeviceBusy((busy) => {
        if (busy === null) setBridgeDeviceList(devices);
        return busy;
      });
      setSelectedGameName((current) => current || status.activeGames[0] || games[0]?.name || "");
      setBridgeMessage("");

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

  const status = snapshot.status;
  const deviceId = status ? `${status.brand}:${status.name}` : "";
  const bridgeConnected = bridge !== null;

  useEffect(() => {
    if (!bridgeConnected || !status) return;
    void saveBridgeDefaultProfile({
      application: { name: status.name, executable: "", path: "" },
      device: { id: deviceId, name: status.name },
      settings: {
        dpi: status.dpi || null,
        pollingRateHz: status.pollingRateHz || null,
      },
    }).catch(() => undefined);
  }, [bridgeConnected, deviceId, status?.dpi, status?.name, status?.pollingRateHz]);

  const isArchLinux = bridge?.linuxDistribution?.split(/\s+/).includes("arch") ?? false;

  return (
    <section
      id="interface-settings-page"
      className={`interface-settings-page${snapshot.interfaceSettingsOpen ? " is-open" : ""}`}
      aria-labelledby="interface-settings-title"
    >
      <header className="interface-settings-header">
        <div>
          <p className="overline">OPENMOUSE</p>
          <h2 id="interface-settings-title">{t(locale, "set.title")}</h2>
        </div>
        <button
          id="close-interface-settings"
          className="interface-settings-back"
          type="button"
          onClick={control.closeInterfaceSettings}
        >
          {t(locale, "set.back")}
        </button>
      </header>

      <div className="interface-settings-grid">
        <ProfileKeyCard snapshot={snapshot} />

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
        </article>

        <article className="interface-setting-card interface-theme-card">
          <span>{t(locale, "set.appearance")}</span>
          <h3>{t(locale, "set.accentTheme")}</h3>
          <p>{t(locale, "set.accentBody")}</p>
          <fieldset id="interface-theme" className="theme-tiles" aria-label={t(locale, "set.accentTheme")}>
            {THEME_CHOICES.map(({ name, accent, canvas, surface }) => (
              <label
                key={name}
                className="theme-tile"
                style={{ "--tile-accent": accent, "--tile-canvas": canvas, "--tile-surface": surface } as React.CSSProperties}
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
            <span>{t(locale, "set.glass")}</span>
            <h3>{t(locale, "set.glassTitle")}</h3>
            <p>{t(locale, "set.glassBody")}</p>
            <div className="glass-intensity-row">
              <span className={`glass-intensity-caption${preferences.glassIntensity <= 25 ? " is-active" : ""}`}>{t(locale, "set.transparent")}</span>
              <span className="glass-slider-rail">
                <input
                  id="interface-glass-intensity"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={preferences.glassIntensity}
                  style={{ "--fill": `${preferences.glassIntensity}%` } as React.CSSProperties}
                  onChange={(event) => set("glassIntensity")(Number(event.currentTarget.value))}
                />
              </span>
              <span className={`glass-intensity-caption${preferences.glassIntensity >= 75 ? " is-active" : ""}`}>{t(locale, "set.acrylic")}</span>
            </div>
          </article>
        ) : null}

        <article id="language-setting" className="interface-setting-card">
          <span>{t(locale, "set.language")}</span>
          <h3>{t(locale, "set.languageTitle")}</h3>
          <p>{t(locale, "set.languageBody")}</p>
          <Segmented
            id="interface-locale"
            ariaLabel={t(locale, "set.languageTitle")}
            value={preferences.locale}
            onChange={(next) => set("locale")(next)}
            options={LOCALE_NAME_KEYS.map(([value, nameKey]) => ({ value, label: t(locale, nameKey) }))}
          />
        </article>

        <SwitchCard
          overline={t(locale, "set.motion")}
          title={t(locale, "set.animations")}
          blurb={t(locale, "set.animationsBody")}
          label={t(locale, "set.enableAnimations")}
          id="interface-reduced-motion"
          checked={!preferences.reducedMotion}
          onChange={(next) => set("reducedMotion")(!next)}
        />
        <SwitchCard
          overline={t(locale, "set.writes")}
          title={t(locale, "set.instantFlash")}
          blurb={t(locale, "set.instantFlashBody")}
          label={t(locale, "set.flashImmediately")}
          id="interface-instant-flash"
          checked={preferences.instantFlash}
          onChange={set("instantFlash")}
        />
        <SwitchCard
          overline={t(locale, "set.sections")}
          title={t(locale, "set.advancedEditors")}
          blurb={t(locale, "set.advancedEditorsBody")}
          label={t(locale, "set.expandByDefault")}
          id="interface-expand-sections"
          checked={preferences.expandSections}
          onChange={set("expandSections")}
        />
        <SwitchCard
          overline={t(locale, "set.experimental")}
          title={t(locale, "set.experimentalTitle")}
          blurb={t(locale, "set.experimentalBody")}
          label={t(locale, "set.showExperimental")}
          id="interface-show-experimental"
          checked={preferences.showExperimental}
          onChange={set("showExperimental")}
        />
      </div>

      {snapshot.previewEnabled && snapshot.previewEntries.length > 0 ? (
        <section id="preview-launcher" className="preview-launcher" aria-labelledby="preview-launcher-title">
          <div className="interface-setting-card">
            <span>{t(locale, "set.dev")}</span>
            <h3 id="preview-launcher-title">{t(locale, "set.previewsTitle")}</h3>
            <p>{t(locale, "set.previewsBody")}</p>
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
        {t(locale, "set.reset")}
      </button>
    </section>
  );
}