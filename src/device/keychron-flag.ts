/**
 * Keychron Hall-effect support is experimental: the protocol was derived from
 * static analysis of Keychron Launcher and has not run on a physical board.
 * It stays off until the flag is set, e.g. in the browser console:
 *
 *   localStorage.setItem("openmouse.keychronHallEffect", "1"); location.reload();
 */
export const KEYCHRON_HALL_EFFECT_FLAG = "openmouse.keychronHallEffect";

export function keychronHallEffectEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEYCHRON_HALL_EFFECT_FLAG) === "1";
  } catch {
    return false;
  }
}
