import assert from "node:assert/strict";
import test from "node:test";
import type { LunaFurySettings } from "@openmouse/protocol/lamzu";
import { clearPendingChanges, pendingChangeBatches, stagePendingChange } from "../pending-changes.ts";
import { pickSnapshot } from "./game-profile-snapshot.ts";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import { lunaFuryLightningPriority, sanitizeLunaFurySettings, stageLunaFuryProfile, type LunaFuryProfileActions } from "./lunafury-profile.ts";

const settings: LunaFurySettings = {
  lightningMode: 0, leftDebounceMs: 0, rightDebounceMs: 15, middleDebounceMs: 1,
  wheelGuard: { enabled: false, windowMs: 0 },
};

test("receiver-global lighting is excluded from Games and profile imports", () => {
  assert.deepEqual(sanitizeLunaFurySettings({ ...settings, receiverLightMode: 6 }), settings);
  const saved = pickSnapshot({ lunafury: { ...settings, receiverLightMode: 2 }, sleepTimeout: 0 } as MouseStatus,
    { lunafury: { receiverLightMode: 6 } as LunaFurySettings, sleepTimeout: 300 });
  assert.deepEqual(saved, { sleepTimeout: 0 });
});

test("bottom-button behavior is device-only and excluded from Games and imports", () => {
  assert.deepEqual(sanitizeLunaFurySettings({ ...settings, bottomButtonMode: 1 }), settings);
  assert.deepEqual(pickSnapshot({ lunafury: { ...settings, bottomButtonMode: 2 } } as MouseStatus,
    { lunafury: { bottomButtonMode: 1 } as LunaFurySettings }), {});
});

test("profile validation accepts endpoints and the disabled zero wheel window", () => {
  assert.deepEqual(sanitizeLunaFurySettings(settings), settings);
  assert.deepEqual(sanitizeLunaFurySettings({ lightningMode: 2, leftDebounceMs: 15, middleDebounceMs: 30,
    wheelGuard: { enabled: true, windowMs: 200 } }), {
    lightningMode: 2, leftDebounceMs: 15, middleDebounceMs: 30, wheelGuard: { enabled: true, windowMs: 200 },
  });
});

test("invalid imported values never become protocol writes", () => {
  for (const raw of [null, [], "1", { lightningMode: NaN, leftDebounceMs: Infinity, rightDebounceMs: 1.5,
    middleDebounceMs: 31, wheelGuard: { enabled: "yes", windowMs: 100 }, unknown: true },
    { lightningMode: -1, leftDebounceMs: 16, middleDebounceMs: 0, wheelGuard: { enabled: true, windowMs: 0 } }]) {
    assert.deepEqual(sanitizeLunaFurySettings(raw), {});
  }
  for (const windowMs of [1, 19, 21, 201, 220, -20, NaN, Infinity]) {
    assert.deepEqual(sanitizeLunaFurySettings({ wheelGuard: { enabled: false, windowMs } }), {});
  }
});

test("button polling and axis mode are validated without saving capability metadata", () => {
  assert.deepEqual(sanitizeLunaFurySettings({ buttonPollingRateHz: 8000, separateDpiAxes: false,
    supportedButtonPollingRates: [1000, 8000] }), { buttonPollingRateHz: 8000, separateDpiAxes: false });
  for (const value of [0, 125, 1000.5, "1000", NaN]) {
    assert.deepEqual(sanitizeLunaFurySettings({ buttonPollingRateHz: value, separateDpiAxes: 1 }), {});
  }
});

test("Games use only supported button rates and restore the original axis mode", () => {
  const calls: unknown[] = [];
  const actions: LunaFuryProfileActions = {
    lightning: () => {}, button: () => {}, wheel: () => {},
    buttonRate: (value) => { calls.push(["rate", value]); },
    separateAxes: (value) => { calls.push(["axes", value]); },
  };
  const current: LunaFurySettings = { buttonPollingRateHz: 1000, supportedButtonPollingRates: [1000], separateDpiAxes: true };
  stageLunaFuryProfile({ buttonPollingRateHz: 8000, separateDpiAxes: false }, current, actions);
  assert.deepEqual(calls, [["axes", false]], "the LUNA33 wired link must not stage an 8K button rate");
  calls.length = 0;
  stageLunaFuryProfile({ buttonPollingRateHz: 4000 }, { ...current, supportedButtonPollingRates: [1000, 2000, 4000, 8000] }, actions);
  assert.deepEqual(calls, [["rate", 4000]]);
  const saved = pickSnapshot({ lunafury: current } as MouseStatus, { lunafury: { separateDpiAxes: false } });
  assert.deepEqual(saved, { lunafury: { separateDpiAxes: true } });
});

test("profile staging calls only supported controls and ignores unknown commands", () => {
  const calls: unknown[] = [];
  const actions: LunaFuryProfileActions = {
    lightning: (mode) => { calls.push(["lightning", mode]); },
    button: (button, milliseconds) => { calls.push([button, milliseconds]); },
    wheel: (guard) => { calls.push(["wheel", guard]); },
  };
  stageLunaFuryProfile(settings, undefined, actions);
  stageLunaFuryProfile({ ...settings, arbitraryCommand: 1 }, { middleDebounceMs: 5 }, actions);
  assert.deepEqual(calls, [["middle", 1]]);
  calls.length = 0;
  stageLunaFuryProfile(settings, settings, actions);
  assert.deepEqual(calls, [["lightning", 0], ["left", 0], ["right", 15], ["middle", 1], ["wheel", { enabled: false, windowMs: 0 }]]);
});

test("apply and restore preserve zero values and do not write unrelated peers", () => {
  const current = structuredClone(settings);
  const actions: LunaFuryProfileActions = {
    lightning: (mode) => { current.lightningMode = mode; },
    button: (button, milliseconds) => { current[`${button}DebounceMs`] = milliseconds; },
    wheel: (guard) => { current.wheelGuard = { ...guard }; },
  };
  const profile = { lunafury: { lightningMode: 2 as const, leftDebounceMs: 8, wheelGuard: { enabled: true, windowMs: 100 } } };
  const prior = pickSnapshot({ lunafury: current } as MouseStatus, profile);
  stageLunaFuryProfile(profile.lunafury, current, actions);
  assert.deepEqual(current, { ...settings, ...profile.lunafury });
  current.middleDebounceMs = 20; // An unrelated edit made while the game is running.
  stageLunaFuryProfile(prior.lunafury, current, actions);
  assert.deepEqual(current, { ...settings, middleDebounceMs: 20 });
});

test("pending batches honor lightning disable/latency/enable ordering for game profiles", async () => {
  for (const mode of [0, 1, 2] as const) {
    clearPendingChanges();
    const written: string[] = [];
    const stage = (key: string, priority?: number) => stagePendingChange({
      key, priority, label: key, command: "", progress: "", apply: async () => { written.push(key); },
    });
    try {
      stageLunaFuryProfile({ lightningMode: mode, leftDebounceMs: 1, rightDebounceMs: 2 }, settings, {
        lightning: (value) => stage("lightning", lunaFuryLightningPriority(value)),
        button: (button) => stage(button),
        wheel: () => stage("wheel"),
      });
      for (const batch of pendingChangeBatches()) await batch.at(-1)!.apply();
      assert.deepEqual(written, mode === 0 ? ["lightning", "left", "right"] : ["left", "right", "lightning"]);
    } finally {
      clearPendingChanges();
    }
  }
});
