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
import { RateSlider, Segmented, SwitchButton } from "../ui";

const LOD_LEVELS: readonly LiftOffLevel[] = ["Low", "Medium", "High"];

export function PollingCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
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
      ? `Stored in this profile as one shared interval, up to ${snapshot.profile.rateOptions.wired.at(-1)?.toLocaleString()} Hz.`
      : `Stored in this profile, one rate per link. Up to ${
        reportRatesFor(rates, "wireless").at(-1)?.toLocaleString()} Hz wireless, ${
        reportRatesFor(rates, "wired").at(-1)?.toLocaleString()} Hz over the cable.`
    : status.ui?.pollingNote
      ?? (snapshot.traits.eggControls
        ? "Higher rates update cursor movement more often and increase CPU/USB processing load."
        : "Higher rates update cursor movement more often, but use more battery.");

  return (
    <article id="polling-card" className={`setting-card${staged ? " is-staged" : ""}`} data-pending-key="polling-rate">
      <div className="setting-heading">
        <div>
          <p>POLLING RATE</p>
          <h2>
            Report frequency
            {snapshot.editedProfile !== null ? (
              <span className="setting-scope" id="rate-scope-badge">{perProfile ? "Per-profile" : "Host"}</span>
            ) : null}
          </h2>
        </div>
      </div>

      {perProfile && entry ? (
        <div id="profile-rate-rows">
          {(shared ? (["wired"] as const) : (["wireless", "wired"] as const)).map((link) => (
            <RateSlider
              key={link}
              id={`profile-rate-${link}`}
              options={snapshot.profile.rateOptions[link]}
              valueHz={snapshot.stagedProfileRates[link]
                ?? (link === "wired" ? entry.reportRateWired : entry.reportRateWireless)}
              label={shared ? "All connections" : link === "wired" ? "Wired" : "Wireless"}
              disabled={locked || snapshot.settingInProgress}
              onChange={(hz) => control.setProfileReportRate(link, hz)}
            />
          ))}
        </div>
      ) : (
        <RateSlider
          id="host-rate-slider"
          options={advertisedRates}
          valueHz={status.pollingRateHz}
          disabled={snapshot.settingsPending || status.ui?.pollingReadOnly === true}
          onChange={control.applyPollingRate}
        />
      )}
      <small id="polling-note" className="setting-note">{note}</small>
    </article>
  );
}

function AsymmetricLiftOff({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const pair = snapshot.status?.asymmetricLiftOff;
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
        Lift-off
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
        Landing
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
      <div className="setting-heading tight"><div><p>SENSOR</p></div></div>

      {status.gamingSurfaceMode ? (
        <div id="gaming-surface-row">
          <div className="setting-heading"><div><h2>Gaming surface</h2></div></div>
          <Segmented
            className="three"
            ariaLabel="Gaming surface"
            options={(["On", "Off", "Auto"] as const).map((mode) => ({ value: mode, label: mode }))}
            value={status.gamingSurfaceMode}
            disabled={snapshot.settingsPending}
            onChange={control.applyGamingSurfaceMode}
          />
          <small className="setting-note">
            Tunes the sensor for gaming mouse pads. Auto lets the mouse decide; turn it off if tracking
            misbehaves on a non-gaming surface.
          </small>
        </div>
      ) : null}

      {slotsAvailable ? null : (
        <div id="host-lod-row">
          <div className="setting-heading"><div><h2>Lift-off distance</h2></div></div>
          {pair ? (
            <div id="lod-mode-row" className="lod-mode">
              <Segmented
                className="two"
                ariaLabel="Lift-off mode"
                options={[
                  { value: "single", label: "Single" },
                  { value: "asymmetric", label: "Asymmetric" },
                ]}
                value={pair.enabled === null ? null : showPair ? "asymmetric" : "single"}
                disabled={snapshot.settingsPending}
                onChange={control.applyLiftOffMode}
              />
            </div>
          ) : null}

          {pair && showPair ? (
            <AsymmetricLiftOff snapshot={snapshot} />
          ) : (
            <div id="lod-single">
              <Segmented
                className="three"
                ariaLabel="Lift-off distance"
                options={LOD_LEVELS.map((level) => {
                  const hideLow = level === "Low" && (snapshot.traits.eggFamily || ui?.hideLodLow === true);
                  const unsupported = Array.isArray(supportedLods) && !supportedLods.includes(level);
                  const legacyLogitechLow = snapshot.traits.logitech
                    && !Array.isArray(supportedLods)
                    && level === "Low";
                  return {
                    value: level,
                    label: level,
                    hidden: hideLow || unsupported,
                    disabled: snapshot.settingsPending || legacyLogitechLow || lodNeedsSurface,
                  };
                })}
                value={status.liftOffDistance}
                onChange={control.applyLiftOffDistance}
              />
            </div>
          )}
          <small id="lod-note" className="setting-note">
            {lodNeedsSurface
              ? "Turn the gaming surface on or set it to auto to adjust lift-off distance."
              : "Controls how far you can lift the mouse before tracking stops. Higher values keep tracking a little longer."}
          </small>
        </div>
      )}
    </article>
  );
}

