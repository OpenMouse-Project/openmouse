/**
 * The driver modules that controller.ts uses for runtime identity: the
 * `instanceof` class checks behind every per-brand accessor, plus the small
 * value helpers its settings logic calls (DPI clamping, profile capabilities,
 * keycode maps). Loading them behind one shared dynamic import keeps roughly
 * 800 kB of driver code out of the initial bundle: a session only ever talks
 * to one brand, and by the time any of this can run (a device is connected)
 * the module has long since arrived. Rollup merges the literal imports into
 * one lazy chunk.
 *
 * Two access rules:
 * - `ensureDriverModules()` awaits the load. Every flow that can set the
 *   active client or classify a device awaits it first, and the controller
 *   module also kicks it off at import time so the fetch overlaps app boot.
 * - `driverModules()` peeks. Before the load resolves it returns null; call
 *   sites tolerate that (`isA`/`activeAs` treat a missing class as "not
 *   this client", which matches the pre-load state where no client is
 *   active anyway). Strict reads use `C()` in controller.ts, which throws
 *   loudly rather than computing with half a module.
 */
export type DriverModules = typeof import("@openmouse/protocol/drivers/endgame/egg-op1-hid")
  & typeof import("@openmouse/protocol/drivers/endgame/egg-we-control")
  & typeof import("@openmouse/protocol/drivers/atk/bitmouse-hid")
  & typeof import("@openmouse/protocol/drivers/atk/hid")
  & typeof import("@openmouse/protocol/drivers/lamzu-atlantis/hid")
  & typeof import("@openmouse/protocol/drivers/lamzu/hid")
  & typeof import("@openmouse/protocol/drivers/logitech/hidpp")
  & typeof import("@openmouse/protocol/drivers/logitech/onboard-profiles")
  & typeof import("@openmouse/protocol/drivers/magnetic")
  & typeof import("@openmouse/protocol/logitech")
  & typeof import("@openmouse/protocol/drivers/pulsar/pulsar-hid")
  & typeof import("@openmouse/protocol/drivers/pulsar/pulsar-pro-hid")
  & typeof import("@openmouse/protocol/drivers/pulsar/pulsar-xs1-hid")
  & typeof import("@openmouse/protocol/drivers/orbital/hid")
  & typeof import("@openmouse/protocol/drivers/razer/hid")
  & typeof import("@openmouse/protocol/razer")
  & typeof import("@openmouse/protocol/drivers/razer/viper-mini-hid")
  & typeof import("@openmouse/protocol/drivers/razer/cobra-hid")
  & typeof import("@openmouse/protocol/drivers/razer/viper-hid")
  & typeof import("@openmouse/protocol/drivers/razer/viper-v4-pro-hid")
  & typeof import("@openmouse/protocol/razer-devices")
  & typeof import("@openmouse/protocol/drivers/finalmouse/hid")
  & typeof import("@openmouse/protocol/drivers/moddo/hid")
  & typeof import("@openmouse/protocol/drivers/ninjutso/hid")
  & typeof import("@openmouse/protocol/drivers/zaunkoenig/hid")
  & typeof import("@openmouse/protocol/drivers/corsair/hid")
  & typeof import("@openmouse/protocol/drivers/corsair/bragi-hid")
  & typeof import("@openmouse/protocol/drivers/teevolution/hid")
  & typeof import("@openmouse/protocol/teevolution")
  & typeof import("@openmouse/protocol/drivers/vgn/hid")
  & typeof import("@openmouse/protocol/drivers/keychron/nape-hid")
  & typeof import("@openmouse/protocol/drivers/keychron/mouse-8k-hid")
  & typeof import("@openmouse/protocol/drivers/keychron/mouse-1k-hid")
  & typeof import("@openmouse/protocol/drivers/keychron/mouse-4k-hid")
  & typeof import("@openmouse/protocol/drivers/keychron/mouse-8k-nordic-hid")
  & typeof import("@openmouse/protocol/drivers/glorious/hid")
  & typeof import("@openmouse/protocol/drivers/glorious/classic-hid")
  & typeof import("@openmouse/protocol/drivers/glorious/core2-hid")
  & typeof import("@openmouse/protocol/drivers/mchose/hid")
  & typeof import("@openmouse/protocol/drivers/mchose/dock-hid")
  & typeof import("@openmouse/protocol/drivers/mchose/a5-gen1-hid")
  & typeof import("@openmouse/protocol/drivers/mchose/v3-hid")
  & typeof import("@openmouse/protocol/drivers/fantech/hid")
  & typeof import("@openmouse/protocol/drivers/wallhack/mouse-hid")
  & typeof import("@openmouse/protocol/drivers/wallhack/keyboard-hid")
  & typeof import("@openmouse/protocol/drivers/wooting/hid")
  & typeof import("@openmouse/protocol/keychron")
  & typeof import("@openmouse/protocol/drivers/vendors")
  & typeof import("@openmouse/protocol/drivers/wlmouse/hid")
  & typeof import("@openmouse/protocol/drivers/wlmouse/beast-x-4k-hid")
  & typeof import("@openmouse/protocol/drivers/microsoft/hid")
  & typeof import("@openmouse/protocol/drivers/dareu/hid")
  & typeof import("@openmouse/protocol/drivers/incott/hid")
  & typeof import("@openmouse/protocol/drivers/bytech/hid")
  & typeof import("@openmouse/protocol/drivers/fater/hid")
  & typeof import("@openmouse/protocol/drivers/rapoo/hid")
  & typeof import("@openmouse/protocol/drivers/coolermaster/hid")
  & typeof import("@openmouse/protocol/drivers/ajazz/hid")
  & typeof import("@openmouse/protocol/drivers/redragon/m690-pro-hid")
  & typeof import("@openmouse/protocol/drivers/hitscan/hid");

