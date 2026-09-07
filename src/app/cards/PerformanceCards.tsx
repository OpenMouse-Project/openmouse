import { useEffect, useState, type ReactNode } from "react";
import {
  BUNNY_HOP_LIMITS,
  capabilitiesForFormat,
  clampBunnyHopMs,
  reportRatesFor,
} from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import * as control from "../../device/controller";
import { RATE_STEPS_HZ } from "../../device/controller";
import type { ControlSnapshot, LiftOffLevel } from "../../device/types";
import { t, tp } from "../../i18n";
import type { InterfaceLocale } from "../../interface-preferences";
import { RateSlider, Segmented, SwitchButton } from "../ui";

const LOD_LEVELS: readonly LiftOffLevel[] = ["Low", "Medium", "High"];

function lodLabel(locale: InterfaceLocale, level: LiftOffLevel): string {
  return level === "Low" ? t(locale, "perf.lodLow") : level === "Medium" ? t(locale, "perf.lodMedium") : t(locale, "perf.lodHigh");
}

export function PollingCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const staged = snapshot.pending.keys.includes("polling-rate");
  const entry = snapshot.profile.entry;
  const rates = snapshot.profileFormat ? capabilitiesForFormat(snapshot.profileFormat.id).reportRates : null;
  const perProfile = entry !== null && rates !== null;
  const locked = snapshot.profileFormat?.writable !== true;
  const shared = (snapshot.profileFormat?.id ?? 6) < 6;

  const advertisedRates = (status.supportedPollingRates ?? RATE_STEPS_HZ)
    .filter((rate) => !(snapshot.traits.eggControls && rate < 1000))
    .slice()
    .sort((a, b) => a - b);

  const note = perProfile && rates
    ? shared
      ? tp(locale, "perf.sharedNote", { max: snapshot.profile.rateOptions.wired.at(-1)?.toLocaleString() ?? "—" })
      : tp(locale, "perf.splitNote", {
        wireless: reportRatesFor(rates, "wireless").at(-1)?.toLocaleString() ?? "—",
        wired: reportRatesFor(rates, "wired").at(-1)?.toLocaleString() ?? "—",
      })
    : status.ui?.pollingNote
      ?? (snapshot.traits.eggControls ? t(locale, "perf.eggNote") : t(locale, "perf.note"));

  return (
    <article id="polling-card" className={`setting-card${staged ? " is-staged" : ""}`} data-pending-key="polling-rate">
      <div className="setting-heading">
        <div>
          <div className="title-row">
            <h2>
              {t(locale, "perf.reportFrequency")}
              {snapshot.editedProfile !== null ? (
                <span className="setting-scope" id="rate-scope-badge">{perProfile ? t(locale, "dpi.perProfile") : "Host"}</span>
              ) : null}
            </h2>
            <p>POLLING RATE</p>
          </div>
          <small id="polling-note" className="setting-note">{note}</small>
        </div>
        {!perProfile ? (
          <output id="polling-value">{status.pollingRateHz.toLocaleString()} Hz</output>
        ) : null}
      </div>

      {perProfile && entry ? (
        <div id="profile-rate-rows">
          {(shared ? (["wired"] as const) : (["wireless", "wired"] as const)).map((link) => (
            <RateSlider
              key={link}
              locale={locale}
              id={`profile-rate-${link}`}
              options={snapshot.profile.rateOptions[link]}
              valueHz={snapshot.stagedProfileRates[link]
                ?? (link === "wired" ? entry.reportRateWired : entry.reportRateWireless)}
              label={shared ? t(locale, "perf.allConnections") : link === "wired" ? t(locale, "perf.wired") : t(locale, "perf.wireless")}
              disabled={locked || snapshot.settingInProgress}
              onChange={(hz) => control.setProfileReportRate(link, hz)}
            />
          ))}
        </div>
      ) : (
        <RateSlider
          id="host-rate-slider"
          locale={locale}
          options={advertisedRates}
          valueHz={status.pollingRateHz}
          disabled={snapshot.settingsPending || status.ui?.pollingReadOnly === true}
          bubble={false}
          onChange={control.applyPollingRate}
        />
      )}
    </article>
  );
}

