import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
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
import type { KsnakeMacroProfile, KsnakeMacroStep } from "@openmouse/protocol/ksnake";
import { isPulsarProProtocol } from "../../device/traits";
import { isNoirKsnakeStatus } from "../../device/noir.ts";
import * as control from "../../device/controller";
import { PULSAR_SLEEP_OPTIONS } from "../../device/controller";
import { selectableValues, sleepLabel, sleepParts, sleepTotalSeconds, valuesWithCurrent, KEYCHRON_SLEEP_MAX_HOURS, KEYCHRON_SLEEP_MAX_SECONDS, KEYCHRON_SLEEP_MIN_SECONDS } from "../../device/options";
import type { ControlSnapshot } from "../../device/types";
import { t, tp } from "../../i18n";
import type { InterfaceLocale } from "../../interface-preferences";
import { Collapsible, OptionMenu, Segmented, StepperSlider, SwitchButton, SwitchRow } from "../ui";

function signalWord(locale: InterfaceLocale, strength: number): string {
  const keys = ["adv.signal0", "adv.signal1", "adv.signal2", "adv.signal3", "adv.signal4"] as const;
  return keys[strength] ? t(locale, keys[strength]) : tp(locale, "adv.signalLevel", { n: strength });
}

function KeychronSleepPicker({
  sleepTimeout,
  disabled,
  locale,
}: {
  sleepTimeout: number;
  disabled: boolean;
  locale: InterfaceLocale;
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
      control.reportStatus(t(locale, "adv.sleepMin"));
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
    <div className="sleep-time-picker" role="group" aria-label={t(locale, "adv.sleepTimeout")}>
      <label>
        <input id="sleep-hours" type="number" aria-label={t(locale, "adv.hours")} {...bind(hours, setHours, KEYCHRON_SLEEP_MAX_HOURS)} />
        <span>h</span>
      </label>
      <span className="sleep-time-sep" aria-hidden="true">:</span>
      <label>
        <input id="sleep-minutes" type="number" aria-label={t(locale, "adv.minutes")} {...bind(minutes, setMinutes, 59)} />
        <span>m</span>
      </label>
      <span className="sleep-time-sep" aria-hidden="true">:</span>
      <label>
        <input id="sleep-seconds" type="number" aria-label={t(locale, "adv.seconds")} {...bind(seconds, setSeconds, 59)} />
        <span>s</span>
      </label>
    </div>
  );
}

export function SignalCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;
  const strength = snapshot.status?.signalStrength;
  const unavailable = strength === null || strength === undefined;
  return (
    <article id="signal-settings" className="setting-card">
      <div className="setting-heading compact">
        <div><p>WIRELESS</p><h2>{t(locale, "adv.signal")}</h2></div>
        <output id="signal-output">{unavailable ? "—" : `${strength}/4`}</output>
      </div>
      <small id="signal-detail" className="setting-note">
        {unavailable ? t(locale, "adv.signalUnavailable") : signalWord(locale, strength ?? 0)}
      </small>
    </article>
  );
}

export function DongleLedCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const staged = snapshot.pending.keys.includes("dongle-led");
  return (
    <article id="dongle-led-settings" className={`setting-card${staged ? " is-staged" : ""}`} data-pending-key="dongle-led">
      <div className="setting-heading compact">
        <div><p>WIRELESS</p><h2>{t(locale, "adv.dongleLed")}</h2></div>
        <SwitchButton
          id="dongle-led-toggle"
          label={t(locale, "adv.dongleLed")}
          value={status.dongleLedEnabled}
          onChange={() => control.toggleDongleLed()}
        />
      </div>
    </article>
  );
}

export function DebounceCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  // F1 Ultimate mirrors the vendor HUB: on/off plus a 0-20 ms slider. The HUB
  // lists 0/1/2/4/8/15/20; the driver accepts the full range and the
  // read-back rejects anything the firmware refuses.
  if (status.atkSensorMode != null && status.debounceMs != null) {
    const ms = status.debounceMs;
    const staged = snapshot.pending.keys.includes("debounce");
    return (
      <article id="debounce-settings" className={`setting-card${staged ? " is-staged" : ""}`}>
        <div className="setting-heading compact"><div><p>CLICK</p><h2>{t(locale, "adv.debounce")}</h2></div></div>
        <StepperSlider
          id="atk-debounce-slider"
          label={t(locale, "adv.debounceDelay")}
          toggle={
            <SwitchRow
              id="atk-debounce-toggle"
              label={t(locale, "adv.keyDebounce")}
              value={ms > 0}
              disabled={snapshot.settingInProgress}
              onChange={(next) => control.applyPulsarValue("debounce", next ? 1 : 0)}
            />
          }
          value={ms}
          min={0}
          max={20}
          step={1}
          scale={["0 ms", "10 ms", "20 ms"]}
          formatValue={(shown) => `${shown} ms`}
          disabled={snapshot.settingInProgress}
          pendingKey="debounce"
          onCommit={(next) => control.applyPulsarValue("debounce", next)}
        />
      </article>
    );
  }
  const max = snapshot.traits.directMode
    ? snapshot.capabilities?.debounceMaxMs ?? 20
    : snapshot.capabilities?.teevolutionProfile?.debounce.max ?? 20;
  const offered = snapshot.capabilities?.debounceOptions;
  const options = offered
    ? valuesWithCurrent([...offered], status.debounceMs)
    : Array.from({ length: max + 1 }, (_, ms) => ms);
  const staged = snapshot.pending.keys.includes("debounce");
  return (
    <article id="debounce-settings" className={`setting-card${staged ? " is-staged" : ""}`}>
      <div className="setting-heading compact"><div><p>CLICK</p><h2>{t(locale, "adv.debounce")}</h2></div></div>
      <OptionMenu
        id="debounce-select"
        ariaLabel={t(locale, "adv.debounce")}
        options={options.map((ms) => ({
          value: ms,
          label: `${ms} ms`,
          disabled: offered != null && !offered.includes(ms),
        }))}
        value={status.debounceMs}
        disabled={status.debounceMs === null || status.debounceMs === undefined}
        onChange={(next) => control.applyPulsarValue("debounce", next)}
      />
    </article>
  );
}

export function SleepCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const { traits, capabilities } = snapshot;
  const keychronSleep = status.ui?.family === "keychron-nape";

  let options: ReadonlyArray<readonly [number, string]> = PULSAR_SLEEP_OPTIONS.map(
  ([value]) => [value, sleepLabel(value * 10, locale)] as const,
  );
  // A driver that publishes its own timeouts wins over the Pulsar-unit default,
  // whether or not it is a direct-mode driver.
  if (!keychronSleep && (traits.directMode || capabilities?.sleepOptions)) {
    const offered = capabilities?.sleepOptions ?? [10, 30, 60, 300, 600, 1800];
    const seconds = selectableValues(offered, status.sleepTimeout) ?? offered;
    options = seconds.map((value) => [value, sleepLabel(value, locale)] as const);
  } else if (!keychronSleep && capabilities?.razerSleepOptions != null) {
    // Seconds throughout — sleepLabel, the staged command text and
    // setSleepTimeout all read seconds, which Pulsar's option values are not.
    // Sleep and low power are Viper V3 protocol; the legacy Viper Mini driver
    // does not implement them, hence the capability gate rather than a brand test.
    const seconds = selectableValues(capabilities.razerSleepOptions, status.sleepTimeout);
    if (seconds === null) return null;
    options = seconds.map((value) => [value, sleepLabel(value, locale)] as const);
  } else if (!keychronSleep && traits.teevolution && capabilities?.teevolutionProfile && status.connectionType) {
    options = capabilities.teevolutionProfile.sleepOptions.map(
      (value) => [value, sleepLabel(value * 10, locale)] as const,
    );
  }

  const staged = snapshot.pending.keys.includes("sleep");
  const canDisable = traits.directMode && capabilities?.canDisableSleep === true;
  const asleep = status.sleepTimeout !== null && status.sleepTimeout !== undefined;

  return (
    <article id="sleep-settings" className={`setting-card${staged ? " is-staged" : ""}`}>
      <div className="setting-heading compact">
        <div><p>POWER</p><h2>{t(locale, "adv.autoSleep")}</h2></div>
        {canDisable ? (
          <SwitchButton
            id="sleep-toggle"
            label={t(locale, "adv.autoSleep")}
            value={asleep}
            onChange={(next) => control.toggleSleep(next)}
          />
        ) : null}
      </div>
      {keychronSleep && asleep ? (
        <KeychronSleepPicker
          sleepTimeout={status.sleepTimeout!}
          disabled={snapshot.settingsPending}
          locale={locale}
        />
      ) : (
        <OptionMenu
          id="sleep-select"
          ariaLabel={t(locale, "adv.sleepTimeout")}
          options={options.map(([value, label]) => ({ value, label }))}
          value={status.sleepTimeout}
          disabled={!asleep}
          onChange={(next) => control.applyPulsarValue("sleep", next)}
        />
      )}
    </article>
  );
}

