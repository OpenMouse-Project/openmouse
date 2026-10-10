import assert from "node:assert/strict";
import test from "node:test";
import { PREVIEW_FIXTURES } from "./preview-fixtures.ts";
import type { FixturePreviewMode } from "./preview-modes.ts";
import { familyOf, traitsFor } from "./device/traits.ts";
import { cardAvailability } from "./app/cards/availability.ts";
import type { ControlSnapshot } from "./device/types.ts";

function snapshotFor(key: FixturePreviewMode): ControlSnapshot {
  const status = PREVIEW_FIXTURES[key].status;
  return {
    status,
    traits: traitsFor(status),
  } as ControlSnapshot;
}

test("atk-f1 fixture matches the F1 Ultimate 2.0 driver shape", () => {
  const { status } = PREVIEW_FIXTURES["atk-f1"];
  assert.equal(status.brand, "ATK");
  assert.equal(status.name, "ATK F1 Ultimate 2.0");
  assert.equal(familyOf(status), "atk");
  assert.equal(status.pollingRateHz, 1000);
  assert.deepEqual(status.supportedPollingRates, [125, 250, 500, 1000, 2000, 4000, 8000]);
  assert.equal(status.dpi, 1600);
  // F1-only fields that gate the modernized widgets.
  assert.equal(status.atkSensorMode, 1);
  assert.equal(status.debounceMs, 1);
  assert.equal(status.angleTuning, 0);
  assert.ok((status.atkAntiMistouchMs ?? 0) > 0);
  assert.equal(status.atkDongleLight, 2);
  assert.deepEqual(status.liftOffScale, {
    value: 4, min: 1, max: 11, millimetres: 1, minMillimetres: 0.7, maxMillimetres: 1.7,
  });
});

test("atk-f1 fixture lights up the offender cards", () => {
  const snapshot = snapshotFor("atk-f1");
  assert.equal(snapshot.traits.debounce, true);
  assert.equal(snapshot.traits.sleep, true);
  const has = cardAvailability({
    ...snapshot,
    settingsPending: false,
  } as ControlSnapshot);
  assert.equal(has.debounce, true);
  assert.equal(has.sleep, true);
  assert.equal(has.processing, true);
  assert.equal(has.atkF1Sensor, true);
  assert.equal(has.atkF1Dongle, true);
});

test("finalmouse-slx fixture matches the Starlight X driver shape", () => {
  const { status } = PREVIEW_FIXTURES["finalmouse-slx"];
  assert.equal(status.brand, "Finalmouse");
  assert.equal(status.name, "Finalmouse Starlight X");
  assert.equal(familyOf(status), "finalmouse-slx");
  assert.equal(status.signalStrength, 3);
  assert.deepEqual(status.liftOffScale, {
    value: 12, min: 7, max: 17, millimetres: 1.2, minMillimetres: 0.7, maxMillimetres: 1.7,
  });
});

test("finalmouse-slx fixture lights up the SLX cards", () => {
  const snapshot = snapshotFor("finalmouse-slx");
  assert.equal(snapshot.traits.finalmouse, true);
  assert.equal(snapshot.traits.signal, true);
  const has = cardAvailability({
    ...snapshot,
    settingsPending: false,
  } as ControlSnapshot);
  assert.equal(has.finalmouse, true);
  assert.equal(has.signal, true);
  assert.equal(has.tmrDs, true);
  assert.equal(has.perfectPolling, true);
  assert.equal(has.finalmouseProfiles, true);
});

test("finalmouse ULX fixture stays free of SLX cards but gains signal", () => {
  const snapshot = snapshotFor("finalmouse");
  assert.equal(snapshot.traits.finalmouse, true);
  assert.equal(snapshot.traits.signal, true);
  const has = cardAvailability({
    ...snapshot,
    settingsPending: false,
  } as ControlSnapshot);
  assert.equal(has.finalmouse, true);
  assert.equal(has.signal, true);
  assert.equal(has.tmrDs, false);
  assert.equal(has.perfectPolling, false);
  assert.equal(has.finalmouseProfiles, false);
});
