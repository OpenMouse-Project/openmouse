import { selectableValues } from "../../device/options.ts";
import { isPulsarProProtocol } from "../../device/traits.ts";
import type { ControlSnapshot } from "../../device/types";

export interface CardAvailability {
  dpi: boolean;
  polling: boolean;
  sensor: boolean;
  lightforce: boolean;
  superstrike: boolean;
  lighting: boolean;
  lightingAdvanced: boolean;
  signal: boolean;
  debounce: boolean;
  sleep: boolean;
  lowPower: boolean;
  processing: boolean;
  ninjutsoSensor: boolean;
  ninjutsoClick: boolean;
  teevolutionDpiLighting: boolean;
  finalmouse: boolean;
  incott: boolean;
  eggFilter: boolean;
  eggSpdt: boolean;
  eggPolling: boolean;
  eggCpi: boolean;
  eggButtons: boolean;
  razerButtons: boolean;
  atkButtons: boolean;
  atkProfile: boolean;
  atkReceiver: boolean;
  atkF1Sensor: boolean;
  atkF1Dongle: boolean;
  mxMasterButtons: boolean;
  pulsarPro: boolean;
  onboardProfiles: boolean;
  buttonMapping: boolean;
  powerMode: boolean;
  profiles: boolean;
  keychronNapeLayers: boolean;
  logitechDetails: boolean;
  advancedHost: boolean;
}

const NOTHING: CardAvailability = {
  dpi: false,
  polling: false,
  sensor: false,
  lightforce: false,
  superstrike: false,
  lighting: false,
  lightingAdvanced: false,
  signal: false,
  debounce: false,
  sleep: false,
  lowPower: false,
  processing: false,
  ninjutsoSensor: false,
  ninjutsoClick: false,
  teevolutionDpiLighting: false,
  finalmouse: false,
  incott: false,
  eggFilter: false,
  eggSpdt: false,
  eggPolling: false,
  eggCpi: false,
  eggButtons: false,
  razerButtons: false,
  atkButtons: false,
  atkProfile: false,
  atkReceiver: false,
  atkF1Sensor: false,
  atkF1Dongle: false,
  mxMasterButtons: false,
  pulsarPro: false,
  onboardProfiles: false,
  buttonMapping: false,
  powerMode: false,
  profiles: false,
  keychronNapeLayers: false,
  logitechDetails: false,
  advancedHost: false,
};

