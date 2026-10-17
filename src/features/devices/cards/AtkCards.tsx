import { displayText, t } from "../../../i18n/index";
import { useUiLocale } from "../../../shared/ui-locale";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../../../device/controller";
import type { ControlSnapshot } from "../../../device/types";
import { Segmented } from "../../../shared/ui";
import { atkSensorModes, atkVisibleButtons } from "./atk-capabilities";

export function AtkProfileCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const __uiLocale = useUiLocale();
  const status = snapshot.status;
  if (!status || status.activeProfile === null || status.atkProfileCount === undefined) return null;
  return (
    <article id="atk-profile-status" className="setting-card">
      <div className="setting-heading compact">
        <div><h2>{displayText(__uiLocale, "Configuration bank")}</h2></div>
        <output>{status.activeProfile} / {status.atkProfileCount}</output>
      </div>
      <Segmented
        ariaLabel={displayText(__uiLocale, "Active configuration bank")}
        options={Array.from({ length: status.atkProfileCount }, (_, index) => ({
          value: index + 1,
          label: String(index + 1),
        }))}
        value={status.activeProfile}
        disabled={snapshot.settingInProgress}
        onChange={(profile) => void control.selectAtkR1Profile(profile)}
      />
      <small className="setting-note"> {displayText(__uiLocale, "Switching changes the active firmware-managed bank and requires readback from the mouse.")} </small>
    </article>
  );
}

export function AtkButtonCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const __uiLocale = useUiLocale();
  const mappings = atkVisibleButtons(snapshot.status?.atkButtonMappings, snapshot.status?.atkCatalogFeatures);
  if (!mappings.length) return null;
  return (
    <article id="atk-button-status" className="setting-card">
      <div className="setting-heading compact">
        <div><h2>{displayText(__uiLocale, "Onboard assignments")}</h2></div>
        <output>{mappings.length}</output>
      </div>
      <div className="button-remap-list">
        {mappings.map((mapping) => (
          <div className="button-remap-row" key={mapping.id}>
            <span>{displayText(__uiLocale, mapping.name)}</span>
            <output title={`EEPROM 0x${mapping.address.toString(16).padStart(4, "0")} · ${mapping.raw}`}>
              {mapping.checksumValid ? displayText(__uiLocale, mapping.action) : `${displayText(__uiLocale, "Invalid checksum")} · ${mapping.raw}`}
            </output>
          </div>
        ))}
      </div>
      <small className="setting-note"> {displayText(__uiLocale, "Read from the active bank. Assignment writes, shortcuts, and macros remain locked pending reversible validation.")} </small>
    </article>
  );
}

export function AtkReceiverCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const __uiLocale = useUiLocale();
  const [pairingPrepared, setPairingPrepared] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const startPairingRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pairingPrepared) startPairingRef.current?.focus();
  }, [pairingPrepared]);
  const closePreparation = (): void => {
    setPairingPrepared(false);
    window.requestAnimationFrame(() => cardRef.current?.focus());
  };
  const startPairing = (): void => {
    closePreparation();
    void control.pairAtkR1SePlusReceiver();
  };
  const receiver = snapshot.status?.atkReceiver;
  if (!receiver) return null;
  const pairing = receiver.pairingStatus === null
    ? "Unavailable"
    : receiver.pairingSecondsRemaining
      ? `Status ${receiver.pairingStatus} · ${receiver.pairingSecondsRemaining}s remaining`
      : `Status ${receiver.pairingStatus}`;
  return (
    <article ref={cardRef} id="atk-receiver-status" className="setting-card" tabIndex={-1}>
      <div className="setting-heading compact">
        <div><h2>{displayText(__uiLocale, "Receiver")}</h2></div>
        <output>{displayText(__uiLocale, receiver.online ? "Mouse online" : "Mouse offline")}</output>
      </div>
      <div className="button-remap-list">
        <div className="button-remap-row"><span>{displayText(__uiLocale, "RF identifier")}</span><output>{receiver.rfId}</output></div>
        <div className="button-remap-row"><span>{displayText(__uiLocale, "Pairing state")}</span><output>{displayText(__uiLocale, pairing)}</output></div>
      </div>
      {snapshot.atkR1SePlusPairingAvailable ? (
        pairingPrepared ? (
          <div className="setting-action">
            <small className="setting-note"> {displayText(__uiLocale, "Unplug the mouse cable and select 2.4 GHz mode. After starting, hold left click, wheel click, and right click until the indicator flashes, then release.")} </small>
            <button
              ref={startPairingRef}
              className="om-btn is-primary"
              type="button"
              disabled={snapshot.settingInProgress}
              onClick={startPairing}
            > {displayText(__uiLocale, "Ready, start pairing")} </button>
            <button type="button" className="om-btn is-ghost" disabled={snapshot.settingInProgress} onClick={closePreparation}>{displayText(__uiLocale, "Cancel")}</button>
          </div>
        ) : (
          <div className="setting-action">
            <small className="setting-note">{displayText(__uiLocale, "Pairing is verified for the VXE R1 SE+ (CID 02, MID 20).")}</small>
            <button type="button" className="om-btn" disabled={snapshot.settingInProgress} onClick={() => setPairingPrepared(true)}>{displayText(__uiLocale, "Pair R1 SE+")}</button>
          </div>
        )
      ) : (
        <small className="setting-note">{displayText(__uiLocale, "Pairing controls are unavailable on this receiver model.")}</small>
      )}
    </article>
  );
}

