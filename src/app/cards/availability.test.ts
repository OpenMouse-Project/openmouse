import assert from "node:assert/strict";
import { test } from "node:test";
import { cardAvailability } from "./availability.ts";
import { traitsFor } from "../../device/traits.ts";
import type { ControlSnapshot, DeviceCapabilities } from "../../device/types.ts";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";

const STATUS: MouseStatus = {
  brand: "Logitech",
  name: "Test mouse",
  batteryPercent: 50,
  batteryState: "Discharging",
  dpi: 800,
  pollingRateHz: 1000,
  firmware: [],
};

function snapshot(overrides: {
  status?: Partial<MouseStatus> | null;
  capabilities?: Partial<DeviceCapabilities>;
  settingsPending?: boolean;
  showExperimental?: boolean;
  buttons?: ControlSnapshot["buttons"];
}): ControlSnapshot {
  const status = overrides.status === null ? null : { ...STATUS, ...overrides.status };
  return {
    status,
    traits: traitsFor(status),
    capabilities: overrides.capabilities ?? null,
    settingsPending: overrides.settingsPending ?? false,
    buttons: overrides.buttons ?? null,
    preferences: { showExperimental: overrides.showExperimental ?? true },
  } as unknown as ControlSnapshot;
}

const CONTROL = {
  controlId: 0x00c3, taskId: 0x009c, flags: 0x31, group: 2, groupMask: 3,
  name: "Gesture button", taskName: "Gesture button", reprogrammable: true,
  mappedTo: 0x00c3, diverted: false, remappableTo: [0x0052], remapFlags: 0,
} as unknown as NonNullable<ControlSnapshot["buttons"]>[number];

test("the button card appears only when the mouse reports controls", () => {
  // The driver answers with an empty list on a mouse without 0x1B04, so this
  // must key on the controls themselves rather than on the brand.
  assert.equal(cardAvailability(snapshot({})).mxMasterButtons, false);
  assert.equal(cardAvailability(snapshot({ buttons: [] })).mxMasterButtons, false);
  assert.equal(cardAvailability(snapshot({ buttons: [CONTROL] })).mxMasterButtons, true);
});

test("a non-Logitech mouse never gets the button card", () => {
  assert.equal(cardAvailability(snapshot({
    status: { brand: "Pulsar" }, buttons: [CONTROL],
  })).mxMasterButtons, false);
});

test("no device offers no cards at all", () => {
  const has = cardAvailability(snapshot({ status: null }));
  assert.equal(Object.values(has).every((value) => value === false), true);
});

test("a driver still reading hides the settings grid but not the rest", () => {
  const has = cardAvailability(snapshot({ settingsPending: true }));
  assert.equal(has.dpi, false);
  assert.equal(has.polling, false);
  assert.equal(has.sensor, false);
  assert.equal(has.logitechDetails, true);
});

test("the sensor card goes when the mouse reports neither surface nor lift-off", () => {
  assert.equal(cardAvailability(snapshot({
    status: { supportedLiftOffDistances: [] },
  })).sensor, false);
  assert.equal(cardAvailability(snapshot({})).sensor, true);
  assert.equal(cardAvailability(snapshot({
    status: { supportedLiftOffDistances: [], gamingSurfaceMode: "Auto" },
  })).sensor, true);
});

test("Logitech has no advanced section, so nothing inside it appears", () => {
  const has = cardAvailability(snapshot({ status: { motionSync: true, lighting: {} as never } }));
  assert.equal(has.advancedHost, false);
  assert.equal(has.processing, false);
  assert.equal(has.lightingAdvanced, false);
  assert.equal(has.lighting, true);
});

test("an Endgame Gear 8K mouse gets its own cards and loses signal and sleep", () => {
  const has = cardAvailability(snapshot({
    status: { brand: "Endgame Gear", ui: { family: "egg-op1" }, eggCpiStages: [] as never },
  }));
  assert.equal(has.advancedHost, true);
  assert.equal(has.eggFilter, true);
  assert.equal(has.eggSpdt, true);
  assert.equal(has.eggCpi, true);
  assert.equal(has.signal, false);
  assert.equal(has.sleep, false);
});