let loaded: DriverModules | null = null;
let loading: Promise<DriverModules> | null = null;

/** Fetch and merge every driver module above. Idempotent; the promise is shared. */
export function ensureDriverModules(): Promise<DriverModules> {
  loading ??= Promise.all([
    import("@openmouse/protocol/drivers/endgame/egg-op1-hid"),
    import("@openmouse/protocol/drivers/endgame/egg-we-control"),
    import("@openmouse/protocol/drivers/atk/bitmouse-hid"),
    import("@openmouse/protocol/drivers/atk/hid"),
    import("@openmouse/protocol/drivers/lamzu-atlantis/hid"),
    import("@openmouse/protocol/drivers/lamzu/hid"),
    import("@openmouse/protocol/drivers/logitech/hidpp"),
    import("@openmouse/protocol/drivers/logitech/onboard-profiles"),
    import("@openmouse/protocol/drivers/magnetic"),
    import("@openmouse/protocol/logitech"),
    import("@openmouse/protocol/drivers/pulsar/pulsar-hid"),
    import("@openmouse/protocol/drivers/pulsar/pulsar-pro-hid"),
    import("@openmouse/protocol/drivers/pulsar/pulsar-xs1-hid"),
    import("@openmouse/protocol/drivers/orbital/hid"),
    import("@openmouse/protocol/drivers/razer/hid"),
    import("@openmouse/protocol/razer"),
    import("@openmouse/protocol/drivers/razer/viper-mini-hid"),
    import("@openmouse/protocol/drivers/razer/cobra-hid"),
    import("@openmouse/protocol/drivers/razer/viper-hid"),
    import("@openmouse/protocol/drivers/razer/viper-v4-pro-hid"),
    import("@openmouse/protocol/razer-devices"),
    import("@openmouse/protocol/drivers/finalmouse/hid"),
    import("@openmouse/protocol/drivers/moddo/hid"),
    import("@openmouse/protocol/drivers/ninjutso/hid"),
    import("@openmouse/protocol/drivers/zaunkoenig/hid"),
    import("@openmouse/protocol/drivers/corsair/hid"),
    import("@openmouse/protocol/drivers/corsair/bragi-hid"),
    import("@openmouse/protocol/drivers/teevolution/hid"),
    import("@openmouse/protocol/teevolution"),
    import("@openmouse/protocol/drivers/vgn/hid"),
    import("@openmouse/protocol/drivers/keychron/nape-hid"),
    import("@openmouse/protocol/drivers/keychron/mouse-8k-hid"),
    import("@openmouse/protocol/drivers/keychron/mouse-1k-hid"),
    import("@openmouse/protocol/drivers/keychron/mouse-4k-hid"),
    import("@openmouse/protocol/drivers/keychron/mouse-8k-nordic-hid"),
    import("@openmouse/protocol/drivers/glorious/hid"),
    import("@openmouse/protocol/drivers/glorious/classic-hid"),
    import("@openmouse/protocol/drivers/glorious/core2-hid"),
    import("@openmouse/protocol/drivers/mchose/hid"),
    import("@openmouse/protocol/drivers/mchose/dock-hid"),
    import("@openmouse/protocol/drivers/mchose/a5-gen1-hid"),
    import("@openmouse/protocol/drivers/mchose/v3-hid"),
    import("@openmouse/protocol/drivers/fantech/hid"),
    import("@openmouse/protocol/drivers/wallhack/mouse-hid"),
    import("@openmouse/protocol/drivers/wallhack/keyboard-hid"),
    import("@openmouse/protocol/drivers/wooting/hid"),
    import("@openmouse/protocol/keychron"),
    import("@openmouse/protocol/drivers/vendors"),
    import("@openmouse/protocol/drivers/wlmouse/hid"),
    import("@openmouse/protocol/drivers/wlmouse/beast-x-4k-hid"),
    import("@openmouse/protocol/drivers/microsoft/hid"),
    import("@openmouse/protocol/drivers/dareu/hid"),
    import("@openmouse/protocol/drivers/incott/hid"),
    import("@openmouse/protocol/drivers/bytech/hid"),
    import("@openmouse/protocol/drivers/fater/hid"),
    import("@openmouse/protocol/drivers/rapoo/hid"),
    import("@openmouse/protocol/drivers/coolermaster/hid"),
    import("@openmouse/protocol/drivers/ajazz/hid"),
    import("@openmouse/protocol/drivers/redragon/m690-pro-hid"),
    import("@openmouse/protocol/drivers/hitscan/hid"),
  ]).then((mods) => (loaded = Object.assign({}, ...mods) as DriverModules));
  return loading;
}

/** The loaded modules, or null before the load resolves. */
export function driverModules(): DriverModules | null {
  return loaded;
}