function AsymmetricLiftOff({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const pair = snapshot.status?.asymmetricLiftOff;
  const locale = snapshot.preferences.locale;
  const [liftOff, setLiftOff] = useState(pair?.liftOff ?? 0);
  const [landing, setLanding] = useState(pair?.landing ?? 0);
  useEffect(() => {
    if (!pair) return;
    setLiftOff(pair.liftOff);
    setLanding(pair.landing);
  }, [pair?.liftOff, pair?.landing]);
  if (!pair) return null;

  /**
   * Landing is bounded by lift-off on the device, and the vendor software caps
   * its own slider the same way. The firmware stores an inverted pair without
   * complaint, so nothing downstream would catch it — make it unexpressible.
   *
   * Clamp the value, never the range: a range input positions its thumb
   * relative to its own bounds, so narrowing `max` slid the thumb across the
   * track whenever lift-off moved even though the number had not changed.
   */
  const ceiling = Math.max(pair.landingRange.min, liftOff - 1);
  const cappedLanding = Math.min(landing, ceiling);
  const liftSpan = Math.max(1, pair.liftOffRange.max - pair.liftOffRange.min);
  const landSpan = Math.max(1, pair.landingRange.max - pair.landingRange.min);

  return (
    <div id="lod-asymmetric" className="lod-sliders">
      <label>
        {t(locale, "perf.liftOffLabel")}
        <output id="lod-lift-off-value">{liftOff}</output>
        <span className="glass-slider-rail">
          <input
            id="lod-lift-off"
            type="range"
            min={pair.liftOffRange.min}
            max={pair.liftOffRange.max}
            step={1}
            value={liftOff}
            disabled={snapshot.settingsPending}
            style={{ "--fill": `${((liftOff - pair.liftOffRange.min) / liftSpan) * 100}%` }}
            onChange={(event) => setLiftOff(Number(event.currentTarget.value))}
            onPointerUp={() => control.applyAsymmetricLiftOff(liftOff, cappedLanding)}
            onKeyUp={() => control.applyAsymmetricLiftOff(liftOff, cappedLanding)}
          />
        </span>
      </label>
      <label>
        {t(locale, "perf.landing")}
        <output id="lod-landing-value">{cappedLanding}</output>
        <span className="glass-slider-rail">
          <input
            id="lod-landing"
            type="range"
            min={pair.landingRange.min}
            max={pair.landingRange.max}
            step={1}
            value={cappedLanding}
            disabled={snapshot.settingsPending}
            style={{ "--fill": `${((cappedLanding - pair.landingRange.min) / landSpan) * 100}%` }}
            onChange={(event) => setLanding(Number(event.currentTarget.value))}
            onPointerUp={() => control.applyAsymmetricLiftOff(liftOff, cappedLanding)}
            onKeyUp={() => control.applyAsymmetricLiftOff(liftOff, cappedLanding)}
          />
        </span>
      </label>
    </div>
  );
}

export function SensorCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const ui = status.ui;
  const pair = status.asymmetricLiftOff;
  const showPair = pair?.enabled === true;
  const slotsAvailable = snapshot.profile.slotsAvailable;
  const lodNeedsSurface = ui?.lodRequiresSurface === true && status.gamingSurfaceMode === "Off";
  const supportedLods = status.supportedLiftOffDistances;

  const staged = snapshot.pending.keys.some((key) => key === "lift-off-distance" || key === "gaming-surface");

  return (
    <article
      className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key="lift-off-distance gaming-surface"
    >
      {status.gamingSurfaceMode ? (
        <div id="gaming-surface-row">
          <div className="setting-heading"><div><h2>{t(locale, "perf.gamingSurface")}</h2></div></div>
          <Segmented
            className="three"
            ariaLabel={t(locale, "perf.gamingSurface")}
            options={(["On", "Off", "Auto"] as const).map((mode) => ({
              value: mode,
              label: mode === "Auto" ? t(locale, "perf.auto") : mode === "On" ? t(locale, "common.on") : t(locale, "common.off"),
            }))}
            value={status.gamingSurfaceMode}
            disabled={snapshot.settingsPending}
            onChange={control.applyGamingSurfaceMode}
          />
          <small className="setting-note">
            {t(locale, "perf.surfaceNote")}
          </small>
        </div>
      ) : null}

      {slotsAvailable ? null : (
        <div id="host-lod-row">
          <div className="setting-heading">
            <div>
              <div className="title-row">
                <h2>{t(locale, "perf.liftOff")}</h2>
                <p>SENSOR</p>
              </div>
              <small id="lod-note" className="setting-note">
                {lodNeedsSurface ? t(locale, "perf.lodNeedSurface") : t(locale, "perf.lodNote")}
              </small>
            </div>
          </div>
          {pair ? (
            <div id="lod-mode-row" className="lod-mode">
              <Segmented
                className="two"
                ariaLabel={t(locale, "perf.liftOffMode")}
                options={[
                  { value: "single", label: t(locale, "perf.single") },
                  { value: "asymmetric", label: t(locale, "perf.asymmetric") },
                ]}
                value={pair.enabled === null ? null : showPair ? "asymmetric" : "single"}
                disabled={snapshot.settingsPending}
                onChange={control.applyLiftOffMode}
              />
            </div>
          ) : null}

          {pair && showPair ? (
            <AsymmetricLiftOff snapshot={snapshot} />
          ) : status.liftOffScale ? (
            <LiftOffScale snapshot={snapshot} />
          ) : (
            <div id="lod-single">
              <Segmented
                className="three"
                ariaLabel={t(locale, "perf.liftOff")}
                options={LOD_LEVELS.map((level) => {
                  const hideLow = level === "Low" && (snapshot.traits.eggFamily || ui?.hideLodLow === true);
                  const unsupported = Array.isArray(supportedLods) && !supportedLods.includes(level);
                  const legacyLogitechLow = snapshot.traits.logitech
                    && !Array.isArray(supportedLods)
                    && level === "Low";
                  return {
                    value: level,
                    label: lodLabel(locale, level),
                    hidden: hideLow || unsupported,
                    disabled: snapshot.settingsPending || legacyLogitechLow || lodNeedsSurface,
                  };
                })}
                value={status.liftOffDistance}
                onChange={control.applyLiftOffDistance}
              />
            </div>
          )}
        </div>
      )}
    </article>
  );
}


