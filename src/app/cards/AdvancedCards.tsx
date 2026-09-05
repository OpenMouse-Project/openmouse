import { useEffect, useState, type ReactNode } from "react";
import {
  EGG_BUTTON_MAPPINGS,
  EGG_BUTTON_NAMES,
  type EggButtonIndex,
  type EggButtonMapping,
  type EggSpdtMode,
} from "@openmouse/protocol/drivers/endgame/egg-op1-hid";
import {
  RAZER_BUTTON_CONTROLS,
  RAZER_BUTTON_CONTROL_LABEL,
  RAZER_BUTTON_MAPPINGS,
  RAZER_LOCKED_BUTTON_CONTROL,
  RAZER_TOGGLE_CONTROLS,
  RAZER_TOGGLE_CONTROL_INFO,
  type RazerButtonControl,
  type RazerButtonMapping,
  type RazerToggleControl,
} from "@openmouse/protocol/razer";
import { teevolutionSensorModeUi } from "@openmouse/protocol/teevolution";
import * as control from "../../device/controller";
import { PULSAR_SLEEP_OPTIONS } from "../../device/controller";
import { isPulsarProProtocol } from "../../device/traits";
import { selectableValues, sleepLabel, sleepParts, sleepTotalSeconds, KEYCHRON_SLEEP_MAX_HOURS, KEYCHRON_SLEEP_MAX_SECONDS, KEYCHRON_SLEEP_MIN_SECONDS } from "../../device/options";
import type { ControlSnapshot } from "../../device/types";
import { Collapsible, Segmented, SwitchRow } from "../ui";

const SIGNAL_WORDS = ["Very weak", "Weak", "Fair", "Good", "Excellent"];

function KeychronSleepPicker({
  sleepTimeout,
  disabled,
}: {
  sleepTimeout: number;
  disabled: boolean;
}): ReactNode {
  const synced = sleepParts(sleepTimeout);
  const [hours, setHours] = useState(synced.hours);
  const [minutes, setMinutes] = useState(synced.minutes);
  const [seconds, setSeconds] = useState(synced.seconds);

  useEffect(() => {
    const next = sleepParts(sleepTimeout);
    setHours(next.hours);
    setMinutes(next.minutes);
    setSeconds(next.seconds);
  }, [sleepTimeout]);

  const total = sleepTotalSeconds(hours, minutes, seconds);
  const dirty = total !== sleepTimeout;

  function commit(): void {
    if (disabled || !dirty) return;
    if (total < KEYCHRON_SLEEP_MIN_SECONDS) {
      control.reportStatus("The sleep time cannot be less than 1 minute.");
      return;
    }
    if (total > KEYCHRON_SLEEP_MAX_SECONDS) return;
    control.applyPulsarValue("sleep", total);
  }

  function bind(
    value: number,
    setValue: (next: number) => void,
    max: number,
  ) {
    return {
      value,
      disabled,
      min: 0,
      max,
      inputMode: "numeric" as const,
      onChange: (event: { currentTarget: HTMLInputElement }) => {
        const raw = event.currentTarget.value;
        if (raw === "") {
          setValue(0);
          return;
        }
        const next = Number(raw);
        if (!Number.isInteger(next)) return;
        setValue(Math.min(max, Math.max(0, next)));
      },
      onBlur: () => commit(),
      onKeyDown: (event: { key: string; preventDefault: () => void }) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      },
    };
  }

  return (
    <div className="sleep-time-picker" role="group" aria-label="Auto sleep timeout">
      <label>
        <input id="sleep-hours" type="number" aria-label="Hours" {...bind(hours, setHours, KEYCHRON_SLEEP_MAX_HOURS)} />
        <span>h</span>
      </label>
      <span className="sleep-time-sep" aria-hidden="true">:</span>
      <label>
        <input id="sleep-minutes" type="number" aria-label="Minutes" {...bind(minutes, setMinutes, 59)} />
        <span>m</span>
      </label>
      <span className="sleep-time-sep" aria-hidden="true">:</span>
      <label>
        <input id="sleep-seconds" type="number" aria-label="Seconds" {...bind(seconds, setSeconds, 59)} />
        <span>s</span>
      </label>
    </div>
  );
}