/** K-snake stores the wheel direction in its persistent config block. */
export function KsnakeScrollCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const locale = snapshot.preferences.locale;
  if (status?.ui?.family !== "ksnake" || status.scrollDirection == null) return null;
  const staged = snapshot.pending.keys.includes("ksnake-scroll-direction");
  return (
    <article id="ksnake-scroll-settings" className={`setting-card${staged ? " is-staged" : ""}`}>
      <div className="setting-heading compact">
        <div><p>{t(locale, "adv.scrollWheel")}</p><h2>{t(locale, "adv.scrollDirection")}</h2></div>
      </div>
      <div className="button-map-list">
        <label className="button-map-row" htmlFor="ksnake-scroll-direction">
          <span className="button-map-control">
            <span className="button-map-index" aria-hidden="true">W</span>
            <span className="button-map-name">{t(locale, "adv.scrollWheel")}</span>
          </span>
          <span className="button-map-connector" aria-hidden="true">to</span>
          <span className="button-map-select-wrap">
            <select
              id="ksnake-scroll-direction"
              value={status.scrollDirection}
              disabled={snapshot.settingsPending}
              onChange={(event) => control.applyKsnakeScrollDirection(
                event.currentTarget.value as NonNullable<typeof status.scrollDirection>,
              )}
            >
              <option value="Forward">{t(locale, "conn.forward")}</option>
              <option value="Reverse">{t(locale, "conn.reverse")}</option>
            </select>
          </span>
        </label>
      </div>
      <small className="setting-note">{t(locale, "adv.scrollStored")}</small>
    </article>
  );
}

export function LowPowerCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const locale = snapshot.preferences.locale;
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
      <div className="setting-heading compact"><div><p>POWER</p><h2>{t(locale, "adv.lowPower")}</h2></div></div>
      <OptionMenu
        id="low-power-select"
        ariaLabel={t(locale, "adv.lowPower")}
        options={percentages.map((value) => ({ value, label: `${value}%` }))}
        value={status.lowBatteryWarning}
        disabled={tooFast}
        onChange={(next) => control.applyLowPowerThreshold(next)}
      />
      <small id="low-power-note" className="setting-note">
        {tooFast
          ? tp(locale, "adv.lowPowerCeiling", { max: ceiling.toLocaleString() })
          : t(locale, "adv.lowPowerNote")}
      </small>
    </article>
  );
}