function BunnyHop({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const entry = snapshot.profile.entry;
  if (!snapshot.profile.bunnyHopSupported || !entry) return null;

  const locked = snapshot.profileFormat?.writable !== true;
  // Support is a property of the format, not of the stored value: a profile
  // that never had bunny hop written reads 0xff and decodes to null, which
  // means off, not unsupported.
  const value = snapshot.stagedBunnyHopMs ?? entry.bunnyHoppingMs ?? 0;
  const enabled = value !== 0;

  return (
    <div id="bunny-hop-row">
      <div className="setting-heading">
        <div><h2>Bunny hop<span className="setting-scope">Per-profile</span></h2></div>
      </div>
      <div className="bunny-hop-controls">
        <SwitchButton
          id="bunny-hop-enabled"
          value={enabled}
          label="Bunny hop"
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
          aria-label="Bunny hop time in milliseconds"
          // "change" not "input": a number field fires it on blur or Enter, so a
          // value is not staged on every keystroke. min/max/step only gate the
          // spinner, not typing, so the typed value is snapped into range here.
          onChange={(event) => control.applyBunnyHopMs(clampBunnyHopMs(Number(event.currentTarget.value)))}
        />
        <span>ms</span>
      </div>
      <small className="setting-note" id="bunny-hop-note">
        {locked
          ? "This profile format has not been verified on hardware, so it is read-only."
          : `Ignores repeat clicks that land within this window, so a switch that bounces during fast click spam only registers once. Longer times filter harder; shorter times let genuine fast clicks through. ${BUNNY_HOP_LIMITS.minMs}–${BUNNY_HOP_LIMITS.maxMs} ms in steps of ${BUNNY_HOP_LIMITS.stepMs}.`}
      </small>
    </div>
  );
}

export function LightforceCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const staged = snapshot.pending.keys.includes("lightforce-switch-mode");
  return (
    <article
      id="lightforce-card"
      className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key="lightforce-switch-mode"
    >
      <div className="setting-heading"><div><p>SWITCHES</p><h2>LightForce</h2></div></div>
      <Segmented
        ariaLabel="LightForce switch mode"
        options={[
          { value: "Hybrid", label: "Hybrid" },
          { value: "Optical", label: "Optical only" },
        ]}
        value={status.lightforceSwitchMode}
        disabled={snapshot.settingsPending}
        onChange={control.applyLightforceSwitchMode}
      />
      <small className="setting-note">
        Hybrid saves power by using the mechanical contact and only waking the optical sensor when needed.
        Optical only is consistent but uses more battery.
      </small>
      <BunnyHop snapshot={snapshot} />
    </article>
  );
}