export function SignalCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const strength = snapshot.status?.signalStrength;
  const unavailable = strength === null || strength === undefined;
  return (
    <article id="signal-settings" className="setting-card">
      <div className="setting-heading compact">
        <div><p>WIRELESS</p><h2>Signal strength</h2></div>
        <output id="signal-output">{unavailable ? "—" : `${strength}/4`}</output>
      </div>
      <small id="signal-detail" className="setting-note">
        {unavailable ? "Receiver signal is unavailable." : SIGNAL_WORDS[strength] ?? `Level ${strength}`}
      </small>
    </article>
  );
}

export function DebounceCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const max = snapshot.traits.directMode
    ? snapshot.capabilities?.debounceMaxMs ?? 20
    : snapshot.capabilities?.teevolutionProfile?.debounce.max ?? 20;
  const staged = snapshot.pending.keys.includes("debounce");
  return (
    <article id="debounce-settings" className={`setting-card${staged ? " is-staged" : ""}`}>
      <div className="setting-heading compact"><div><p>CLICK</p><h2>Debounce</h2></div></div>
      <select
        id="debounce-select"
        value={status.debounceMs ?? ""}
        disabled={status.debounceMs === null || status.debounceMs === undefined}
        onChange={(event) => control.applyPulsarValue("debounce", Number(event.currentTarget.value))}
      >
        {Array.from({ length: max + 1 }, (_, ms) => <option key={ms} value={ms}>{ms} ms</option>)}
      </select>
    </article>
  );
}

export function SleepCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const { traits, capabilities } = snapshot;
  const keychronSleep = status.ui?.family === "keychron-nape";

  let options: ReadonlyArray<readonly [number, string]> = PULSAR_SLEEP_OPTIONS;
  if (!keychronSleep && traits.directMode) {
    const offered = capabilities?.sleepOptions ?? [10, 30, 60, 300, 600, 1800];
    const seconds = selectableValues(offered, status.sleepTimeout) ?? offered;
    options = seconds.map((value) => [value, sleepLabel(value)] as const);
  } else if (!keychronSleep && capabilities?.razerSleepOptions != null) {
    // Seconds throughout — sleepLabel, the staged command text and
    // setSleepTimeout all read seconds, which Pulsar's option values are not.
    // Sleep and low power are Viper V3 protocol; the legacy Viper Mini driver
    // does not implement them, hence the capability gate rather than a brand test.
    const seconds = selectableValues(capabilities.razerSleepOptions, status.sleepTimeout);
    if (seconds === null) return null;
    options = seconds.map((value) => [value, sleepLabel(value)] as const);
  } else if (!keychronSleep && traits.teevolution && capabilities?.teevolutionProfile && status.connectionType) {
    options = capabilities.teevolutionProfile.sleepOptions.map(
      (value) => [value, sleepLabel(value * 10)] as const,
    );
  }

  const staged = snapshot.pending.keys.includes("sleep");
  const canDisable = traits.directMode && capabilities?.canDisableSleep === true;
  const asleep = status.sleepTimeout !== null && status.sleepTimeout !== undefined;

  return (
    <article id="sleep-settings" className={`setting-card${staged ? " is-staged" : ""}`}>
      <div className="setting-heading compact">
        <div><p>POWER</p><h2>Auto sleep</h2></div>
        {canDisable ? (
          <button
            id="sleep-toggle"
            className="switch-button"
            type="button"
            role="switch"
            aria-checked={asleep}
            style={asleep
              ? { background: "var(--ui-accent)", borderColor: "var(--ui-accent)", color: "var(--ui-accent-ink)" }
              : { background: "#202023", borderColor: "#3a3a3f", color: "#8b8b90" }}
            onClick={() => control.toggleSleep(!asleep)}
          >
            {asleep ? "On" : "Off"}
          </button>
        ) : null}
      </div>
      {keychronSleep && asleep ? (
        <KeychronSleepPicker
          sleepTimeout={status.sleepTimeout!}
          disabled={snapshot.settingsPending}
        />
      ) : (
        <select
          id="sleep-select"
          value={status.sleepTimeout ?? ""}
          disabled={!asleep}
          onChange={(event) => control.applyPulsarValue("sleep", Number(event.currentTarget.value))}
        >
          {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      )}
    </article>
  );
}