export function ProcessingCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
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

  const angleSnappingLabel = status.ui?.family === "atk" ? t(locale, "adv.straightLine") : t(locale, "adv.angleSnapping");

  // WLMouse calls the same sensor setting High-speed mode in its own tool.
  const hyperLabel = status.brand === "WLMouse" ? t(locale, "adv.highSpeed") : t(locale, "adv.hyperMode");
  // Pulsar Pro shows the angle with the rest of its Pro-only settings.
  const angleTuning = isPulsarProProtocol(status) ? null : status.angleTuning;

  const performanceLabel = status.brand === "CRDRAKO"
    ? t(locale, "adv.competitive")
    : status.brand === "Teevolution" ? t(locale, "adv.highestPerf") : t(locale, "adv.perfMode");

  return (
    <article id="processing-settings" className="setting-card">
      <div className="setting-heading compact"><div><p>SENSOR</p><h2>{t(locale, "adv.processing")}</h2></div></div>

      {sensorUi && teevolutionProfile ? (
        <div id="teevolution-sensor-mode-row" className="field-label spaced">
          <span>{t(locale, "adv.sensorMode")}</span>
          <OptionMenu
            id="teevolution-sensor-mode"
            ariaLabel={t(locale, "adv.sensorMode")}
            options={(["Eco", "High", "Ultra"] as const)
              .filter((mode) => mode === "Ultra" || teevolutionProfile.sensorModes.includes(mode))
              .map((mode) => ({ value: mode, label: mode }))}
            value={sensorUi.mode}
            disabled={!sensorUi.editable}
            onChange={(next) => control.applyTeevolutionSensorMode(
              next as NonNullable<typeof status.sensorMode>,
            )}
          />
          <small id="teevolution-sensor-mode-note" className="setting-note">
            {sensorUi.editable
              ? t(locale, "adv.ecoNote")
              : tp(locale, "adv.lockedNote", { mode: sensorUi.mode, hz: status.pollingRateHz.toLocaleString(), conn: status.connectionType?.toLowerCase() ?? "" })}
          </small>
        </div>
      ) : null}

      {status.sensorMode != null && !traits.teevolution ? (
        <div id="sensor-mode-row" className="field-label spaced">
          <span>{t(locale, "adv.sensorSampling")}</span>
          <OptionMenu
            id="sensor-mode"
            ariaLabel={t(locale, "adv.sensorSampling")}
            options={(["Eco", "High", "Ultra"] as const).map((mode) => ({ value: mode, label: mode }))}
            value={status.sensorMode}
            disabled={status.sensorModeEditable === false}
            onChange={(next) => control.applySensorMode(
              next as NonNullable<typeof status.sensorMode>,
            )}
          />
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
        label={angleSnappingLabel}
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
      {status.atkAntiMistouchMs != null ? (
        <AtkAntiMistouchControl
          milliseconds={status.atkAntiMistouchMs}
          busy={snapshot.settingInProgress}
          locale={locale}
        />
      ) : null}
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
        label={t(locale, "adv.turboMode")}
        value={status.turboMode}
        hidden={status.turboMode == null}
        disabled={status.hyperMode === false}
        onChange={(next) => control.applyPulsarToggle("turboMode", next)}
      />
      <SwitchRow
        id="button-combination-toggle"
        label={t(locale, "adv.buttonCombos")}
        value={status.buttonCombination}
        hidden={status.buttonCombination == null}
        onChange={(next) => control.applyPulsarToggle("buttonCombination", next)}
      />
      <SwitchRow
        id="long-range-mode-toggle"
        label={t(locale, "adv.ultraRange")}
        value={status.longRangeMode}
        hidden={status.longRangeMode == null}
        onChange={(next) => control.applyPulsarToggle("longRangeMode", next)}
      />
      {angleTuning != null ? (
        status.atkSensorMode != null ? (
          <>
            <StepperSlider
              id="atk-rotation-slider"
              label={t(locale, "adv.sensorRotation")}
              badge={t(locale, "adv.locked")}
              value={0}
              min={-30}
              max={30}
              step={15}
              scale={["−30°", "0°", "+30°"]}
              formatValue={() => "0°"}
              disabled
              pendingKey="atk-rotation"
              onCommit={() => undefined}
            />
            <small className="setting-note">Precise horizontal movement regardless of mouse grip style. Rotation writes touch calibration and stay locked pending a USB capture — calibrate in ATK HUB for now.</small>
          </>
        ) : capabilities?.angleTuningWritable
          ? <AngleTuningControl value={angleTuning} label={t(locale, "adv.angleTune")} />
          : (
            <StepperSlider
              id="angle-tune-slider"
              label={t(locale, "adv.angleTune")}
              value={angleTuning}
              min={-30}
              max={30}
              step={1}
              scale={["−30°", "0°", "+30°"]}
              formatValue={(shown) => `${shown > 0 ? "+" : ""}${shown}°`}
              disabled
              pendingKey="angle-tuning"
              onCommit={() => undefined}
            />
          )
      ) : null}

      {traits.teevolution && teevolutionProfile ? (
        <div id="teevolution-performance-duration-row" className="field-label spaced">
          <span>{t(locale, "adv.duration")}</span>
          <OptionMenu
            id="teevolution-performance-duration"
            ariaLabel={t(locale, "adv.duration")}
            options={teevolutionProfile.performanceTimeOptions.map((value) => ({
              value,
              label: sleepLabel(value * 10, locale),
            }))}
            value={status.performanceDuration ?? null}
            disabled={status.performanceMode !== true}
            onChange={(next) => control.applyTeevolutionPerformanceDuration(next)}
          />
        </div>
      ) : null}
    </article>
  );
}

/**
 * ATK F1 Ultimate scroll anti-mistouch: on/off plus a 100-1000 ms window
 * slider on the line below, mirroring the vendor HUB layout. Verified
 * 100/500 ms on hardware; the driver accepts 10 ms steps.
 */
function AtkAntiMistouchControl({ milliseconds, busy, locale }: { milliseconds: number; busy: boolean; locale: InterfaceLocale }): ReactNode {
  return (
    <StepperSlider
      id="atk-anti-mistouch-slider"
      label={t(locale, "adv.antiMistouchWindow")}
      toggle={
        <SwitchRow
          id="atk-anti-mistouch-toggle"
          label={t(locale, "adv.antiMistouchMode")}
          value={milliseconds > 0}
          disabled={busy}
          onChange={(next) => void control.applyAtkAntiMistouch(next ? 100 : 0)}
        />
      }
      value={Math.max(100, milliseconds)}
      min={100}
      max={1000}
      step={50}
      scale={["100 ms", "500 ms", "1000 ms"]}
      formatValue={(shown) => `${shown} ms`}
      disabled={milliseconds <= 0 || busy}
      pendingKey="atk-anti-mistouch"
      onCommit={(next) => void control.applyAtkAntiMistouch(next)}
    />
  );
}

function AngleTuningControl({ value, label }: { value: number; label: string }): ReactNode {
  const apply = (next: number): void => control.applyAngleTuning(Math.max(-30, Math.min(30, next)));

  return (
    <StepperSlider
      id="angle-tune-slider"
      label={label}
      value={value}
      min={-30}
      max={30}
      step={1}
      scale={["−30°", "0°", "+30°"]}
      formatValue={(shown) => `${shown > 0 ? "+" : ""}${shown}°`}
      pendingKey="angle-tuning"
      onCommit={apply}
    />
  );
}

export function DpiLightingCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const profile = snapshot.capabilities?.teevolutionProfile;
  const hint = status?.ui?.dpiLighting;
  if (!status || (!hint && !profile)) return null;
  const modes = hint?.modes ?? profile!.dpiLighting.modes;
  const brightnessMin = hint?.brightness.at(0) ?? profile!.dpiLighting.brightness.min;
  const brightnessMax = hint?.brightness.at(-1) ?? profile!.dpiLighting.brightness.max;
  const speedMin = hint?.speed.at(0) ?? profile!.dpiLighting.speed.min;
  const speedMax = hint?.speed.at(-1) ?? profile!.dpiLighting.speed.max;
  const locale = snapshot.preferences.locale;
  const lightMode = status.dpiLedMode ?? 0;
  const powerOverview = status.ui?.powerOverview === true;
  const staged = snapshot.pending.keys.some((key) => key.startsWith("teevolution-dpi-light-") || key === "dpi-light-sleep");
  return (
    <article
      id="teevolution-dpi-lighting"
      className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key="teevolution-dpi-light-mode teevolution-dpi-light-brightness teevolution-dpi-light-speed dpi-light-sleep"
    >
      <div className="setting-heading compact"><div><p>{powerOverview ? "POWER" : "LIGHTING"}</p><h2>{t(locale, "adv.dpiIndicator")}</h2></div></div>
      <div className="field-label">
        <span>{t(locale, "adv.effect")}</span>
        <OptionMenu
          id="teevolution-dpi-light-mode"
          ariaLabel={t(locale, "adv.effect")}
          options={([[0, "adv.ledOff"], [1, "adv.ledSteady"], [2, "adv.ledBreathing"]] as const)
            .filter(([value]) => modes.includes(value))
            .map(([value, label]) => ({ value, label: t(locale, label) }))}
          value={lightMode}
          onChange={(next) => control.applyTeevolutionDpiLighting("mode", next)}
        />
      </div>
      <div className="lod-sliders teevolution-dpi-light-controls">
        <label>
          {t(locale, "adv.brightness")}
          <output id="teevolution-dpi-light-brightness-output">
            {status.dpiLedBrightness == null ? "—" : status.dpiLedBrightness}
          </output>
          <span className="glass-slider-rail">
            <input
              id="teevolution-dpi-light-brightness"
              type="range"
              min={brightnessMin}
              max={brightnessMax}
              step={1}
              value={status.dpiLedBrightness ?? brightnessMin}
              disabled={lightMode === 0 || status.dpiLedBrightness == null}
              style={{
                "--fill": `${((status.dpiLedBrightness ?? brightnessMin) - brightnessMin)
                  / Math.max(1, brightnessMax - brightnessMin) * 100}%`,
              }}
              onChange={(event) => control.applyTeevolutionDpiLighting("brightness", Number(event.currentTarget.value))}
            />
          </span>
        </label>
        <label>
          {t(locale, "adv.speed")}
          <output id="teevolution-dpi-light-speed-output">
            {status.dpiLedSpeed == null ? "—" : status.dpiLedSpeed}
          </output>
          <span className="glass-slider-rail">
            <input
              id="teevolution-dpi-light-speed"
              type="range"
              min={speedMin}
              max={speedMax}
              step={1}
              value={status.dpiLedSpeed ?? speedMin}
              disabled={lightMode !== 2 || status.dpiLedSpeed == null}
              style={{
                "--fill": `${((status.dpiLedSpeed ?? speedMin) - speedMin)
                  / Math.max(1, speedMax - speedMin) * 100}%`,
              }}
              onChange={(event) => control.applyTeevolutionDpiLighting("speed", Number(event.currentTarget.value))}
            />
          </span>
        </label>
      </div>
      {hint?.sleepTimeouts?.length && status.dpiLedSleepTimeout != null ? (
        <div className="field-label spaced">
          <span>{t(locale, "adv.autoSleep")}</span>
          <OptionMenu
            id="dpi-light-sleep-timeout"
            ariaLabel={t(locale, "adv.autoSleep")}
            options={hint.sleepTimeouts.map((seconds) => ({
              value: seconds,
              label: sleepLabel(seconds, locale),
            }))}
            value={status.dpiLedSleepTimeout}
            onChange={(next) => control.applyDpiLightingSleepTimeout(next)}
          />
        </div>
      ) : null}
      <small className="setting-note">{t(locale, "adv.dpiStageNote")}</small>
    </article>
  );
}

/** @deprecated Kept as an import alias for integrations built before generic DPI lighting. */
export const TeevolutionDpiLightingCard = DpiLightingCard;

export function NinjutsoSensorCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
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
          <div className="setting-heading"><div><p>NINJAFORCE · SENSOR</p><h2>{t(locale, "adv.sensorPerf")}</h2></div></div>
          {status.ninjutsoSystemModes?.length ? (
            <div id="ninjutso-system-row">
              <div className="setting-heading tight"><div><h2>{t(locale, "adv.systemMode")}</h2></div></div>
              <Segmented
                id="ninjutso-system-options"
                className="three"
                ariaLabel={t(locale, "adv.systemMode")}
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
            {t(locale, "adv.opticalNote")}
          </small>
    </article>
  );
}

export function NinjutsoClickCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const disabled = snapshot.settingsPending;
  return (
    <article
      id="ninjutso-click-settings"
          className="setting-card"
          data-pending-key="ninjutso-hyper ninjutso-slam"
        >
          <div className="setting-heading"><div><p>NINJAFORCE · CLICKS</p><h2>{t(locale, "adv.clickBehavior")}</h2></div></div>
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
            {t(locale, "adv.clickNote")}
          </small>
    </article>
  );
}

