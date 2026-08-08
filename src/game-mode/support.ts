import { AtkHidClient } from "../devices/atk/hid";
import { FinalmouseHidClient } from "../devices/finalmouse/hid";
import { LamzuHidClient } from "../devices/lamzu/hid";
import { PulsarHidClient } from "../devices/pulsar/pulsar-hid";
import { PulsarProHidClient } from "../devices/pulsar/pulsar-pro-hid";
import { RazerHidClient } from "../devices/razer/hid";
import { RazerViperV4ProHidClient } from "../devices/razer/viper-v4-pro-hid";
import { TeevolutionHidClient } from "../devices/teevolution/hid";
import { VgnF2HidClient } from "../devices/vgn/hid";
import { WLMouseHidClient } from "../devices/wlmouse/hid";
import type { SupportedClient } from "../devices/registry";

/**
 * Game Mode records a byte-for-byte transcript of the vendor driver's own
 * setPollingRate() and replays it natively later (see the companion app's
 * RecipeEngine). One rule decides whether a vendor can be on this list:
 *
 *   the bytes written must be a pure function of the requested rate.
 *
 * If the payload also depends on state the driver read during the same call,
 * replaying it re-imposes that state as it was at enrollment time. Every
 * vendor below writes the rate and nothing else, over a single collection.
 *
 * Deliberately excluded, with what each would actually need:
 *
 * - Endgame Gear 8K (EggOp1HidClient) and Orbital: read the whole settings
 *   blob, patch one field, write it all back. The captured payload therefore
 *   carries a snapshot of DPI, lift-off, motion sync and button mapping, so
 *   replaying it would silently revert every change made since enrollment.
 *   Needs a read-modify-write recipe step (record the changed offsets, not
 *   the whole buffer) before either can be listed. Orbital additionally
 *   applies settings through an opaque runtime-loaded protocol library, so
 *   its transcript has to be captured and diffed on real hardware first.
 * - Endgame Gear OP1we: the payload IS rate-only, but the transaction spans
 *   two vendor collections (FF02 command, FF01 notify) and RecipeStep has no
 *   way to say which collection a step belongs to. Needs a per-step
 *   collection selector plus multi-stream support in the companion.
 * - Logitech: the write targets a HID++ feature index resolved at runtime, so
 *   a recorded index is only valid for the firmware it was captured on.
 *   Needs the companion to redo the root-feature query at replay time.
 */
const GAME_MODE_SUPPORTED_CLASSES = [
  RazerHidClient,
  RazerViperV4ProHidClient,
  TeevolutionHidClient,
  LamzuHidClient,
  WLMouseHidClient,
  AtkHidClient,
  VgnF2HidClient,
  PulsarHidClient,
  PulsarProHidClient,
  FinalmouseHidClient,
] as const;

export function isGameModeSupported(client: SupportedClient | null): boolean {
  if (!client) return false;
  return GAME_MODE_SUPPORTED_CLASSES.some((ctor) => client instanceof ctor);
}