export function LowPowerCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const options = snapshot.capabilities?.razerLowPowerOptions;
  const percentages = options == null ? null : selectableValues(options, status?.lowBatteryWarning);
  if (!status || percentages === null) return null;
  const ceiling = snapshot.capabilities?.lowPowerPollingCeiling ?? Infinity;
  // The threshold still reads at any rate; the vendor software just refuses to
  // arm it above this one, so the control is disabled rather than hidden.
  const tooFast = status.pollingRateHz > ceiling;
  const staged = snapshot.pending.keys.includes("low-power");
  return (
    <article id="low-power-settings" className={`setting-card${staged ? " is-staged" : ""}`}>
      <div className="setting-heading compact"><div><p>POWER</p><h2>Low power mode</h2></div></div>
      <select
        id="low-power-select"
        value={status.lowBatteryWarning ?? ""}
        disabled={tooFast}
        onChange={(event) => control.applyLowPowerThreshold(Number(event.currentTarget.value))}
      >
        {percentages.map((value) => <option key={value} value={value}>{value}%</option>)}
      </select>
      <small id="low-power-note" className="setting-note">
        {tooFast
          ? `Unavailable above ${ceiling.toLocaleString()} Hz. Lower the polling rate to change it.`
          : "Slows the mouse down to save battery below this level."}
      </small>
    </article>
  );
}

export function ProcessingCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const ui = status.ui;
  const { traits, capabilities } = snapshot;
  const teevolutionProfile = capabilities?.teevolutionProfile;

  const sensorUi = traits.teevolution && teevolutionProfile && status.connectionType
    ? teevolutionSensorModeUi({
      storedMode: status.sensorModeStored ?? 0,
      pollingRateHz: status.pollingRateHz,
      connection: status.connectionType,
    })
    : null;

  const performanceLabel = status.brand === "CRDRAKO"
    ? "Competitive mode"
    : status.brand === "Teevolution" ? "Highest performance" : "Performance mode";

  // WLMouse calls the same sensor setting High-speed mode in its own tool.
  const hyperLabel = status.brand === "WLMouse" ? "High-speed mode" : "Hyper mode";
  // Pulsar Pro shows the angle with the rest of its Pro-only settings.
  const angleTuning = isPulsarProProtocol(status) ? null : status.angleTuning;

  return (
    <article id="processing-settings" className="setting-card">
      <div className="setting-heading compact"><div><p>SENSOR</p><h2>Processing</h2></div></div>

      {sensorUi && teevolutionProfile ? (
        <div id="teevolution-sensor-mode-row" className="field-label spaced">
          <span>Sensor mode</span>
          <select
            id="teevolution-sensor-mode"
            value={sensorUi.mode}
            disabled={!sensorUi.editable}
            onChange={(event) => control.applyTeevolutionSensorMode(
              event.currentTarget.value as NonNullable<typeof status.sensorMode>,
            )}
          >
            {(["Eco", "High", "Ultra"] as const)
              .filter((mode) => mode === "Ultra" || teevolutionProfile.sensorModes.includes(mode))
              .map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
          <small id="teevolution-sensor-mode-note" className="setting-note">
            {sensorUi.editable
              ? "Eco saves power at 125–1000 Hz wireless. High uses the performance sensor profile."
              : `Locked to ${sensorUi.mode} at ${status.pollingRateHz.toLocaleString()} Hz ${status.connectionType?.toLowerCase()}.`}
          </small>
        </div>
      ) : null}

      <SwitchRow
        id="motion-sync-toggle"
        label="Motion Sync"
        value={status.motionSync}
        hidden={ui?.hideMotionSync === true}
        onChange={(next) => control.applyPulsarToggle("motionSync", next)}
      />
      <SwitchRow
        id="angle-snapping-toggle"
        label="Angle snapping"
        value={status.angleSnapping}
        hidden={ui?.hideAngleSnapping === true || traits.finalmouse}
        onChange={(next) => control.applyPulsarToggle("angleSnapping", next)}
      />
      <SwitchRow
        id="ripple-control-toggle"
        label="Ripple control"
        value={status.rippleControl}
        hidden={ui?.hideRippleControl === true || traits.finalmouse}
        onChange={(next) => control.applyPulsarToggle("rippleControl", next)}
      />
      <SwitchRow
        id="performance-mode-toggle"
        labelId="performance-mode-label"
        label={performanceLabel}
        value={status.performanceMode}
        hidden={status.performanceMode == null || traits.eggFamily || traits.finalmouse}
        onChange={(next) => control.applyPulsarToggle("performanceMode", next)}
      />
      <SwitchRow
        id="hyper-mode-toggle"
        label={hyperLabel}
        value={status.hyperMode}
        hidden={status.hyperMode == null}
        onChange={(next) => control.applyPulsarToggle("hyperMode", next)}
      />
      <SwitchRow
        id="turbo-mode-toggle"
        label="Turbo mode"
        value={status.turboMode}
        hidden={status.turboMode == null}
        disabled={status.hyperMode === false}
        onChange={(next) => control.applyPulsarToggle("turboMode", next)}
      />
      <SwitchRow
        id="button-combination-toggle"
        label="Button combinations"
        value={status.buttonCombination}
        hidden={status.buttonCombination == null}
        onChange={(next) => control.applyPulsarToggle("buttonCombination", next)}
      />
      {angleTuning != null ? (
        <label className="field-label spaced">
          Angle tune
          <select
            id="angle-tune-select"
            value={angleTuning}
            onChange={(event) => control.applyAngleTuning(Number(event.currentTarget.value))}
          >
            {Array.from({ length: 61 }, (_, index) => index - 30).map((angle) => (
              <option key={angle} value={angle}>{angle}°</option>
            ))}
          </select>
        </label>
      ) : null}

      {traits.teevolution && teevolutionProfile ? (
        <label id="teevolution-performance-duration-row" className="field-label spaced">
          Duration
          <select
            id="teevolution-performance-duration"
            value={status.performanceDuration ?? ""}
            disabled={status.performanceMode !== true}
            onChange={(event) => control.applyTeevolutionPerformanceDuration(Number(event.currentTarget.value))}
          >
            {teevolutionProfile.performanceTimeOptions.map((value) => (
              <option key={value} value={value}>{sleepLabel(value * 10)}</option>
            ))}
          </select>
        </label>
      ) : null}
    </article>
  );
}

export function TeevolutionDpiLightingCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const profile = snapshot.capabilities?.teevolutionProfile;
  if (!status || !profile) return null;
  const lightMode = status.dpiLedMode ?? 0;
  const staged = snapshot.pending.keys.some((key) => key.startsWith("teevolution-dpi-light-"));
  return (
    <article
      id="teevolution-dpi-lighting"
      className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key="teevolution-dpi-light-mode teevolution-dpi-light-brightness teevolution-dpi-light-speed"
    >
      <div className="setting-heading compact"><div><p>LIGHTING</p><h2>DPI indicator</h2></div></div>
      <label className="field-label">
        Effect
        <select
          id="teevolution-dpi-light-mode"
          value={lightMode}
          onChange={(event) => control.applyTeevolutionDpiLighting("mode", Number(event.currentTarget.value))}
        >
          {([[0, "Off"], [1, "Steady"], [2, "Breathing"]] as const)
            .filter(([value]) => profile.dpiLighting.modes.includes(value))
            .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <div className="lod-sliders teevolution-dpi-light-controls">
        <label>
          Brightness
          <output id="teevolution-dpi-light-brightness-output">
            {status.dpiLedBrightness == null ? "—" : status.dpiLedBrightness}
          </output>
          <span className="glass-slider-rail">
            <input
              id="teevolution-dpi-light-brightness"
              type="range"
              min={profile.dpiLighting.brightness.min}
              max={profile.dpiLighting.brightness.max}
              step={1}
              value={status.dpiLedBrightness ?? profile.dpiLighting.brightness.min}
              disabled={lightMode !== 1 || status.dpiLedBrightness == null}
              style={{
                "--fill": `${((status.dpiLedBrightness ?? profile.dpiLighting.brightness.min) - profile.dpiLighting.brightness.min)
                  / Math.max(1, profile.dpiLighting.brightness.max - profile.dpiLighting.brightness.min) * 100}%`,
              }}
              onChange={(event) => control.applyTeevolutionDpiLighting("brightness", Number(event.currentTarget.value))}
            />
          </span>
        </label>
        <label>
          Speed
          <output id="teevolution-dpi-light-speed-output">
            {status.dpiLedSpeed == null ? "—" : status.dpiLedSpeed}
          </output>
          <span className="glass-slider-rail">
            <input
              id="teevolution-dpi-light-speed"
              type="range"
              min={profile.dpiLighting.speed.min}
              max={profile.dpiLighting.speed.max}
              step={1}
              value={status.dpiLedSpeed ?? profile.dpiLighting.speed.min}
              disabled={lightMode !== 2 || status.dpiLedSpeed == null}
              style={{
                "--fill": `${((status.dpiLedSpeed ?? profile.dpiLighting.speed.min) - profile.dpiLighting.speed.min)
                  / Math.max(1, profile.dpiLighting.speed.max - profile.dpiLighting.speed.min) * 100}%`,
              }}
              onChange={(event) => control.applyTeevolutionDpiLighting("speed", Number(event.currentTarget.value))}
            />
          </span>
        </label>
      </div>
      <small className="setting-note">Uses the active DPI stage colour stored by the mouse.</small>
    </article>
  );
}

