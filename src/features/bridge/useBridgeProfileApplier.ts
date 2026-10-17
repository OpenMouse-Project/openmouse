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
import * as control from "../../device/controller";
import type { BridgeProfile } from "./bridge";
import { subscribeBridgeStatus } from "./bridge-status-store";
import {
  mergeSnapshots,
  pickSnapshot,
  sanitizeSnapshot,
  type GameProfileSnapshot,
} from "../../device/game-profile-snapshot";
import { t } from "../../i18n/index";
import type { ControlSnapshot } from "../../device/types";

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

interface GameProfileSession {
  signature: string | null;
  prior: GameProfileSnapshot | null;
}

export function useBridgeProfileApplier(snapshot: ControlSnapshot): void {
  const deviceStatusRef = useRef(snapshot.deviceStatus);
  deviceStatusRef.current = snapshot.deviceStatus;
  const localeRef = useRef(snapshot.preferences.locale);
  localeRef.current = snapshot.preferences.locale;
  // Keep inactive banks' originals until that device/bank is selected again.
  // Never restore them into whichever mouse happens to be active now.
  const sessions = useRef(new WeakMap<object, Map<number | null, GameProfileSession>>());
  const writing = useRef(false);

  useEffect(() => subscribeBridgeStatus((bridge) => {
    if (writing.current) return;
    const status = deviceStatusRef.current;
    const profile = bridge?.activeProfile ?? null;
    const scope = control.currentGameProfileScope();
    if (!status || !scope) return;
    let session = sessions.current.get(scope.device)?.get(scope.profile);

    if (!profile && !session?.prior) return;

    writing.current = true;
    let attemptedPrior: GameProfileSnapshot | null = null;
    void (async () => {
      // A failed final read leaves a display snapshot, not a reliable baseline.
      // Refresh before both no-op detection and capturing newly touched fields.
      const confirmed = await control.prepareGameProfileStatus();
      if (typeof confirmed === "string") {
        if (confirmed === "failed" && session) session.signature = null;
        return;
      }
      const confirmedScope = control.currentGameProfileScope(confirmed);
      if (!confirmedScope || confirmedScope.device !== scope.device) return;
      let banks = sessions.current.get(confirmedScope.device);
      if (!banks) sessions.current.set(confirmedScope.device, banks = new Map());
      session = banks.get(confirmedScope.profile);
      if (!session) banks.set(confirmedScope.profile, session = { signature: null, prior: null });
      if (!profile || profile.device.name !== confirmed.name) {
        // Nothing (recognized) is active for this mouse right now. Put back
        // what was there before any successful or partial profile application.
        const prior = session.prior;
        // A failed first application can still have changed earlier batches,
        // even though it never earned an applied signature.
        if (!prior) return;
        const result = await control.flashGameProfileSnapshot(prior, confirmedScope);
        if (result === "busy") return;
        session.signature = null;
        if (result === "failed") return;
        session.prior = null;
        if (result === "written") control.pushToast("info", t(localeRef.current, "bridge.profileRestored"));
        return;
      }

      const sig = signature(profile);
      if (sig === session.signature) return;

      const target = profileTarget(profile);
      // Capture only fields not already held: when one game's profile gives way
      // to another's, the originals from before the first one still win.
      const prior = mergeSnapshots(pickSnapshot(confirmed, target), session.prior ?? {}, confirmed);
      // Fields the previous profile changed but this one doesn't go back to
      // their originals, so the new game starts from the user's own settings.
      const toWrite = mergeSnapshots(session.prior ?? {}, target, confirmed);

      attemptedPrior = prior;
      const result = await control.flashGameProfileSnapshot(toWrite, confirmedScope);
      if (result === "busy") return;
      // Back up attempted fields too: an unsuccessful write is not atomic.
      session.prior = prior;
      session.signature = result === "failed" ? null : sig;
      if (result === "written") {
        control.pushToast("info", t(localeRef.current, "bridge.profileAppliedHere"), profile.application.name);
      }
    })().catch(() => {
      // Keep originals even if an unexpected rejection followed a partial write.
      if (session) {
        if (attemptedPrior) session.prior = attemptedPrior;
        session.signature = null;
      }
    }).finally(() => {
      writing.current = false;
    });
  }), []);
}