const ATK_SENSOR_MODE_LABELS = ["Basic Mode", "ATK Shard Competitive Firmware", "ATK Shard Competitive Firmware MAX"] as const;
const ATK_DONGLE_LIGHT_LABELS = ["adv.ledOff", "adv.ledConnectRate", "adv.ledBatteryStatus", "adv.ledBatteryWarning"] as const;

/**
 * F1 Ultimate extras, grouped like the ATK HUB pages: sensor sampling rate
 * lives with polling under Performance, while scroll anti-mistouch and the
 * receiver dongle LED live under Advanced (HUB Parameter page). Each control
 * renders only when the driver actually reported the field; all three were
 * verified on the F1 Ultimate 2.0 (CID 01, MID 08 over 373B:11D9).
 */
export function AtkSensorCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const __uiLocale = useUiLocale();
  const sensorMode = snapshot.status?.atkSensorMode ?? null;
  if (sensorMode == null) return null;
  // Vendor catalog: noAthleticsMax mice expose Basic and Shard only, so the
  // MAX option is dropped rather than offered and rejected by the device.
  const modes = atkSensorModes(snapshot.status?.atkCatalogFeatures);
  return (
    <article id="atk-sensor-mode" className="setting-card">
      <div className="setting-heading compact">
        <div><h2>{displayText(__uiLocale, "Sensor Sampling Rate")}</h2></div>
      </div>
      <Segmented
        ariaLabel={displayText(__uiLocale, "Sensor sampling mode")}
        options={modes.map((value) => ({ value, label: displayText(__uiLocale, ATK_SENSOR_MODE_LABELS[value]) }))}
        value={sensorMode}
        disabled={snapshot.settingInProgress}
        className={modes.length === 3 ? "three" : undefined}
        onChange={(mode) => void control.selectAtkSensorMode(mode)}
      />
      <small className="setting-note setting-note-stable">
        {displayText(__uiLocale, sensorMode === 2
          ? "In this mode, the mouse sensor is in high performance state, high scanning frequency, more responsive control."
          : sensorMode === 1
            ? "ATK Shard competitive firmware: balanced scan rate for match play."
            : "Basic sensor mode for daily work and maximum battery life.")}
      </small>
    </article>
  );
}

export function AtkDongleCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const __uiLocale = useUiLocale();
  const dongleLight = snapshot.status?.atkDongleLight ?? (snapshot.status?.atkSensorMode != null ? 2 : null);
  if (dongleLight == null) return null;
  return (
    <article id="atk-dongle-light" className="setting-card">
      <div className="setting-heading compact">
        <div><h2>{t(__uiLocale, "adv.dongleLed")}</h2></div>
      </div>
      <small className="setting-note">{t(__uiLocale, "adv.effect")}</small>
      <Segmented
        ariaLabel={displayText(__uiLocale, "Dongle LED effect")}
        options={ATK_DONGLE_LIGHT_LABELS.map((label, value) => ({ value, label: t(__uiLocale, label) }))}
        value={dongleLight}
        disabled={snapshot.settingInProgress}
        onChange={(mode) => void control.selectAtkDongleLight(mode)}
      />
      <small className="setting-note"> {displayText(__uiLocale, "Effect on the 8K receiver; write-only, confirmed on the LED.")} </small>
    </article>
  );
}