export function NinjutsoSensorCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const disabled = snapshot.settingsPending;
  const systemLocked = status.ninjutsoSystemModes?.length === 2
    && (status.pollingRateHz > 1000 || status.connectionType === "Wired");
  const opticalLocked = status.ninjutsoSystemMode === "Ultra";

  return (
    <article
      id="ninjutso-sensor-settings"
          className="setting-card"
          data-pending-key="ninjutso-system ninjutso-optical"
        >
          <div className="setting-heading"><div><p>NINJAFORCE · SENSOR</p><h2>Sensor performance</h2></div></div>
          {status.ninjutsoSystemModes?.length ? (
            <div id="ninjutso-system-row">
              <div className="setting-heading tight"><div><h2>System mode</h2></div></div>
              <Segmented
                id="ninjutso-system-options"
                className="three"
                ariaLabel="System mode"
                options={status.ninjutsoSystemModes.map((value) => ({ value, label: value }))}
                value={status.ninjutsoSystemMode}
                disabled={disabled || systemLocked}
                onChange={(value) => control.applyNinjutsoSetting("system", value)}
              />
            </div>
          ) : null}
          {status.ninjutsoOpticalEngine ? (
            <div id="ninjutso-optical-row" className="lighting-speed-row">
              <div className="setting-heading tight"><div><h2>Optical Engine</h2></div></div>
              <Segmented
                id="ninjutso-optical-options"
                className="two"
                ariaLabel="Optical Engine"
                options={["Standard", "Burst"].map((value) => ({ value, label: value }))}
                value={status.ninjutsoOpticalEngine}
                disabled={disabled || opticalLocked}
                onChange={(value) => control.applyNinjutsoSetting("optical", value)}
              />
            </div>
          ) : null}
          <small className="setting-note">
            Choose the sensor performance and power profile. Optical Engine is locked while Ultra mode is active.
          </small>
    </article>
  );
}

export function NinjutsoClickCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const disabled = snapshot.settingsPending;
  return (
    <article
      id="ninjutso-click-settings"
          className="setting-card"
          data-pending-key="ninjutso-hyper ninjutso-slam"
        >
          <div className="setting-heading"><div><p>NINJAFORCE · CLICKS</p><h2>Click behavior</h2></div></div>
          <SwitchRow
            id="ninjutso-hyper-toggle"
            label="HyperClick"
            value={status.ninjutsoHyperClick}
            hidden={status.ninjutsoHyperClick == null}
            disabled={disabled}
            onChange={(next) => control.applyNinjutsoSetting("hyper", next)}
          />
          {status.ninjutsoSlamClick ? (
            <div id="ninjutso-slam-row" className="lighting-speed-row">
              <div className="setting-heading tight"><div><h2>Slam-Click</h2></div></div>
              <Segmented
                id="ninjutso-slam-options"
                className="three"
                ariaLabel="Slam-Click"
                options={["Low", "Medium", "High"].map((value) => ({ value, label: value }))}
                value={status.ninjutsoSlamClick}
                disabled={disabled}
                onChange={(value) => control.applyNinjutsoSetting("slam", value)}
              />
            </div>
          ) : null}
          <small className="setting-note">
            HyperClick reduces click latency. Slam-Click controls protection against impact-triggered clicks.
          </small>
    </article>
  );
}