export function IncottCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const staged = snapshot.pending.keys.some((key) => key.startsWith("incott-"));
  const times = status.incottFireKeyTimes ?? 1;
  const interval = status.incottFireKeyIntervalMs ?? 0;
  return (
    <article
      id="incott-settings"
      className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key="incott-receiver-led incott-fire-key"
    >
      <div className="setting-heading compact">
        <div><p>INCOTT</p><h2>{t(locale, "adv.receiverRapidFire")}</h2></div>
      </div>
      {/* Absent over the cable: there is no dongle to light up. */}
      {status.incottReceiverLedMode != null ? (
        <div className="field-label">
          <span>{t(locale, "adv.dongleLed")}</span>
          <OptionMenu
            id="incott-receiver-led"
            ariaLabel={t(locale, "adv.dongleLed")}
            options={[
              { value: 0, label: t(locale, "adv.ledConnectRate") },
              { value: 1, label: t(locale, "adv.ledBatteryStatus") },
              { value: 2, label: t(locale, "adv.ledBatteryWarning") },
            ]}
            value={status.incottReceiverLedMode}
            onChange={(next) => control.applyIncottReceiverLed(next)}
          />
        </div>
      ) : null}
      {status.incottFireKeyTimes != null ? (
        <>
          <div className="field-label spaced">
            <span>{t(locale, "adv.fireKeyTimes")}</span>
            <OptionMenu
              id="incott-fire-key-times"
              ariaLabel={t(locale, "adv.fireKeyTimes")}
              options={[
                // 0 is not "off": it fires continuously while the button is
                // held and stops on release.
                { value: 0, label: t(locale, "adv.fireKeyHold") },
                { value: 1, label: "1" },
                { value: 2, label: "2" },
                { value: 3, label: "3" },
              ]}
              value={times}
              onChange={(next) => control.applyIncottFireKey(next, interval)}
            />
          </div>
          <label className="field-label spaced">
            {t(locale, "adv.fireKeyInterval")}
            <input
              id="incott-fire-key-interval"
              type="number"
              min={0}
              max={255}
              step={1}
              value={interval}
              onChange={(event) => control.applyIncottFireKey(times, Number(event.currentTarget.value))}
            />
          </label>
        </>
      ) : null}
    </article>
  );
}

export function FinalmouseCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const staged = snapshot.pending.keys.some((key) => key.startsWith("finalmouse-"));
  return (
    <article
      id="finalmouse-settings"
      className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key="finalmouse-dongle-led finalmouse-tournament-scroll finalmouse-tournament-timeout"
    >
      <div className="setting-heading compact"><div><p>FINALMOUSE</p><h2>{t(locale, "adv.dongleTournament")}</h2></div></div>
      <div className="field-label">
        <span>{t(locale, "adv.dongleLed")}</span>
        <OptionMenu
          id="finalmouse-dongle-led"
          ariaLabel={t(locale, "adv.dongleLed")}
          options={[
            { value: 0, label: t(locale, "adv.ledOff") },
            { value: 1, label: t(locale, "adv.batteryIndicator") },
            { value: 2, label: t(locale, "adv.solidWhite") },
          ]}
          value={status.finalmouseDongleLedMode ?? 0}
          onChange={(next) => control.applyFinalmouseSetting("dongleLed", next)}
        />
      </div>
      <div className="field-label spaced">
        <span>{t(locale, "adv.tournamentScroll")}</span>
        <OptionMenu
          id="finalmouse-tournament-scroll"
          ariaLabel={t(locale, "adv.tournamentScroll")}
          options={[
            { value: 0, label: t(locale, "adv.ledOff") },
            { value: 1, label: t(locale, "adv.scrollUp") },
            { value: 2, label: t(locale, "adv.scrollDown") },
            { value: 3, label: t(locale, "adv.bothDirections") },
          ]}
          value={status.finalmouseTournamentScrollMode ?? 0}
          onChange={(next) => control.applyFinalmouseSetting("tournamentScroll", next)}
        />
      </div>
      <div className="field-label spaced">
        <span>{t(locale, "adv.passthrough")}</span>
        <OptionMenu
          id="finalmouse-tournament-timeout"
          ariaLabel={t(locale, "adv.passthrough")}
          options={[
            { value: 100, label: "100 ms" },
            { value: 500, label: "500 ms" },
            { value: 1000, label: t(locale, "adv.oneSecond") },
            { value: 1500, label: t(locale, "adv.halfSeconds") },
          ]}
          value={status.finalmouseTournamentScrollTimeoutMs ?? 100}
          onChange={(next) => control.applyFinalmouseSetting("tournamentTimeout", next)}
        />
      </div>
    </article>
  );
}

export function EggFilterCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  return (
    <article id="egg-filter-settings" className="setting-card">
      <div className="setting-heading compact"><div><p>SENSOR</p><h2>{t(locale, "adv.filters")}</h2></div></div>
      <SwitchRow
        id="slamclick-filter-toggle"
        label={t(locale, "adv.slamclickFilter")}
        value={status.slamclickFilter}
        onChange={(next) => control.applyEggFilter("slamclick", next)}
      />
      <SwitchRow
        id="motion-jitter-filter-toggle"
        label={t(locale, "adv.jitterFilter")}
        value={status.motionJitterFilter}
        onChange={(next) => control.applyEggFilter("motionJitter", next)}
        hidden={status.motionJitterFilter == null}
      />
      <SwitchRow
        id="egg-glass-mode-toggle"
        label={t(locale, "adv.glassMode")}
        value={status.eggGlassMode}
        onChange={(next) => control.applyEggGlassMode(next)}
        hidden={status.eggSupportsGlassMode !== true}
      />
    </article>
  );
}

export function EggSpdtCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  return (
    <article id="egg-spdt-settings" className="setting-card">
      <div className="setting-heading compact"><div><p>CLICK</p><h2>{t(locale, "adv.gxMode")}</h2></div></div>
      {(["left", "right"] as const).map((side, index) => {
        const label = side === "left" ? t(locale, "adv.leftButton") : t(locale, "adv.rightButton");
        return (
          <div key={side} className={`field-label${index > 0 ? " spaced" : ""}`}>
            <span>{label}</span>
            <OptionMenu
              id={`${side}-spdt-select`}
              ariaLabel={label}
              options={["Off", "GX Safe", "GX Speed"].map((mode) => ({ value: mode, label: mode }))}
              value={(side === "left" ? status.leftSpdtMode : status.rightSpdtMode) ?? "Off"}
              onChange={(next) => control.applyEggSpdtMode(side, next as EggSpdtMode)}
            />
          </div>
        );
      })}
    </article>
  );
}

export function EggPollingCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;
  const divider = snapshot.eggPollingDivider;

  const valid = divider !== null && Number.isInteger(divider) && divider > 0 && divider <= 255;
  return (
    <Collapsible
      id="egg-polling-settings"
      className="egg-experimental"
      overline={t(locale, "set.experimental")}
      title={t(locale, "set.experimentalTitle")}
      open={snapshot.preferences.expandSections}
    >
      <article className="setting-card egg-form-card">
        <div className="setting-heading"><div><p>POLLING</p><h2>{t(locale, "adv.dividerTitle")}</h2></div></div>
        <p className="egg-warning">
          {t(locale, "adv.dividerWarning")}
        </p>
        <label>
          {t(locale, "adv.divider8k")}
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
            ? tp(locale, "adv.dividerResult", { hz: (8000 / divider).toLocaleString(undefined, { maximumFractionDigits: 2 }) })
            : t(locale, "adv.dividerHint")}
        </small>
        <button
          id="apply-egg-polling"
          className="egg-action-button"
          type="button"
          onClick={() => divider !== null && control.applyEggPollingDivider(divider)}
        >
          {t(locale, "adv.applyDivider")}
        </button>
      </article>
    </Collapsible>
  );
}

