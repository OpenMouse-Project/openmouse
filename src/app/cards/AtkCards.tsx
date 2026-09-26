import { useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../../device/controller";
import type { ControlSnapshot } from "../../device/types";
import { Segmented } from "../ui";

export function AtkProfileCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status || status.activeProfile === null || status.atkProfileCount === undefined) return null;
  return (
    <article id="atk-profile-status" className="setting-card">
      <div className="setting-heading compact">
        <div><p>ONBOARD</p><h2>Configuration bank</h2></div>
        <output>{status.activeProfile} / {status.atkProfileCount}</output>
      </div>
      <Segmented
        ariaLabel="Active configuration bank"
        options={Array.from({ length: status.atkProfileCount }, (_, index) => ({
          value: index + 1,
          label: String(index + 1),
        }))}
        value={status.activeProfile}
        disabled={snapshot.settingInProgress}
        onChange={(profile) => void control.selectAtkR1Profile(profile)}
      />
      <small className="setting-note">
        Switching changes the active firmware-managed bank and requires readback from the mouse.
      </small>
    </article>
  );
}

export function AtkButtonCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const mappings = snapshot.status?.atkButtonMappings;
  if (!mappings?.length) return null;
  return (
    <article id="atk-button-status" className="setting-card">
      <div className="setting-heading compact">
        <div><p>BUTTONS</p><h2>Onboard assignments</h2></div>
        <output>{mappings.length}</output>
      </div>
      <div className="button-remap-list">
        {mappings.map((mapping) => (
          <div className="button-remap-row" key={mapping.id}>
            <span>{mapping.name}</span>
            <output title={`EEPROM 0x${mapping.address.toString(16).padStart(4, "0")} · ${mapping.raw}`}>
              {mapping.checksumValid ? mapping.action : `Invalid checksum · ${mapping.raw}`}
            </output>
          </div>
        ))}
      </div>
      <small className="setting-note">
        Read from the active bank. Assignment writes, shortcuts, and macros remain locked pending reversible validation.
      </small>
    </article>
  );
}

export function AtkReceiverCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
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
        <div><p>WIRELESS</p><h2>Receiver</h2></div>
        <output>{receiver.online ? "Mouse online" : "Mouse offline"}</output>
      </div>
      <div className="button-remap-list">
        <div className="button-remap-row"><span>RF identifier</span><output>{receiver.rfId}</output></div>
        <div className="button-remap-row"><span>Pairing state</span><output>{pairing}</output></div>
      </div>
      {snapshot.atkR1SePlusPairingAvailable ? (
        pairingPrepared ? (
          <div className="setting-action">
            <small className="setting-note">
              Unplug the mouse cable and select 2.4 GHz mode. After starting, hold left click, wheel click, and right click until the indicator flashes, then release.
            </small>
            <button
              ref={startPairingRef}
              type="button"
              disabled={snapshot.settingInProgress}
              onClick={startPairing}
            >
              Ready, start pairing
            </button>
            <button type="button" disabled={snapshot.settingInProgress} onClick={closePreparation}>Cancel</button>
          </div>
        ) : (
          <div className="setting-action">
            <small className="setting-note">Pairing is verified for the VXE R1 SE+ (CID 02, MID 20).</small>
            <button type="button" disabled={snapshot.settingInProgress} onClick={() => setPairingPrepared(true)}>Pair R1 SE+</button>
          </div>
        )
      ) : (
        <small className="setting-note">Pairing controls are unavailable on this receiver model.</small>
      )}
    </article>
  );
}

const ATK_SENSOR_MODE_LABELS = ["Basic Mode", "ATK Shard Competitive Firmware", "ATK Shard Competitive Firmware MAX"] as const;
const ATK_DONGLE_LIGHT_LABELS = ["Close", "Polling Rate Effect", "Battery Gradient Light Effect", "Low Battery Effect"] as const;

/**
 * F1 Ultimate extras, grouped like the ATK HUB pages: sensor sampling rate
 * lives with polling under Performance, while scroll anti-mistouch and the
 * receiver dongle LED live under Advanced (HUB Parameter page). Each control
 * renders only when the driver actually reported the field; all three were
 * verified on the F1 Ultimate 2.0 (CID 01, MID 08 over 373B:11D9).
 */
export function AtkSensorCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const sensorMode = snapshot.status?.atkSensorMode ?? null;
  if (sensorMode == null) return null;
  return (
    <article id="atk-sensor-mode" className="setting-card">
      <div className="setting-heading compact">
        <div><p>PERFORMANCE</p><h2>Sensor Sampling Rate</h2></div>
      </div>
      <Segmented
        ariaLabel="Sensor sampling mode"
        options={ATK_SENSOR_MODE_LABELS.map((label, value) => ({ value, label }))}
        value={sensorMode}
        disabled={snapshot.settingInProgress}
        className="three"
        onChange={(mode) => void control.selectAtkSensorMode(mode)}
      />
      <small className="setting-note setting-note-stable">
        {sensorMode === 2
          ? "In this mode, the mouse sensor is in high performance state, high scanning frequency, more responsive control."
          : sensorMode === 1
            ? "ATK Shard competitive firmware: balanced scan rate for match play."
            : "Basic sensor mode for daily work and maximum battery life."}
      </small>
    </article>
  );
}

export function AtkDongleCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const dongleLight = snapshot.status?.atkDongleLight ?? (snapshot.status?.atkSensorMode != null ? 2 : null);
  if (dongleLight == null) return null;
  return (
    <article id="atk-dongle-light" className="setting-card">
      <div className="setting-heading compact">
        <div><p>PARAMETER</p><h2>Dongle Light Effect</h2></div>
      </div>
      <small className="setting-note">Lighting Effect Mode</small>
      <Segmented
        ariaLabel="Dongle LED effect"
        options={ATK_DONGLE_LIGHT_LABELS.map((label, value) => ({ value, label }))}
        value={dongleLight}
        disabled={snapshot.settingInProgress}
        onChange={(mode) => void control.selectAtkDongleLight(mode)}
      />
      <small className="setting-note">
        Effect on the 8K receiver; write-only, confirmed on the LED.
      </small>
    </article>
  );
}