export function FinalmouseCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const staged = snapshot.pending.keys.some((key) => key.startsWith("finalmouse-"));
  return (
    <article
      id="finalmouse-settings"
      className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key="finalmouse-dongle-led finalmouse-tournament-scroll finalmouse-tournament-timeout"
    >
      <div className="setting-heading compact"><div><p>FINALMOUSE</p><h2>Dongle and tournament mode</h2></div></div>
      <label className="field-label">
        Dongle LED
        <select
          id="finalmouse-dongle-led"
          value={status.finalmouseDongleLedMode ?? 0}
          onChange={(event) => control.applyFinalmouseSetting("dongleLed", Number(event.currentTarget.value))}
        >
          <option value={0}>Off</option>
          <option value={1}>Battery indicator</option>
          <option value={2}>Solid white</option>
        </select>
      </label>
      <label className="field-label spaced">
        Tournament scroll
        <select
          id="finalmouse-tournament-scroll"
          value={status.finalmouseTournamentScrollMode ?? 0}
          onChange={(event) => control.applyFinalmouseSetting("tournamentScroll", Number(event.currentTarget.value))}
        >
          <option value={0}>Off</option>
          <option value={1}>Scroll up</option>
          <option value={2}>Scroll down</option>
          <option value={3}>Both directions</option>
        </select>
      </label>
      <label className="field-label spaced">
        Passthrough window
        <select
          id="finalmouse-tournament-timeout"
          value={status.finalmouseTournamentScrollTimeoutMs ?? 100}
          onChange={(event) => control.applyFinalmouseSetting("tournamentTimeout", Number(event.currentTarget.value))}
        >
          <option value={100}>100 ms</option>
          <option value={500}>500 ms</option>
          <option value={1000}>1 second</option>
          <option value={1500}>1.5 seconds</option>
        </select>
      </label>
    </article>
  );
}

export function EggFilterCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  return (
    <article id="egg-filter-settings" className="setting-card">
      <div className="setting-heading compact"><div><p>SENSOR</p><h2>Filters</h2></div></div>
      <SwitchRow
        id="slamclick-filter-toggle"
        label="Slamclick filter"
        value={status.slamclickFilter}
        onChange={(next) => control.applyEggFilter("slamclick", next)}
      />
      <SwitchRow
        id="motion-jitter-filter-toggle"
        label="Motion-jitter filter"
        value={status.motionJitterFilter}
        onChange={(next) => control.applyEggFilter("motionJitter", next)}
      />
    </article>
  );
}

export function EggSpdtCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  return (
    <article id="egg-spdt-settings" className="setting-card">
      <div className="setting-heading compact"><div><p>CLICK</p><h2>GX switch mode</h2></div></div>
      {(["left", "right"] as const).map((side, index) => (
        <label key={side} className={`field-label${index > 0 ? " spaced" : ""}`}>
          {side === "left" ? "Left button" : "Right button"}
          <select
            id={`${side}-spdt-select`}
            value={(side === "left" ? status.leftSpdtMode : status.rightSpdtMode) ?? "Off"}
            onChange={(event) => control.applyEggSpdtMode(side, event.currentTarget.value as EggSpdtMode)}
          >
            {["Off", "GX Safe", "GX Speed"].map((mode) => <option key={mode}>{mode}</option>)}
          </select>
        </label>
      ))}
    </article>
  );
}

export function EggPollingCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const divider = snapshot.eggPollingDivider;

  const valid = divider !== null && Number.isInteger(divider) && divider > 0 && divider <= 255;
  return (
    <Collapsible
      id="egg-polling-settings"
      className="egg-experimental"
      overline="EXPERIMENTAL"
      title="Experimental settings"
      open={snapshot.preferences.expandSections}
    >
      <article className="setting-card egg-form-card">
        <div className="setting-heading"><div><p>POLLING</p><h2>Custom divider</h2></div></div>
        <p className="egg-warning">
          Nonstandard polling dividers may behave differently across firmware versions.
        </p>
        <label>
          8K divider
          <input
            id="egg-polling-divider"
            type="number"
            min={1}
            max={255}
            step={1}
            value={divider ?? ""}
            onChange={(event) => control.setEggPollingDivider(
              event.currentTarget.value === "" ? null : Number(event.currentTarget.value),
            )}
          />
        </label>
        <small id="egg-polling-result" className="setting-note">
          {valid
            ? `Result: ${(8000 / divider).toLocaleString(undefined, { maximumFractionDigits: 2 })} Hz`
            : "Enter a divider from 1 to 255."}
        </small>
        <button
          id="apply-egg-polling"
          className="egg-action-button"
          type="button"
          onClick={() => divider !== null && control.applyEggPollingDivider(divider)}
        >
          Apply divider
        </button>
      </article>
    </Collapsible>
  );
}