export function cardAvailability(snapshot: ControlSnapshot): CardAvailability {
  const status = snapshot.status;
  if (!status) return NOTHING;
  const ui = status.ui;
  const { traits, capabilities } = snapshot;
  const ready = !snapshot.settingsPending;
  const host = traits.advancedSection;

  const sensor = !(!status.gamingSurfaceMode
    && Array.isArray(status.supportedLiftOffDistances)
    && status.supportedLiftOffDistances.length === 0);

  const processing = ui?.hideProcessingCard !== true && (
    (status.motionSync != null && ui?.hideMotionSync !== true)
    || (status.angleSnapping != null && ui?.hideAngleSnapping !== true)
    || (status.rippleControl != null && ui?.hideRippleControl !== true)
    || (status.performanceMode != null && !traits.eggFamily && !traits.finalmouse)
    || status.hyperMode != null
    || status.turboMode != null
    || status.buttonCombination != null
    || status.angleTuning != null
    || status.longRangeMode != null
    || status.sensorMode != null || status.performanceDuration != null
    || status.longRangeMode != null
  );

  const eggs = host && traits.eggControls;
  // Only the full Razer driver reports these, and selectableValues treats an
  // empty option list as "anything goes", so the capability is the real gate.
  const razerSleep = capabilities?.razerSleepOptions != null
    && selectableValues(capabilities.razerSleepOptions, status.sleepTimeout) !== null;
  const razerLowPower = capabilities?.razerLowPowerOptions != null
    && selectableValues(capabilities.razerLowPowerOptions, status.lowBatteryWarning) !== null;

  return {
    dpi: ready,
    // The Attack Shark X11's settings channel is native-only (settingsReady
    // stays false), but its polling rate is still controllable through
    // OpenMouse Bridge — see isNativeAttackSharkX11 in device/controller.ts.
    polling: ready || (
      status.brand === "Attack Shark"
      && status.name === "Attack Shark X11"
      && status.ui?.settingsReady === false
    ),
    sensor: sensor && ready,
    lightforce: Boolean(status.lightforceSwitchMode),
    superstrike: traits.logitech && status.analogButtonTuning?.buttons.length === 2,
    lighting: Boolean(status.lighting || status.lightingZones?.length),
    lightingAdvanced: host && Boolean(status.lighting || status.lightingZones?.length),
    onboardProfiles: (status.profileCount ?? 0) > 1 && status.activeProfile != null,
    // Not gated on `host`: a driver publishes both fields only when it can
    // write them, which is opt-in enough. VGN F2 and G-Wolves remap buttons
    // but have no other advanced controls to open that section for.
    buttonMapping: Boolean(status.buttonMappings) && Boolean(status.buttonOptions?.length),
    powerMode: host && Boolean(status.powerModes?.length),
    profiles: traits.logitech
      && status.deviceMode !== undefined && status.deviceMode !== "Unknown",
    keychronNapeLayers: status.napeLayerCount != null && status.napeLayerCount >= 1,
    logitechDetails: traits.logitech,
    advancedHost: host,

    signal: host && traits.signal,
    debounce: host && traits.debounce
      && status.debounceMs !== null && status.debounceMs !== undefined,
    sleep: host && (traits.sleep || razerSleep) && ui?.hideSleepCard !== true,
    lowPower: host && razerLowPower,
    processing: host && processing,
    ninjutsoSensor: host && traits.ninjutso
      && Boolean(status.ninjutsoSystemMode || status.ninjutsoOpticalEngine),
    ninjutsoClick: host && traits.ninjutso
      && Boolean(status.ninjutsoHyperClick != null || status.ninjutsoSlamClick),
    teevolutionDpiLighting: host && (ui?.dpiLighting != null
      || (traits.teevolution && capabilities?.teevolutionProfile != null)),
    finalmouse: host && traits.finalmouse,
    // Gated on the fields themselves rather than a brand trait: the receiver
    // LED is absent over the cable, so the card follows what the device
    // actually reported.
    incott: host
      && (status.incottFireKeyTimes != null || status.incottReceiverLedMode != null),
    eggFilter: eggs,
    eggSpdt: eggs,
    eggPolling: eggs && snapshot.preferences.showExperimental,
    eggCpi: eggs,
    eggButtons: eggs
      && status.eggMulticlickFilters !== undefined && status.eggButtonMappings !== undefined,
    // The driver reports an empty list for a mouse without 0x1B04, which the
    // controller stores as null — so this is "the device has controls", not
    // "the device is an MX Master".
    // Not gated on `host`: Logitech opts out of the shared advanced section,
    // and this card lives in the buttons tab regardless.
    // Razer has no BY_FAMILY entry in traits.ts — it reaches the advanced
    // section through the ui.showAdvancedSection escape hatch — so this reads
    // the driver's own field directly. Only the base RazerHidClient populates
    // it, and only for a product whose profile sets buttonMapping.
    razerButtons: status.razerButtonMappings != null,
    atkButtons: (status.atkButtonMappings?.length ?? 0) > 0,
    atkProfile: status.atkProfileCount !== undefined && status.activeProfile !== null,
    atkReceiver: status.atkReceiver !== undefined,
    atkF1Sensor: status.atkSensorMode != null,
    // Write-only with no read command: gate on F1 presence and default the
    // selector to Battery (vendor default) until the first write lands.
    atkF1Dongle: status.atkSensorMode != null,
    mxMasterButtons: traits.logitech && (snapshot.buttons?.length ?? 0) > 0,
    pulsarPro: host && isPulsarProProtocol(status),
  };
}
