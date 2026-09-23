// Bridge can push a saved profile's DPI/polling rate over native HID only
// for brands it has a driver for (currently Pulsar, plus whatever the
// bundled Node helper covers — see OpenMouse-Bridge's drivers/mod.rs). For
// every other brand it deliberately does nothing but fire an OS notification
// telling the user to "open OpenMouse to apply it to this mouse" (see
// service.rs's Ok(false) branch) — this control panel, with a live WebHID
// connection, has a driver for every supported brand. This hook is that
// fallback, and the only place a profile's full settings snapshot is ever
// applied: while a tab is open and Bridge is connected, it watches Bridge's
// own idea of the active profile and, when the profile targets the device
// currently open in this tab, writes it the same way any manual control
// would.
//
// There is no separate "default profile" concept here: Bridge has one
// (`/v1/default-profile`), but nothing writes to it, and the product intent
// is simpler — when the matched game closes and Bridge's activeProfile goes
// back to null, this restores whatever the mouse was actually using right
// before the profile was applied, captured field by field the moment it was.
import { useEffect, useRef } from "react";
import * as control from "../device/controller";
import type { BridgeProfile } from "../bridge";
import { subscribeBridgeStatus } from "../bridge-status-store";
import {
  pickSnapshot,
  sanitizeSnapshot,
  type GameProfileSnapshot,
} from "../device/game-profile-snapshot";
import { t } from "../i18n";
import type { ControlSnapshot } from "../device/types";

/** Everything the profile sets: its snapshot, plus the DPI/polling fields Bridge also keeps separately. */
export function profileTarget(profile: BridgeProfile): GameProfileSnapshot {
  const target: GameProfileSnapshot = { ...sanitizeSnapshot(profile.settings.snapshot) };
  if (profile.settings.dpi != null && target.dpi === undefined) target.dpi = profile.settings.dpi;
  if (profile.settings.pollingRateHz != null && target.pollingRateHz === undefined) {
    target.pollingRateHz = profile.settings.pollingRateHz;
  }
  return target;
}

function signature(profile: BridgeProfile): string {
  return `${profile.application.name}|${profile.device.name}|${JSON.stringify(profile.settings)}`;
}

export function useBridgeProfileApplier(snapshot: ControlSnapshot): void {
  const deviceStatusRef = useRef(snapshot.deviceStatus);
  deviceStatusRef.current = snapshot.deviceStatus;
  const localeRef = useRef(snapshot.preferences.locale);
  localeRef.current = snapshot.preferences.locale;
  const appliedSignature = useRef<string | null>(null);
  // What the mouse had, before any profile, for every field a profile has
  // changed since. Grows as profiles switch; written back when none is active.
  const priorSettings = useRef<GameProfileSnapshot | null>(null);
  const writing = useRef(false);

  useEffect(() => subscribeBridgeStatus((bridge) => {
    if (writing.current) return;
    const status = deviceStatusRef.current;
    const profile = bridge?.activeProfile ?? null;

    if (!profile || !status || profile.device.name !== status.name) {
      // Nothing (recognized) is active for this mouse right now. If we were
      // the one who applied a profile, put back what was there before it.
      const prior = priorSettings.current;
      if (appliedSignature.current === null || !prior) return;
      writing.current = true;
      void control.flashGameProfileSnapshot(prior).then((result) => {
        if (result === "busy") return;
        appliedSignature.current = null;
        priorSettings.current = null;
        if (result === "written") control.pushToast("info", t(localeRef.current, "bridge.profileRestored"));
      }).finally(() => {
        writing.current = false;
      });
      return;
    }

    const sig = signature(profile);
    if (sig === appliedSignature.current) return;

    const target = profileTarget(profile);
    // Capture only fields not already held: when one game's profile gives way
    // to another's, the originals from before the first one still win.
    const prior = { ...pickSnapshot(status, target), ...priorSettings.current };
    // Fields the previous profile changed but this one doesn't go back to
    // their originals, so the new game starts from the user's own settings.
    const toWrite = { ...priorSettings.current, ...target };

    writing.current = true;
    void control.flashGameProfileSnapshot(toWrite).then((result) => {
      if (result === "busy") return;
      priorSettings.current = prior;
      appliedSignature.current = sig;
      if (result === "written") {
        control.pushToast("info", t(localeRef.current, "bridge.profileAppliedHere"), profile.application.name);
      }
    }).finally(() => {
      writing.current = false;
    });
  }), []);
}
