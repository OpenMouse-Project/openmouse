import { useState, type CSSProperties, type ReactNode } from "react";
import type { MouseLighting } from "@openmouse/protocol/drivers/mouse-types";
import * as control from "../../device/controller";
import type { ControlSnapshot } from "../../device/types";
import { ColorPicker } from "../ColorPicker";
import { Segmented } from "../ui";

export function LightingCard({
  snapshot,
  variant,
  lighting: suppliedLighting,
  zones,
  zoneIndex = 0,
}: {
  snapshot: ControlSnapshot;
  variant: "advanced" | "tab";
  lighting?: MouseLighting;
  zones?: MouseLighting[];
  zoneIndex?: number;
}): ReactNode {
  const hasLightstrip = Boolean(zones?.some((zone) => zone.hardwareZoneId != null));
  const [selectedZone, setSelectedZone] = useState(
    hasLightstrip && zones && zones.length > 1 ? 1 : zoneIndex,
  );
  const activeZoneIndex = zones ? Math.min(selectedZone, zones.length - 1) : zoneIndex;
  const lighting = zones?.[activeZoneIndex] ?? suppliedLighting ?? snapshot.status?.lighting;
  if (!lighting) return null;
  const prefix = `${variant === "advanced" ? "lighting" : "lighting-tab"}-${activeZoneIndex}`;
  const disabled = snapshot.settingsPending;
  const mode = lighting.mode;
  const usesColor = mode !== null && lighting.colorModes.includes(mode);
  const usesColor2 = mode !== null && lighting.dualColorModes.includes(mode);
  const usesSpeed = mode !== null && lighting.reactiveModes.includes(mode);
  const brightnessLevels = lighting.brightnessLevels ?? [];
  const pendingKey = `lighting-${activeZoneIndex}`;
  const staged = snapshot.pending.keys.includes(pendingKey);
  const sliderSpeeds = lighting.speeds.length > 8;

  return (
    <article
      id={`${prefix}-card`}
      className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key={pendingKey}
    >
      <div className="setting-heading">
        <div>
          <p>{variant === "advanced" ? "RECEIVER" : "LIGHTING"}</p>
          <h2 id={`${prefix}-title`}>
            {lighting.zone === "Receiver" ? "Receiver lighting" : `${lighting.zone} lighting`}
            {lighting.writeOnly ? (
              <span className="setting-scope" id={`${prefix}-write-only-badge`}>Write-only</span>
            ) : null}
          </h2>
        </div>
      </div>

      {zones && zones.length > 1 ? (
        <div className="lighting-zone-picker" aria-label="RGB part">
          <div className="lighting-zone-copy">
            <span>RGB parts</span>
            <strong>{lighting.group ? `${lighting.group} · ${lighting.zone}` : lighting.zone}</strong>
          </div>
          <div
            className={`lighting-strip${hasLightstrip ? " is-lightstrip" : ""}`}
            role="list"
            aria-label={hasLightstrip ? "Lightstrip LEDs" : "RGB zones"}
          >
            {zones.map((zone, index) => (
              <button
                key={`${zone.zone}-${index}`}
                type="button"
                role="listitem"
                className={index === activeZoneIndex ? "is-selected" : ""}
                style={{ "--zone-color": zone.mode === "Off" ? "#15171a" : zone.color ?? "#15171a" } as CSSProperties}
                title={zone.group ? `${zone.group} ${zone.zone}` : `${zone.zone} effects`}
                aria-label={zone.group ? `${zone.group} ${zone.zone}` : zone.zone}
                aria-pressed={index === activeZoneIndex}
                onClick={() => setSelectedZone(index)}
              >{zone.hardwareZoneId ?? "FX"}</button>
            ))}
          </div>
        </div>
      ) : null}

      <Segmented
        id={`${prefix}-modes`}
        className="lighting-modes"
        ariaLabel="Lighting effect"
        options={lighting.modes.map((candidate) => ({ value: candidate, label: candidate }))}
        value={mode}
        disabled={disabled}
        onChange={(next) => control.applyLighting({ mode: next as typeof mode }, activeZoneIndex)}
      />

      {brightnessLevels.length > 0 ? (
        <div id={`${prefix}-brightness-row`} className="lighting-speed-row">
          <div className="setting-heading tight"><div><h2>Brightness</h2></div></div>
          <Segmented
            id={`${prefix}-brightness-levels`}
            ariaLabel="Lighting brightness"
            options={brightnessLevels.map((level) => ({ value: level, label: `${level}%` }))}
            value={lighting.brightness}
            disabled={disabled}
            onChange={(brightness) => control.applyLighting({ brightness }, activeZoneIndex)}
          />
        </div>
      ) : null}

      {usesColor ? (
        <div id={`${prefix}-color-row`} className="lighting-color-row">
          {variant === "advanced" ? (
            <>
              <label className="lighting-color-field">
                <span>Colour</span>
                <input
                  id="lighting-color"
                  type="color"
                  value={lighting.color ?? "#00ff00"}
                  disabled={disabled}
                  aria-label="Lighting colour"
                  onChange={(event) => control.applyLighting({ color: event.currentTarget.value }, activeZoneIndex)}
                />
              </label>
              {usesColor2 ? (
                <label id="lighting-color2-field" className="lighting-color-field">
                  <span>Colour 2</span>
                  <input
                    id="lighting-color2"
                    type="color"
                    value={lighting.color2 ?? "#ff0000"}
                    disabled={disabled}
                    aria-label="Second lighting colour"
                    onChange={(event) => control.applyLighting({ color2: event.currentTarget.value }, activeZoneIndex)}
                  />
                </label>
              ) : null}
            </>
          ) : (
            <>
              <div className="lighting-color-field">
                <span>Colour</span>
                <ColorPicker
                  id="lighting-tab-color"
                  value={lighting.color ?? "#00ff00"}
                  disabled={disabled}
                  ariaLabel="Lighting colour"
                  onChange={(color) => control.applyLighting({ color }, activeZoneIndex)}
                />
              </div>
              {usesColor2 ? (
                <div id="lighting-tab-color2-field" className="lighting-color-field">
                  <span>Colour 2</span>
                  <ColorPicker
                    id="lighting-tab-color2"
                    value={lighting.color2 ?? "#ff0000"}
                    disabled={disabled}
                    ariaLabel="Second lighting colour"
                    onChange={(color2) => control.applyLighting({ color2 }, activeZoneIndex)}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {usesSpeed ? (
        <div id={`${prefix}-speed-row`} className="lighting-speed-row">
          <div className="setting-heading tight"><div><h2>Effect speed</h2></div></div>
          {sliderSpeeds ? (
            <span className="glass-slider-rail">
              <input
                id={`${prefix}-speed-slider`}
                type="range"
                min={Math.min(...lighting.speeds)}
                max={Math.max(...lighting.speeds)}
                step={1}
                defaultValue={lighting.speed ?? lighting.speeds[0] ?? 0}
                key={`speed-${lighting.speed}`}
                disabled={disabled}
                aria-label="Effect speed"
                style={{
                  "--fill": `${(((lighting.speed ?? lighting.speeds[0] ?? 0) - Math.min(...lighting.speeds))
                    / Math.max(1, Math.max(...lighting.speeds) - Math.min(...lighting.speeds))) * 100}%`,
                }}
                onChange={(event) => control.applyLighting({ speed: Number(event.currentTarget.value) }, activeZoneIndex)}
              />
            </span>
          ) : (
            <Segmented
              id={`${prefix}-speeds`}
              ariaLabel="Effect speed"
              options={lighting.speeds.map((speed) => ({ value: speed, label: String(speed) }))}
              value={lighting.speed}
              disabled={disabled}
              onChange={(speed) => control.applyLighting({ speed }, activeZoneIndex)}
            />
          )}
        </div>
      ) : null}

      <div className="setting-action">
        <span id={`${prefix}-pending`}>
          {staged ? `Staged: ${control.describeLighting(lighting)}` : "Choose an effect"}
        </span>
      </div>
      <small id={`${prefix}-note`} className="setting-note">
        {lighting.writeOnly
          ? "The mouse cannot report its current effect, so this shows the last value written."
          : `Picks the ${lighting.zone} light effect.`}
      </small>
    </article>
  );
}