function CpiStageRow({
  index,
  stage,
  locale,
}: {
  index: number;
  stage: { x: number; y: number };
  locale: InterfaceLocale;
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
      <strong>{tp(locale, "adv.stage", { n: index + 1 })}</strong>
      <label className="egg-split-toggle">
        <input type="checkbox" checked={split} onChange={(event) => setSplit(event.currentTarget.checked)} />
        {" "}{t(locale, "adv.separateXY")}
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
        {t(locale, "adv.applyStage")}
      </button>
    </div>
  );
}

export function EggCpiCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const stages = status.eggCpiStages;
  const levels = status.eggCpiLevels ?? 0;
  return (
    <Collapsible
      id="egg-cpi-settings"
      className="egg-collapsible"
      overline="SENSOR"
      title={t(locale, "adv.cpiStages")}
      open={snapshot.preferences.expandSections}
    >
      <article className="setting-card">
        <div className="field-label">
          <span>{t(locale, "adv.enabledStages")}</span>
          <OptionMenu
            id="egg-cpi-levels"
            ariaLabel={t(locale, "adv.enabledStages")}
            options={[1, 2, 3, 4].map((value) => ({
              value,
              label: tp(locale, "adv.stageCount", { n: value, s: value === 1 ? "" : "s" }),
            }))}
            value={levels}
            onChange={(next) => control.applyEggCpiLevels(next)}
          />
        </div>
        <div id="egg-cpi-stage-list">
          {stages?.slice(0, levels).map((stage, index) => (
            <CpiStageRow key={index} index={index} stage={stage} locale={locale} />
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
  const locale = snapshot.preferences.locale;
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
        <div><p>BUTTONS</p><h2>{t(locale, "adv.mapping")}</h2></div>
      </div>
      <div className="button-remap-list">
        {rows.map((row) => {
          const staged = snapshot.pending.keys.includes(row.key);
          const known = row.options.includes(row.current);
          const applyRazerRow = (value: string): void => {
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
          };
          return (
            <div
              key={row.key}
              className={`button-remap-row${staged ? " is-staged" : ""}`}
              data-pending-key={row.key}
            >
              <span>{row.name}</span>
              {row.locked ? <output>{row.current}</output> : (
                <OptionMenu
                  id={row.key}
                  ariaLabel={row.name}
                  options={[
                    ...(known ? [] : [{ value: row.current, label: row.current, disabled: true }]),
                    ...row.options.map((option) => ({ value: option, label: option })),
                  ]}
                  value={row.current}
                  disabled={busy}
                  onChange={applyRazerRow}
                />
              )}
            </div>
          );
        })}
      </div>
      {lockedName ? (
        <small className="setting-note">
          {tp(locale, "adv.razerLocked", { name: lockedName })}
        </small>
      ) : null}
    </article>
  );
}

export function EggButtonCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const filters = status.eggMulticlickFilters;
  const mappings = status.eggButtonMappings;
  if (!filters || !mappings) return null;
  return (
    <Collapsible
      id="egg-button-settings"
      className="egg-collapsible"
      overline="BUTTONS"
      title={t(locale, "adv.eggButtonTitle")}
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
                  {t(locale, "adv.multiclick")}
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
                <div className="egg-tile-label stacked">
                  <span>{t(locale, "adv.mapping")}</span>
                  <OptionMenu
                    id={`egg-button-${index}`}
                    ariaLabel={`${name} ${t(locale, "adv.mapping")}`}
                    options={[
                      ...(known ? [] : [{ value: current, label: current, disabled: true }]),
                      ...EGG_BUTTON_MAPPINGS.map((mapping) => ({ value: mapping, label: mapping })),
                    ]}
                    value={current}
                    onChange={(next) => control.applyEggButtonMapping(
                      index as EggButtonIndex,
                      next as EggButtonMapping,
                    )}
                  />
                </div>
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
  const locale = snapshot.preferences.locale;
  return (
    <article id="pulsar-pro-settings" className="setting-card">
      <div className="setting-heading compact"><div><p>PRO</p><h2>{t(locale, "adv.proAdvanced")}</h2></div></div>
      <SwitchRow
        id="wheel-acceleration-toggle"
        label={t(locale, "adv.wheelAccel")}
        value={status.wheelAcceleration}
        onChange={(next) => control.applyProSetting("wheelAcceleration", next)}
      />
      <div className="field-label spaced">
        <span>{t(locale, "adv.angleTuning")}</span>
        <OptionMenu
          id="angle-tuning-select"
          ariaLabel={t(locale, "adv.angleTuning")}
          options={Array.from({ length: 61 }, (_, index) => index - 30).map((angle) => ({
            value: angle,
            label: `${angle}°`,
          }))}
          value={status.angleTuning ?? 0}
          onChange={(next) => control.applyProSetting("angleTuning", next)}
        />
      </div>
      <div className="field-label spaced">
        <span>{t(locale, "adv.onboardProfile")}</span>
        <OptionMenu
          id="profile-select"
          ariaLabel={t(locale, "adv.onboardProfile")}
          options={[1, 2, 3, 4, 5, 6].map((value) => ({
            value,
            label: tp(locale, "adv.profileOpt", { n: value }),
          }))}
          value={status.activeProfile ?? 1}
          onChange={(next) => control.applyProSetting("profile", next)}
        />
      </div>
    </article>
  );
}

/**
 * Numbered onboard profiles, for devices that expose a plain set the user can
 * switch between. Driven entirely by `profileCount` / `activeProfile`, so it
 * stays brand-agnostic — unlike the Logitech onboard-profile editor, which
 * edits profile *contents* rather than just selecting one.
 */
export function OnboardProfileCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status || !status.profileCount || status.activeProfile == null) return null;
  const locale = snapshot.preferences.locale;
  return (
    <article id="onboard-profile-settings" className="setting-card">
      <div className="setting-heading compact"><div><h2>{t(locale, "prof.onboardTitle")}</h2></div></div>
      <div className="field-label spaced">
        <span>{t(locale, "prof.activeProfile")}</span>
        <OptionMenu
          id="onboard-profile-select"
          ariaLabel={t(locale, "prof.activeProfile")}
          options={Array.from({ length: status.profileCount }, (_, index) => index + 1).map((value) => ({
            value,
            // Devices that store their own names show them; the rest number.
            label: status.profileNames?.[value - 1] ?? tp(locale, "adv.profileOpt", { n: value }),
          }))}
          value={status.activeProfile}
          onChange={(next) => control.applyProfileSelection(next)}
        />
      </div>
      <p className="field-note">
        {t(locale, "prof.profileStores")}
      </p>
    </article>
  );
}

const KSNAKE_MACRO_TYPES: ReadonlyArray<readonly [KsnakeMacroStep["type"], string]> = [
  [1, "Modifier"],
  [2, "Keyboard"],
  [3, "Mouse"],
];

const KSNAKE_MACRO_ACTIONS: ReadonlyArray<readonly [KsnakeMacroStep["action"], string]> = [
  [1, "Press"],
  [2, "Release"],
];

const KSNAKE_KEY_LABELS: Readonly<Record<number, string>> = {
  0: "None",
  4: "A", 5: "B", 6: "C", 7: "D", 8: "E", 9: "F", 10: "G", 11: "H", 12: "I", 13: "J",
  14: "K", 15: "L", 16: "M", 17: "N", 18: "O", 19: "P", 20: "Q", 21: "R", 22: "S", 23: "T",
  24: "U", 25: "V", 26: "W", 27: "X", 28: "Y", 29: "Z",
  40: "Enter", 41: "Escape", 42: "Backspace", 43: "Tab", 44: "Space",
  79: "Right", 80: "Left", 81: "Down", 82: "Up",
  58: "F1", 59: "F2", 60: "F3", 61: "F4", 62: "F5", 63: "F6",
  64: "F7", 65: "F8", 66: "F9", 67: "F10", 68: "F11", 69: "F12",
};

const KSNAKE_MOUSE_LABELS: Readonly<Record<number, string>> = {
  0: "None",
  1: "Left button",
  2: "Right button",
  4: "Middle button",
  8: "Back button",
  16: "Forward button",
};