function CpiStageRow({
  index,
  stage,
}: {
  index: number;
  stage: { x: number; y: number };
}): ReactNode {
  const [split, setSplit] = useState(stage.x !== stage.y);
  const [x, setX] = useState(stage.x);
  const [y, setY] = useState(stage.y);
  useEffect(() => {
    setSplit(stage.x !== stage.y);
    setX(stage.x);
    setY(stage.y);
  }, [stage.x, stage.y]);
  return (
    <div>
      <strong>Stage {index + 1}</strong>
      <label className="egg-split-toggle">
        <input type="checkbox" checked={split} onChange={(event) => setSplit(event.currentTarget.checked)} />
        {" "}Separate X/Y
      </label>
      <div className="egg-tile-pair">
        <label className="egg-tile-label">
          X
          <input
            className="egg-tile-field"
            type="number"
            min={50}
            max={26000}
            step={50}
            value={x}
            onChange={(event) => setX(Number(event.currentTarget.value))}
          />
        </label>
        <label className="egg-tile-label">
          Y
          <input
            className="egg-tile-field"
            type="number"
            min={50}
            max={26000}
            step={50}
            value={y}
            disabled={!split}
            onChange={(event) => setY(Number(event.currentTarget.value))}
          />
        </label>
      </div>
      <button type="button" onClick={() => control.applyEggCpiStage(index, x, split ? y : x)}>
        Apply stage
      </button>
    </div>
  );
}

export function EggCpiCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const stages = status.eggCpiStages;
  const levels = status.eggCpiLevels ?? 0;
  return (
    <Collapsible
      id="egg-cpi-settings"
      className="egg-collapsible"
      overline="SENSOR"
      title="CPI stages"
      open={snapshot.preferences.expandSections}
    >
      <article className="setting-card">
        <label className="field-label">
          Enabled stages
          <select
            id="egg-cpi-levels"
            value={levels}
            onChange={(event) => control.applyEggCpiLevels(Number(event.currentTarget.value))}
          >
            {[1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>{value} stage{value === 1 ? "" : "s"}</option>
            ))}
          </select>
        </label>
        <div id="egg-cpi-stage-list">
          {stages?.slice(0, levels).map((stage, index) => (
            <CpiStageRow key={index} index={index} stage={stage} />
          ))}
        </div>
      </article>
    </Collapsible>
  );
}

/**
 * Two genuinely different kinds of control share one card.
 *
 * `RAZER_BUTTON_CONTROLS` are cross-assignable to each other's action or
 * Disabled. `RAZER_TOGGLE_CONTROLS` only switch between their own captured
 * factory action and Disabled — cross-assigning those has never been tested on
 * hardware, so the driver does not offer it and neither does this. The two
 * families deliberately share no control names and no option labels, which is
 * what keeps one group's rows from reading the other's state out of the single
 * `razerButtonMappings` dict.
 *
 * Laid out with `button-remap-list`/`button-remap-row` to match
 * `MxMasterButtonsCard`, the other remap card in this same tab.
 */
export function RazerButtonCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const mappings = snapshot.status?.razerButtonMappings;
  if (!mappings) return null;
  const busy = snapshot.settingInProgress;
  const rows: Array<{ key: string; name: string; current: string; options: readonly string[]; locked: boolean }> = [];
  for (const con of RAZER_BUTTON_CONTROLS) {
    const current = mappings[con];
    if (!current) continue;
    rows.push({
      key: `razer-button-${con}`,
      name: RAZER_BUTTON_CONTROL_LABEL[con],
      current,
      options: RAZER_BUTTON_MAPPINGS,
      // Left Click is fixed on the Standard layer — Synapse enforces the same
      // restriction, and the driver throws rather than send it.
      locked: con === RAZER_LOCKED_BUTTON_CONTROL,
    });
  }
  for (const con of RAZER_TOGGLE_CONTROLS) {
    const current = mappings[con];
    if (!current) continue;
    const info = RAZER_TOGGLE_CONTROL_INFO[con];
    rows.push({
      key: `razer-toggle-${con}`,
      name: info.label,
      current,
      options: [info.enabledLabel, "Disabled"],
      locked: false,
    });
  }
  if (rows.length === 0) return null;
  const anyStaged = snapshot.pending.keys.some((key) => key.startsWith("razer-button-") || key.startsWith("razer-toggle-"));
  const lockedName = rows.find((row) => row.locked)?.name;
  return (
    <article id="razer-button-settings" className={`setting-card${anyStaged ? " is-staged" : ""}`}>
      {/*
        No count badge here, unlike MxMasterButtonsCard. Its control count is
        worth showing because it varies per device once virtual and
        firmware-locked controls are filtered out; this set is fixed at seven,
        so a badge would only ever read "7".
      */}
      <div className="setting-heading compact">
        <div><p>BUTTONS</p><h2>Mapping</h2></div>
      </div>
      <div className="button-remap-list">
        {rows.map((row) => {
          const staged = snapshot.pending.keys.includes(row.key);
          const known = row.options.includes(row.current);
          return (
            <label
              key={row.key}
              className={`button-remap-row${staged ? " is-staged" : ""}`}
              data-pending-key={row.key}
            >
              <span>{row.name}</span>
              {row.locked ? <output>{row.current}</output> : (
                <select
                  value={row.current}
                  disabled={busy}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (row.key.startsWith("razer-button-")) {
                      control.applyRazerButtonMapping(
                        row.key.slice("razer-button-".length) as RazerButtonControl,
                        value as RazerButtonMapping,
                      );
                    } else {
                      control.applyRazerToggleControl(
                        row.key.slice("razer-toggle-".length) as RazerToggleControl,
                        value,
                      );
                    }
                  }}
                >
                  {known ? null : <option value={row.current} disabled>{row.current}</option>}
                  {row.options.map((option) => <option key={option}>{option}</option>)}
                </select>
              )}
            </label>
          );
        })}
      </div>
      {lockedName ? (
        <small className="setting-note">
          {lockedName} is fixed on the Standard layer and cannot be reassigned or disabled.
        </small>
      ) : null}
    </article>
  );
}