/**
 * Lift-off for a mouse that reports a continuous range instead of the three
 * shared stops. The slider works in raw device codes and labels them with the
 * millimetres the driver supplies, so no scale is hard-coded here.
 */
function LiftOffScale({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const scale = snapshot.status?.liftOffScale;
  const [code, setCode] = useState(scale?.value ?? 0);

  useEffect(() => {
    if (scale) setCode(scale.value);
  }, [scale?.value]);

  if (!scale) return null;

  const span = Math.max(1, scale.max - scale.min);
  const millimetres = scale.minMillimetres
    + ((code - scale.min) * (scale.maxMillimetres - scale.minMillimetres)) / span;

  return (
    <div id="lod-scale" className="lod-sliders">
      <label>
        Lift-off
        <output id="lod-scale-value">{millimetres.toFixed(1)} mm</output>
        <span className="glass-slider-rail">
          <input
            id="lod-scale-input"
            type="range"
            min={scale.min}
            max={scale.max}
            step={1}
            value={code}
            disabled={snapshot.settingsPending}
            style={{ "--fill": `${((code - scale.min) / span) * 100}%` }}
            onChange={(event) => setCode(Number(event.currentTarget.value))}
            onPointerUp={() => control.applyLiftOffScale(code)}
            onKeyUp={() => control.applyLiftOffScale(code)}
          />
        </span>
      </label>
    </div>
  );
}

function BunnyHop({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const entry = snapshot.profile.entry;
  if (!snapshot.profile.bunnyHopSupported || !entry) return null;
  const locale = snapshot.preferences.locale;

  const locked = snapshot.profileFormat?.writable !== true;
  // Support is a property of the format, not of the stored value: a profile
  // that never had bunny hop written reads 0xff and decodes to null, which
  // means off, not unsupported.
  const value = snapshot.stagedBunnyHopMs ?? entry.bunnyHoppingMs ?? 0;
  const enabled = value !== 0;

  return (
    <div id="bunny-hop-row">
      <div className="setting-heading">
        <div><h2>{t(locale, "perf.bunnyHop")}<span className="setting-scope">{t(locale, "dpi.perProfile")}</span></h2></div>
      </div>
      <div className="bunny-hop-controls">
        <SwitchButton
          id="bunny-hop-enabled"
          value={enabled}
          label={t(locale, "perf.bunnyHop")}
          disabled={locked || snapshot.settingInProgress}
          onChange={(next) => control.applyBunnyHopMs(next ? BUNNY_HOP_LIMITS.minMs : 0)}
        />
        <input
          id="bunny-hop-input"
          type="number"
          min={BUNNY_HOP_LIMITS.minMs}
          max={BUNNY_HOP_LIMITS.maxMs}
          step={BUNNY_HOP_LIMITS.stepMs}
          defaultValue={enabled ? value : BUNNY_HOP_LIMITS.minMs}
          key={`bunny-${enabled ? value : BUNNY_HOP_LIMITS.minMs}`}
          disabled={locked || snapshot.settingInProgress || !enabled}
          aria-label={t(locale, "perf.bunnyTime")}
          // "change" not "input": a number field fires it on blur or Enter, so a
          // value is not staged on every keystroke. min/max/step only gate the
          // spinner, not typing, so the typed value is snapped into range here.
          onChange={(event) => control.applyBunnyHopMs(clampBunnyHopMs(Number(event.currentTarget.value)))}
        />
        <span>ms</span>
      </div>
      <small className="setting-note" id="bunny-hop-note">
        {locked
          ? t(locale, "perf.bunnyReadonly")
          : tp(locale, "perf.bunnyNote", { min: BUNNY_HOP_LIMITS.minMs, max: BUNNY_HOP_LIMITS.maxMs, step: BUNNY_HOP_LIMITS.stepMs })}
      </small>
    </div>
  );
}

export function LightforceCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const staged = snapshot.pending.keys.includes("lightforce-switch-mode");
  return (
    <article
      id="lightforce-card"
      className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key="lightforce-switch-mode"
    >
      <div className="setting-heading"><div><p>SWITCHES</p><h2>LightForce</h2></div></div>
      <Segmented
        ariaLabel={t(locale, "perf.lightforceMode")}
        options={[
          { value: "Hybrid", label: t(locale, "perf.hybrid") },
          { value: "Optical", label: t(locale, "perf.opticalOnly") },
        ]}
        value={status.lightforceSwitchMode}
        disabled={snapshot.settingsPending}
        onChange={control.applyLightforceSwitchMode}
      />
      <small className="setting-note">
        {t(locale, "perf.lightforceNote")}
      </small>
      <BunnyHop snapshot={snapshot} />
    </article>
  );
}