const KSNAKE_MODIFIER_LABELS: Readonly<Record<number, string>> = {
  1: "Left Ctrl", 2: "Left Shift", 4: "Left Alt", 8: "Left GUI",
  16: "Right Ctrl", 32: "Right Shift", 64: "Right Alt", 128: "Right GUI",
};

const KSNAKE_MODIFIER_BY_EVENT_CODE: Readonly<Record<string, number>> = {
  ControlLeft: 1,
  ShiftLeft: 2,
  AltLeft: 4,
  MetaLeft: 8,
  OSLeft: 8,
  ControlRight: 16,
  ShiftRight: 32,
  AltRight: 64,
  MetaRight: 128,
  OSRight: 128,
};

const KSNAKE_KEY_CODE_BY_EVENT_CODE: Readonly<Record<string, number>> = {
  ...Object.fromEntries("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter, index) => [`Key${letter}`, 4 + index])),
  ...Object.fromEntries(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((digit, index) => [`Digit${digit}`, 30 + index])),
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  Space: 44,
  Minus: 45,
  Equal: 46,
  BracketLeft: 47,
  BracketRight: 48,
  Backslash: 49,
  Semicolon: 51,
  Quote: 52,
  Backquote: 53,
  Comma: 54,
  Period: 55,
  Slash: 56,
  CapsLock: 57,
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, 58 + index])),
  PrintScreen: 70,
  ScrollLock: 71,
  Pause: 72,
  Insert: 73,
  Home: 74,
  PageUp: 75,
  Delete: 76,
  End: 77,
  PageDown: 78,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  NumLock: 83,
  NumpadDivide: 84,
  NumpadMultiply: 85,
  NumpadSubtract: 86,
  NumpadAdd: 87,
  NumpadEnter: 88,
  ...Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`Numpad${index + 1}`, 89 + index])),
  Numpad0: 98,
  NumpadDecimal: 99,
};

const KSNAKE_MOUSE_CODE_BY_BUTTON: Readonly<Record<number, number>> = {
  0: 1,
  1: 4,
  2: 2,
  3: 8,
  4: 16,
};

function ksnakeMacroCodeLabel(type: KsnakeMacroStep["type"], code: number): string {
  if (type === 1) return KSNAKE_MODIFIER_LABELS[code] ?? `Modifier mask ${code}`;
  if (type === 2) return KSNAKE_KEY_LABELS[code] ?? `Keyboard code ${code}`;
  return KSNAKE_MOUSE_LABELS[code] ?? `Mouse code ${code}`;
}

function ksnakeMacroStepFromKeyboard(
  event: KeyboardEvent,
  action: KsnakeMacroStep["action"],
): KsnakeMacroStep | null {
  const modifier = KSNAKE_MODIFIER_BY_EVENT_CODE[event.code];
  if (modifier !== undefined) return { type: 1, action, delayMs: 0, code: modifier };
  const code = KSNAKE_KEY_CODE_BY_EVENT_CODE[event.code];
  return code === undefined ? null : { type: 2, action, delayMs: 0, code };
}

function ksnakeMacroStepFromMouse(
  button: number,
  action: KsnakeMacroStep["action"],
): KsnakeMacroStep | null {
  const code = KSNAKE_MOUSE_CODE_BY_BUTTON[button];
  return code === undefined ? null : { type: 3, action, delayMs: 0, code };
}

function ksnakeMacroStepLabel(step: KsnakeMacroStep): string {
  return `${step.action === 1 ? "Press" : "Release"} · ${ksnakeMacroCodeLabel(step.type, step.code)}`;
}

type KsnakeMacroTimingMode = "no-delay" | "recorded" | "fixed";

function applyKsnakeMacroTiming(
  steps: readonly KsnakeMacroStep[],
  timingMode: KsnakeMacroTimingMode,
  fixedDelayMs: number,
): KsnakeMacroStep[] {
  return steps.map((step) => ({
    ...step,
    delayMs: timingMode === "no-delay"
      ? 0
      : timingMode === "fixed"
        ? fixedDelayMs
        : step.delayMs,
  }));
}

function cloneKsnakeMacroProfile(profile: KsnakeMacroProfile | undefined): KsnakeMacroProfile {
  return { steps: (profile?.steps ?? []).map((step) => ({ ...step })) };
}

/**
 * Onboard macro editor for the shared K-snake/M2-NEX protocol. The physical
 * button assignment remains in ButtonMappingCard; this card edits the macro
 * slot that an assignment points at.
 */