export function EggButtonCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const filters = status.eggMulticlickFilters;
  const mappings = status.eggButtonMappings;
  if (!filters || !mappings) return null;
  return (
    <Collapsible
      id="egg-button-settings"
      className="egg-collapsible"
      overline="BUTTONS"
      title="Multiclick and mapping"
      open={snapshot.preferences.expandSections}
    >
      <article className="setting-card">
        <div id="egg-button-list">
          {EGG_BUTTON_NAMES.map((name, index) => {
            const gxActive = index === 0
              ? status.leftSpdtMode !== "Off"
              : index === 1 ? status.rightSpdtMode !== "Off" : false;
            const current = mappings[index];
            const known = EGG_BUTTON_MAPPINGS.includes(current as EggButtonMapping);
            return (
              <div key={name}>
                <strong>{name}</strong>
                <label className="egg-tile-label stacked">
                  Multiclick filter
                  <input
                    className="egg-tile-field"
                    type="number"
                    min={0}
                    max={25}
                    step={1}
                    defaultValue={filters[index]}
                    key={`multiclick-${index}-${filters[index]}`}
                    disabled={gxActive}
                    onChange={(event) => control.applyEggMulticlick(
                      index as EggButtonIndex,
                      Number(event.currentTarget.value),
                    )}
                  />
                </label>
                <label className="egg-tile-label stacked">
                  Mapping
                  <select
                    className="egg-tile-field"
                    value={current}
                    onChange={(event) => control.applyEggButtonMapping(
                      index as EggButtonIndex,
                      event.currentTarget.value as EggButtonMapping,
                    )}
                  >
                    {known ? null : <option value={current} disabled>{current}</option>}
                    {EGG_BUTTON_MAPPINGS.map((mapping) => <option key={mapping}>{mapping}</option>)}
                  </select>
                </label>
              </div>
            );
          })}
        </div>
      </article>
    </Collapsible>
  );
}

export function PulsarProCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  return (
    <article id="pulsar-pro-settings" className="setting-card">
      <div className="setting-heading compact"><div><p>PRO</p><h2>Advanced</h2></div></div>
      <SwitchRow
        id="wheel-acceleration-toggle"
        label="Wheel acceleration"
        value={status.wheelAcceleration}
        onChange={(next) => control.applyProSetting("wheelAcceleration", next)}
      />
      <label className="field-label spaced">
        Angle tuning
        <select
          id="angle-tuning-select"
          value={status.angleTuning ?? 0}
          onChange={(event) => control.applyProSetting("angleTuning", Number(event.currentTarget.value))}
        >
          {Array.from({ length: 61 }, (_, index) => index - 30).map((angle) => (
            <option key={angle} value={angle}>{angle}°</option>
          ))}
        </select>
      </label>
      <label className="field-label spaced">
        Onboard profile
        <select
          id="profile-select"
          value={status.activeProfile ?? 1}
          onChange={(event) => control.applyProSetting("profile", Number(event.currentTarget.value))}
        >
          {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>Profile {value}</option>)}
        </select>
      </label>
    </article>
  );
}