test("Pulsar keeps the shared advanced cards", () => {
  const has = cardAvailability(snapshot({
    status: { brand: "Pulsar", ui: { family: "pulsar" }, debounceMs: 4 },
  }));
  assert.equal(has.advancedHost, true);
  assert.equal(has.signal, true);
  assert.equal(has.sleep, true);
  assert.equal(has.debounce, true);
  assert.equal(has.eggFilter, false);
});

test("Keychron Nape Pro gets Auto sleep without debounce or signal", () => {
  const has = cardAvailability(snapshot({
    status: {
      brand: "Keychron",
      ui: { family: "keychron-nape", showAdvancedSection: true },
      sleepTimeout: 600,
    },
  }));
  assert.equal(has.advancedHost, true);
  assert.equal(has.sleep, true);
  assert.equal(has.debounce, false);
  assert.equal(has.signal, false);
});

test("a driver may opt into the advanced section and still suppress its cards", () => {
  const has = cardAvailability(snapshot({
    status: {
      brand: "Zaunkoenig",
      ui: { family: "zaunkoenig", showAdvancedSection: true, hideSignalCard: true, hideSleepCard: true },
    },
  }));
  assert.equal(has.advancedHost, true);
  assert.equal(has.signal, false);
  assert.equal(has.sleep, false);
});

test("the experimental polling card follows the interface preference", () => {
  const egg = { status: { brand: "Endgame Gear", ui: { family: "egg-op1" } } };
  assert.equal(cardAvailability(snapshot({ ...egg, showExperimental: true })).eggPolling, true);
  assert.equal(cardAvailability(snapshot({ ...egg, showExperimental: false })).eggPolling, false);
});

test("onboard profiles need a Logitech mouse reporting a known mode", () => {
  assert.equal(cardAvailability(snapshot({ status: { deviceMode: "Onboard" } })).profiles, true);
  assert.equal(cardAvailability(snapshot({ status: { deviceMode: "Unknown" } })).profiles, false);
  assert.equal(cardAvailability(snapshot({})).profiles, false);
  assert.equal(cardAvailability(snapshot({
    status: { brand: "Pulsar", ui: { family: "pulsar" }, deviceMode: "Onboard" },
  })).profiles, false);
});

test("HITS tuning needs exactly the two primary buttons", () => {
  const tuning = { maxActuation: 10, maxRapidTrigger: 5, maxHaptics: 5 };
  assert.equal(cardAvailability(snapshot({
    status: { analogButtonTuning: { ...tuning, buttons: [{}, {}] } as never },
  })).superstrike, true);
  assert.equal(cardAvailability(snapshot({
    status: { analogButtonTuning: { ...tuning, buttons: [{}] } as never },
  })).superstrike, false);
  assert.equal(cardAvailability(snapshot({})).superstrike, false);
});

test("debounce is offered only by the families that store it", () => {
  assert.equal(cardAvailability(snapshot({
    status: { brand: "Pulsar", ui: { family: "pulsar" }, debounceMs: 4 },
  })).debounce, true);
  assert.equal(cardAvailability(snapshot({
    status: { brand: "Logitech", debounceMs: 4 },
  })).debounce, false);
  assert.equal(cardAvailability(snapshot({
    status: { brand: "Pulsar", ui: { family: "pulsar" } },
  })).debounce, false);
});

test("low power needs the Razer capability, not merely a reported threshold", () => {
  // selectableValues treats an empty option list as unbounded, so a mouse that
  // reports a threshold without the Razer driver must not show the card.
  assert.equal(cardAvailability(snapshot({
    status: { brand: "Pulsar", ui: { family: "pulsar" }, lowBatteryWarning: 15 },
  })).lowPower, false);
  assert.equal(cardAvailability(snapshot({
    status: { brand: "Razer", ui: { family: "razer", showAdvancedSection: true }, lowBatteryWarning: 15 },
    capabilities: { razerLowPowerOptions: [5, 10, 15, 20] },
  })).lowPower, true);
});