export function KsnakeMacroCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const locale = snapshot.preferences.locale;
  const isNoirKsnake = isNoirKsnakeStatus(status);
  const macroCapable = status?.ui?.family === "ksnake" || isNoirKsnake;
  // Keep the card usable while an older hot-reloaded controller snapshot is
  // still missing the newly added field. Treat that state as "not loaded" so
  // the local editor is prepared instead of silently hiding the card.
  const profiles = snapshot.ksnakeMacros ?? null;
  const [slot, setSlot] = useState(0);
  const [draft, setDraft] = useState<KsnakeMacroProfile | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [timingMode, setTimingMode] = useState<KsnakeMacroTimingMode>("no-delay");
  const [fixedDelayMs, setFixedDelayMs] = useState(10);
  const [recordedSteps, setRecordedSteps] = useState<KsnakeMacroStep[]>([]);
  const recordedStepsRef = useRef<KsnakeMacroStep[]>([]);
  const recordingOriginalStepsRef = useRef<KsnakeMacroStep[] | null>(null);
  const recordingClockRef = useRef<number | null>(null);
  const recorderFocusRef = useRef<HTMLElement | null>(null);
  const staged = snapshot.pending.keys.includes("ksnake-macros");
  const disabled = snapshot.settingInProgress || snapshot.pending.busy;
  const controlsDisabled = disabled || isRecording;

  useEffect(() => {
    if (profiles) setDraft(cloneKsnakeMacroProfile(profiles[slot]));
  }, [profiles, slot]);

  useEffect(() => {
    if (macroCapable
      && profiles === null
      && !snapshot.ksnakeMacrosLoading
      && snapshot.ksnakeMacrosError === null) {
      control.loadKsnakeMacros();
    }
  }, [macroCapable, profiles, snapshot.ksnakeMacrosLoading, snapshot.ksnakeMacrosError]);

  const appendRecordedStep = (step: KsnakeMacroStep): void => {
    const now = performance.now();
    const previous = recordingClockRef.current;
    recordingClockRef.current = now;
    const delayMs = previous === null
      ? 0
      : Math.min(65535, Math.max(0, Math.round(now - previous)));
    const next = [...recordedStepsRef.current];
    // M2-NEX interprets the delay stored on an event as the pause after that
    // event. The interval measured before the new event therefore belongs to
    // the previously recorded step, not to the new step itself.
    if (next.length > 0 && previous !== null) {
      next[next.length - 1] = { ...next[next.length - 1], delayMs };
    }
    next.push({ ...step, delayMs: 0 });
    recordedStepsRef.current = next;
    setRecordedSteps(next);
  };

  const finishRecording = (): void => {
    const next = applyKsnakeMacroTiming(recordedStepsRef.current, timingMode, fixedDelayMs);
    setIsRecording(false);
    setDraft({ steps: next });
    setRecordedSteps([]);
    recordedStepsRef.current = [];
    recordingOriginalStepsRef.current = null;
    recordingClockRef.current = null;
  };

  const cancelRecording = (): void => {
    const original = recordingOriginalStepsRef.current ?? [];
    setIsRecording(false);
    setDraft({ steps: original.map((step) => ({ ...step })) });
    setRecordedSteps([]);
    recordedStepsRef.current = [];
    recordingOriginalStepsRef.current = null;
    recordingClockRef.current = null;
  };

  const changeTimingMode = (next: KsnakeMacroTimingMode): void => {
    setTimingMode(next);
    // Apply the selected preset to an existing draft as well, so switching to
    // Fast or Fixed does not require recording the same macro again.
    if (!isRecording && next !== "recorded" && draft) {
      setDraft({ steps: applyKsnakeMacroTiming(draft.steps, next, fixedDelayMs) });
    }
  };

  const changeFixedDelay = (value: string): void => {
    const next = Math.min(65535, Math.max(0, Number(value) || 0));
    setFixedDelayMs(next);
    if (!isRecording && timingMode === "fixed" && draft) {
      setDraft({ steps: applyKsnakeMacroTiming(draft.steps, "fixed", next) });
    }
  };

  const startRecording = (): void => {
    if (disabled || isRecording || !draft) return;
    recordingOriginalStepsRef.current = draft.steps.map((step) => ({ ...step }));
    recordedStepsRef.current = [];
    setRecordedSteps([]);
    recordingClockRef.current = performance.now();
    setIsRecording(true);
  };

  useEffect(() => {
    if (!isRecording) return undefined;

    // The Record button keeps focus after it is clicked. Keyboard events then
    // target that button, and the recorder-control guard (correctly) ignores
    // them as UI input. Move focus to a neutral capture surface so the first
    // physical key pressed after starting a recording is captured.
    recorderFocusRef.current?.focus();

    const isRecorderControl = (target: EventTarget | null): boolean => (
      target instanceof Element && Boolean(target.closest("[data-macro-recorder-control]"))
    );

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isRecorderControl(event.target)) return;
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finishRecording();
        return;
      }
      if (event.repeat) return;
      const step = ksnakeMacroStepFromKeyboard(event, 1);
      if (!step) return;
      event.preventDefault();
      event.stopPropagation();
      appendRecordedStep(step);
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (isRecorderControl(event.target)) return;
      const step = ksnakeMacroStepFromKeyboard(event, 2);
      if (!step) return;
      event.preventDefault();
      event.stopPropagation();
      appendRecordedStep(step);
    };

    const onMouseDown = (event: MouseEvent): void => {
      if (isRecorderControl(event.target)) return;
      const step = ksnakeMacroStepFromMouse(event.button, 1);
      if (!step) return;
      event.preventDefault();
      event.stopPropagation();
      appendRecordedStep(step);
    };

    const onMouseUp = (event: MouseEvent): void => {
      if (isRecorderControl(event.target)) return;
      const step = ksnakeMacroStepFromMouse(event.button, 2);
      if (!step) return;
      event.preventDefault();
      event.stopPropagation();
      appendRecordedStep(step);
    };

    const onContextMenu = (event: MouseEvent): void => {
      if (isRecorderControl(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [isRecording]);

  if (!status || !macroCapable) return null;

  const updateStep = (index: number, change: Partial<KsnakeMacroStep>): void => {
    setDraft((current) => current
      ? { steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...change } : step) }
      : current);
  };
  const addStep = (): void => {
    setDraft((current) => current
      ? { steps: [...current.steps, { type: 2, action: 1, delayMs: 0, code: 0 }] }
      : current);
  };
  const removeStep = (index: number): void => {
    setDraft((current) => current
      ? { steps: current.steps.filter((_, stepIndex) => stepIndex !== index) }
      : current);
  };

  if (snapshot.ksnakeMacrosLoading) {
    return (
      <article id="ksnake-macro-settings" className="setting-card">
        <div className="setting-heading compact"><div><p>{t(locale, "macro.overline")}</p><h2>{t(locale, "macro.build")}</h2></div></div>
        <p className="field-note">{t(locale, "macro.loading")}</p>
      </article>
    );
  }

  if (snapshot.ksnakeMacrosError !== null) {
    return (
      <article id="ksnake-macro-settings" className="setting-card">
        <div className="setting-heading compact"><div><p>{t(locale, "macro.overline")}</p><h2>{t(locale, "macro.build")}</h2></div></div>
        <p className="field-note">{snapshot.ksnakeMacrosError}</p>
        <div className="setting-action"><button type="button" onClick={() => control.loadKsnakeMacros()}>{t(locale, "set.retry")}</button></div>
      </article>
    );
  }

  if (!profiles || !draft) return null;
  return (
    <article id="ksnake-macro-settings" className={`setting-card${staged ? " is-staged" : ""}`}>
      <div className="setting-heading ksnake-macro-heading">
        <div>
          <p>{t(locale, "macro.overline")}</p>
          <h2>{t(locale, "macro.build")}</h2>
          <p className="ksnake-macro-lead">{t(locale, "macro.lead")}</p>
        </div>
      </div>
      <p className="ksnake-macro-notice">
        {isNoirKsnake ? t(locale, "macro.noticeWriteOnly") : t(locale, "macro.notice")}
      </p>
      <label className="ksnake-macro-slot-picker">
        <span>{t(locale, "macro.slotLabel")}</span>
        <select value={slot} disabled={controlsDisabled} onChange={(event) => setSlot(Number(event.currentTarget.value))}>
          {profiles.map((profile, index) => {
            const stepCount = index === slot
              ? (isRecording ? recordedSteps.length : draft.steps.length)
              : profile.steps.length;
            return <option key={index} value={index}>{t(locale, "macro.option")} {index + 1}{stepCount ? ` · ${tp(locale, "macro.steps", { n: stepCount })}` : ` · ${t(locale, "macro.empty")}`}</option>;
          })}
        </select>
      </label>
      <section
        ref={recorderFocusRef}
        className={`ksnake-macro-recorder${isRecording ? " is-recording" : ""}`}
        aria-live="polite"
        aria-label="Macro input capture"
        tabIndex={-1}
      >
        <div className="ksnake-macro-recorder-status">
          <span className="ksnake-macro-recorder-dot" aria-hidden="true" />
          <div>
            <strong>{isRecording ? t(locale, "macro.recording") : t(locale, "macro.addActions")}</strong>
            <span>{isRecording
              ? tp(locale, "macro.eventsHint", { n: recordedSteps.length })
              : t(locale, "macro.recorderHint")}</span>
          </div>
        </div>
        <div className="ksnake-macro-recorder-tools">
          <label className="ksnake-macro-timing-picker">
            <span>{t(locale, "macro.timing")}</span>
            <select
              value={timingMode}
              disabled={disabled || isRecording}
              data-macro-recorder-control
              onChange={(event) => changeTimingMode(event.currentTarget.value as KsnakeMacroTimingMode)}
            >
              <option value="no-delay">{t(locale, "macro.timingFast")}</option>
              <option value="recorded">{t(locale, "macro.timingRecorded")}</option>
              <option value="fixed">{t(locale, "macro.timingFixed")}</option>
            </select>
          </label>
          {timingMode === "fixed" ? (
            <label className="ksnake-macro-fixed-delay-picker">
              <span>{t(locale, "macro.delay")}</span>
              <span className="ksnake-macro-fixed-delay-control">
                <input
                  type="number"
                  min={0}
                  max={65535}
                  step={1}
                  aria-label={t(locale, "macro.delayAria")}
                  value={fixedDelayMs}
                  disabled={disabled || isRecording}
                  data-macro-recorder-control
                  onChange={(event) => changeFixedDelay(event.currentTarget.value)}
                />
                <small>ms</small>
              </span>
            </label>
          ) : null}
          {isRecording ? (
            <div className="ksnake-macro-recorder-actions">
              <button className="ksnake-macro-stop" type="button" data-macro-recorder-control onClick={finishRecording}>{t(locale, "macro.stopRecording")}</button>
              <button className="ksnake-macro-cancel" type="button" data-macro-recorder-control onClick={cancelRecording}>{t(locale, "set.cancel")}</button>
            </div>
          ) : (
            <div className="ksnake-macro-recorder-actions">
              <button className="ksnake-macro-record" type="button" data-macro-recorder-control onClick={startRecording} disabled={disabled}>{t(locale, "macro.recordInput")}</button>
              <button className="ksnake-macro-manual-add" type="button" data-macro-recorder-control onClick={addStep} disabled={controlsDisabled}>
                <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
                {t(locale, "macro.addManually")}
              </button>
            </div>
          )}
        </div>
      </section>
      {isRecording ? (
        <div className="ksnake-macro-recording-list">
          <div className="ksnake-macro-recording-list-heading">
            <span>{t(locale, "macro.liveEvents")}</span>
            <span>{tp(locale, "macro.events", { n: recordedSteps.length })}</span>
          </div>
          {recordedSteps.length === 0 ? (
            <p className="ksnake-macro-recording-empty">{t(locale, "macro.recordingEmpty")}</p>
          ) : (
            <ol>
              {recordedSteps.map((step, index) => (
                <li key={`${slot}-recording-${index}`}>
                  <span className="ksnake-macro-recording-step-number">{String(index + 1).padStart(2, "0")}</span>
                  <strong>{ksnakeMacroStepLabel(step)}</strong>
                  <small>{timingMode === "no-delay"
                    ? "Fast"
                    : timingMode === "fixed"
                      ? `${fixedDelayMs} ms`
                      : step.delayMs > 0
                        ? `After +${step.delayMs} ms`
                        : index === recordedSteps.length - 1 ? "Waiting…" : "Next"}</small>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <div className="ksnake-macro-steps">
          {draft.steps.length === 0 ? (
            <div className="ksnake-macro-empty">
              <strong>{t(locale, "macro.noActions")}</strong>
              <span>{t(locale, "macro.noActionsHint")}</span>
            </div>
          ) : null}
          {draft.steps.map((step, index) => (
            <div className="ksnake-macro-step" key={`${slot}-${index}`}>
              <span className="ksnake-macro-step-number">{String(index + 1).padStart(2, "0")}</span>
              <label className="ksnake-macro-step-field">
                <span>{t(locale, "macro.colInput")}</span>
                <select
                  aria-label={`Macro ${slot + 1} step ${index + 1} type`}
                  value={step.type}
                  disabled={controlsDisabled}
                  onChange={(event) => updateStep(index, { type: Number(event.currentTarget.value) as KsnakeMacroStep["type"] })}
                >
                  {KSNAKE_MACRO_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="ksnake-macro-step-field">
                <span>{t(locale, "macro.colAction")}</span>
                <select
                  aria-label={`Macro ${slot + 1} step ${index + 1} action`}
                  value={step.action}
                  disabled={controlsDisabled}
                  onChange={(event) => updateStep(index, { action: Number(event.currentTarget.value) as KsnakeMacroStep["action"] })}
                >
                  {KSNAKE_MACRO_ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="ksnake-macro-number ksnake-macro-code-field">{t(locale, "macro.colCode")}
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={step.code}
                  disabled={controlsDisabled}
                  onChange={(event) => updateStep(index, { code: Math.min(255, Math.max(0, Number(event.currentTarget.value) || 0)) })}
                />
              </label>
              <label className="ksnake-macro-number ksnake-macro-delay-field">{t(locale, "macro.colDelay")}
                <input
                  type="number"
                  min={0}
                  max={65535}
                  value={step.delayMs}
                  disabled={controlsDisabled}
                  onChange={(event) => updateStep(index, { delayMs: Math.min(65535, Math.max(0, Number(event.currentTarget.value) || 0)) })}
                />
              </label>
              <small className="ksnake-macro-preview" title={ksnakeMacroCodeLabel(step.type, step.code)}>{ksnakeMacroCodeLabel(step.type, step.code)}</small>
              <button type="button" className="ksnake-macro-delete" disabled={controlsDisabled} onClick={() => removeStep(index)} aria-label={tp(locale, "macro.removeStep", { n: index + 1 })} title={t(locale, "macro.removeStepTitle")}>
                <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="setting-action ksnake-macro-actions">
        <button className="ksnake-macro-save" type="button" onClick={() => control.applyKsnakeMacro(slot, draft)} disabled={controlsDisabled}>
          <Save size={16} strokeWidth={2.2} aria-hidden="true" />
          {t(locale, "macro.save")}
        </button>
        <button className="ksnake-macro-clear" type="button" onClick={() => setDraft({ steps: [] })} disabled={controlsDisabled || draft.steps.length === 0}>{t(locale, "macro.clearSlot")}</button>
      </div>
      <details className="ksnake-macro-help">
        <summary>{t(locale, "macro.helpToggle")}</summary>
        <p>{t(locale, "macro.helpBody")}</p>
      </details>
    </article>
  );
}

/**
 * Button remapping for drivers that publish a plain name -> action map. Stays
 * brand-agnostic: the driver supplies both the button list and the vocabulary,
 * so nothing here knows what a given mouse can do.
 */
export function ButtonMappingCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status?.buttonMappings || !status.buttonOptions?.length) return null;
  const locale = snapshot.preferences.locale;
  const options = status.buttonOptions;
  const isNoirProfile = isNoirKsnakeStatus(status)
    && snapshot.m2nexProfiles !== null;
  const selectedM2NexProfile = isNoirProfile
    ? snapshot.m2nexProfiles?.[snapshot.activeM2NexProfile]
    : null;
  const canResetKsnake = isNoirProfile;
  const mappings = selectedM2NexProfile?.buttonMappings ?? status.buttonMappings;
  const pendingButtons = new Set(snapshot.pending.keys);
  const resettingButtons = pendingButtons.has("ksnake-button-reset");
  // fixedButtons lands with mouse-protocol#68; read defensively so this
  // builds against the published protocol until then.
  const fixed = new Set((status as unknown as { fixedButtons?: readonly string[] }).fixedButtons ?? []);
  return (
    <article id="button-mapping-settings" className="setting-card">
      <div className="setting-heading compact"><div><p>BUTTONS</p><h2>{t(locale, "map.remap")}</h2></div></div>
      <div className="button-map-list">
        {Object.entries(status.buttonMappings).map(([button, deviceAssigned], index) => {
          const assigned = resettingButtons || pendingButtons.has(`button-${button}`)
            ? status.buttonMappings?.[button] ?? mappings[button] ?? deviceAssigned
            : mappings[button] ?? deviceAssigned;
          const selectId = `button-${button.toLowerCase()}-select`;
          const isFixed = fixed.has(button) || (isNoirKsnakeStatus(status) && button === "Left");
          return (
            <label key={button} className={`button-map-row${isFixed ? " is-fixed" : ""}`} htmlFor={selectId}>
              <span className="button-map-control">
                <span className="button-map-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <span className="button-map-name">{button}</span>
              </span>
              <span className="button-map-connector" aria-hidden="true">to</span>
              <span className="button-map-select-wrap">
                <select
                  id={selectId}
                  value={options.includes(assigned) ? assigned : ""}
                  disabled={isFixed}
                  onChange={(event) => {
                    // M2-NEX edits its selected local profile slot; every other
                    // driver writes straight through to the device.
                    if (selectedM2NexProfile) {
                      control.updateM2NexProfileButton(button, event.currentTarget.value);
                      return;
                    }
                    control.applyDeviceButtonMapping(button, event.currentTarget.value);
                  }}
                >
                  {/* A macro or an assignment this build cannot name still shows. */}
                  {!options.includes(assigned) && <option value="">{assigned}</option>}
                  {options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </span>
            </label>
          );
        })}
      </div>
      {canResetKsnake ? (
        <div className="button-map-footer">
          <button
            type="button"
            className="button-map-reset"
            disabled={snapshot.settingInProgress || snapshot.pending.busy}
            onClick={control.resetKsnakeButtonMappings}
          >
            Reset to default
          </button>
        </div>
      ) : null}
      {!selectedM2NexProfile ? (
        <p className="field-note">{t(locale, "map.defaultNote")}</p>
      ) : null}
    </article>
  );
}

/**
 * A device's named power/performance modes, plus sensor angle tuning where it
 * offers one. Driven entirely by what the driver reports, so it stays
 * brand-agnostic.
 */
/** A device's named power/performance modes. */
export function PowerModeCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const modes = status.powerModes;
  if (!modes?.length) return null;
  return (
    <article id="power-mode-settings" className="setting-card">
      <div className="setting-heading compact"><div><p>SENSOR</p><h2>{t(locale, "pow.mode")}</h2></div></div>
      <Segmented
        className={modes.length === 3 ? "three" : undefined}
        ariaLabel={t(locale, "pow.perfMode")}
        options={modes.map((mode) => ({ value: mode, label: mode }))}
        value={status.powerMode ?? modes[0]!}
        onChange={(next) => control.applyPowerMode(String(next))}
      />
    </article>
  );
}
