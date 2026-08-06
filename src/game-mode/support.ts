import { AtkHidClient } from "../devices/atk/hid";
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
 * Game Mode v1 only covers vendors whose polling-rate write is a
 * self-contained HID transaction — it never reads and rewrites unrelated
 * live device state (DPI, sensor tuning, sleep timeout, ...) the way
 * Orbital and EGG's full-settings-blob protocols do, and never needs
 * runtime HID++ feature-index resolution the way Logitech does. Recording a
 * byte-for-byte transcript and blindly replaying it natively is only safe
 * for the vendors below — see the companion app's RecipeEngine for the
 * replay side.
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
] as const;

export function isGameModeSupported(client: SupportedClient | null): boolean {
  if (!client) return false;
  return GAME_MODE_SUPPORTED_CLASSES.some((ctor) => client instanceof ctor);
}
