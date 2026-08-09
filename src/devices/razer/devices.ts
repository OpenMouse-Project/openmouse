/**
 * Razer per-PID capability registry.
 *
 * Razer's protocol is not self-describing: nothing on the wire says which
 * commands a mouse answers, so the only way to know is a table keyed on the
 * exact product id. This is that table, kept apart from the transport in
 * `hid.ts` so adding a model is data rather than code.
 *
 * ## Provenance and what "supported" means here
 *
 * The product list and the transport grouping come from OpenRazer's public
 * supported-device table and mouse driver (see
 * `OPENRAZER_ALL_MICE_DEVELOPER_REFERENCE.md`). Only the seven entries marked
 * `verified: true` have been exercised against real hardware by this project —
 * everything else is transcribed protocol facts, not a tested driver.
 *
 * Nothing here is a guess about *packets*: every model below is driven by the
 * same 90-byte commands already confirmed on the Viper V3 Pro. What varies per
 * model, and what this table records, is which of those commands are valid,
 * which transaction id the mouse answers on, and what the sensor and radio can
 * actually do.
 *
 * ## Why an unverified entry is safe to ship
 *
 * - A wrong transaction id means the mouse never replies. `readStatus` throws
 *   on the firmware read and the panel reports a connection failure. Nothing
 *   is written.
 * - A wrong capability flag suppresses a command rather than inventing one.
 * - A wrong ceiling is caught by the read-back every setter already performs:
 *   the mouse keeps its own value, the driver notices and reports it.
 *
 * The one thing that would not be safe is sending a command a model does not
 * implement, so unverified models are given the conservative flags below and
 * the asymmetric lift-off *write probe* stays off for all of them.
 *
 * ## Deliberately absent
 *
 * - `legacy/old` (Orochi 2011 `0x0013`, DeathAdder 3.5G `0x0016`/`0x0029`).
 *   These predate the 90-byte report and need direct USB control writes, so
 *   this driver could only ever time out on them.
 * - Orochi V2 Bluetooth (`0x0095`). A Bluetooth HID path is not the USB
 *   control channel and must not be assumed to take the same reports.
 * - HyperPolling Wireless Dongle (`0x00b3`). It is a receiver, not a mouse;
 *   addressing the mouse paired to it needs dongle-specific commands that are
 *   not documented here.
 * - Viper Mini (`0x008a`) and Viper V4 Pro (`0x00e5`/`0x00e6`), which have
 *   their own drivers in this folder. Listing them here would give two drivers
 *   the same device.
 */

import {
  RAZER_TRANSACTION_ID_1F,
  RAZER_TRANSACTION_ID_3F,
  RAZER_TRANSACTION_ID_FF,
} from "./protocol.ts";

/**
 * OpenRazer's transport families. They differ in response timing, control
 * interface and which commands exist — not in packet layout.
 */
export type RazerTransport =
  | "standard"
  | "index3"
  | "atheris-receiver"
  | "viper-receiver"
  | "new-receiver";

export interface RazerProduct {
  model: string;
  wireless: boolean;
  pollingRates: readonly number[];
  /** Sensor ceiling, per axis. */
  maxDpi: number;
  /** Razer's per-generation transaction id; a mismatch means no reply at all. */
  transactionId: number;
  /** Battery commands only exist on models that have a cell. */
  hasBattery: boolean;
  /** Also accept a vendor-defined collection as the control interface. */
  vendorControlInterface?: boolean;
  transport: RazerTransport;
  /**
   * Use the extended polling command (a divisor of 8000) rather than the legacy
   * one (a divisor of 1000). This is a property of the generation, not of the
   * connection: the Viper 8KHz is wired and needs the extended command, while
   * the older HyperSpeed receivers are wireless and only answer the legacy one.
   */
  highRatePolling: boolean;
  /**
   * The mouse implements the class `0x0b` tracking distance.
   *
   * This cannot be probed. The Basilisk X HyperSpeed answers `0x0b`/`0x85` with
   * status `0x02` and an all-zero payload, which decodes as a legitimate
   * "Low" — so "the command replied" is not evidence the mouse has the feature,
   * and offering the control on that basis produced a picker where every level
   * failed: `0x01` was acknowledged and stored nothing, `0x02` was refused
   * outright.
   *
   * There is no reply that distinguishes "no lift-off control" from "Low at the
   * bottom of the range", so this has to be stated per product.
   */
  liftOff: boolean;
  /**
   * The mouse additionally stores separate lift-off and landing heights, and
   * the mode can be established by the pair write's own status.
   *
   * That probe is a *write*, so it is only enabled where the command has been
   * confirmed on hardware. Implies `liftOff`.
   */
  asymmetricLiftOff: boolean;
  /** Confirmed against real hardware by this project. */
  verified: boolean;
}

/** Everything a preset supplies. The transaction id is deliberately not here. */
type ProductDefaults = Omit<RazerProduct, "model" | "transactionId">;

// The cable tops out at 1000 Hz on the models verified so far, which is also
// the ceiling the legacy polling command can encode.
export const RATES_1K: readonly number[] = [125, 500, 1000];
export const RATES_8K: readonly number[] = [125, 500, 1000, 2000, 4000, 8000];

/**
 * Products answering on `0x3f`, audited against OpenRazer's mouse driver.
 *
 * ## Why this is a flat list and not a field on the transport presets
 *
 * It was a preset field, and that was wrong for 26 of the 107 products. The
 * transaction id does not follow the transport group, the connection, the
 * model's age or its marketing family — OpenRazer picks it per product id, and
 * the groups interleave all three values:
 *
 * - Basilisk `0x0064` is `0x3f` while Basilisk V2 `0x0085` is `0x1f` and
 *   Basilisk X HyperSpeed `0x0083` is `0xff`.
 * - Viper `0x0078` is `0xff`, Viper 8KHz `0x0091` is `0xff`, Viper Mini SE
 *   `0x009e` is `0x1f`.
 * - Inside one `new-receiver` group: Lancehead Wireless `0x006f` is `0x3f`,
 *   Pro Click `0x0077` is `0x1f`, Basilisk X HyperSpeed `0x0083` is `0xff`.
 *
 * A wrong id is silent — the mouse never replies — so there is no failure mode
 * to catch an inherited guess. Keeping the ids in one auditable block, rather
 * than spread across presets that imply a pattern, is what stops that
 * inheritance happening again.
 */
const TRANSACTION_3F: readonly number[] = [
  0x0050, 0x0059, 0x005a, 0x005c, 0x0060, 0x0064, 0x0065, 0x006f, 0x0070,
  0x0072, 0x0073, 0x007c, 0x007d, 0x0084, 0x008c,
  // --- Diverging from OpenRazer, on purpose ---------------------------------
  // Viper Ultimate. OpenRazer sends `0xff` on every command for both ids, but
  // a hardware report has `0x1f` silent and `0x3f` reading firmware, DPI,
  // polling and battery correctly. Observed behaviour wins over the reference,
  // and the mouse may well accept both. Worth re-testing against `0xff`.
  0x007a, 0x007b,
  // DeathAdder Essential. Predates this audit: the driver has always sent
  // `0x3f` here on the stated grounds that OpenRazer does, which the driver
  // source does not bear out — it lists all three ids under `0xff`. Left as it
  // was rather than changed blind, because nothing has connected one either
  // way. Flagged in TESTING.md as the next thing to check on this family.
  0x006e, 0x0071, 0x0098,
];

/** Products answering on `0x1f`. Same provenance as the list above. */
const TRANSACTION_1F: readonly number[] = [
  0x0062, 0x006c, 0x0077, 0x0080, 0x0085, 0x0086, 0x0088, 0x008d, 0x008f,
  0x0090, 0x0094, 0x0096, 0x0099, 0x009a, 0x009c, 0x009e, 0x009f, 0x00a1,
  0x00a5, 0x00a6, 0x00a7, 0x00a8, 0x00aa, 0x00ab, 0x00af, 0x00b0, 0x00b2,
  0x00b4, 0x00b6, 0x00b7, 0x00b8, 0x00b9, 0x00be, 0x00bf, 0x00c0, 0x00c1,
  0x00c2, 0x00c3, 0x00c4, 0x00c5, 0x00c7, 0x00c8, 0x00cb, 0x00cc, 0x00cd,
  0x00d0, 0x00d1, 0x00d3, 0x00d4, 0x00d6, 0x00d7,
];

/**
 * `0xff` is the fallback because it is the id the largest group uses, not
 * because it is safe to assume: a product missing from both lists above has
 * simply not been audited, and will be silent if `0xff` is wrong for it.
 */
function transactionIdFor(productId: number): number {
  if (TRANSACTION_3F.includes(productId)) return RAZER_TRANSACTION_ID_3F;
  if (TRANSACTION_1F.includes(productId)) return RAZER_TRANSACTION_ID_1F;
  return RAZER_TRANSACTION_ID_FF;
}

/**
 * Sensor ceilings by generation, from published specifications rather than from
 * the mouse — Razer exposes no "what is your maximum DPI" command. A ceiling
 * that is too high costs a failed read-back on a value the mouse will not hold;
 * one that is too low would refuse a value it would have taken, so these err
 * generous where a model's exact figure is not encoded in its name.
 */
const DPI_PRE_CHROMA = 8_200;
const DPI_CHROMA = 16_000;
const DPI_FOCUS = 20_000;
const DPI_FOCUS_PRO = 30_000;
const DPI_FOCUS_PRO_35K = 35_000;

/**
 * Chroma-era and older wired mice. OpenRazer's `standard` group answers on the
 * original transaction id, and which interface carries the control channel
 * varies by revision, so a vendor-defined collection is accepted too.
 */
const STANDARD = {
  transport: "standard",
  wireless: false,
  pollingRates: RATES_1K,
  maxDpi: DPI_CHROMA,
  hasBattery: false,
  vendorControlInterface: true,
  highRatePolling: false,
  liftOff: false,
  asymmetricLiftOff: false,
  verified: false,
} as const satisfies ProductDefaults;

/** Same generation, but a model with a cell and a charging dock or receiver. */
const STANDARD_WIRELESS = {
  ...STANDARD,
  wireless: true,
  hasBattery: true,
} as const satisfies ProductDefaults;

/**
 * OpenRazer routes Naga X, Basilisk V3 and Basilisk V3 35K through USB control
 * transfer index 3. WebHID cannot select a `wIndex`, so the browser has to be
 * pointed at the HID collection belonging to that interface instead: the picker
 * offers every interface and the wrong one simply never answers.
 */
const INDEX3 = {
  ...STANDARD,
  transport: "index3",
  maxDpi: DPI_FOCUS_PRO,
} as const satisfies ProductDefaults;

/** Atheris and Orochi V2 receivers, which need a longer response window. */
const ATHERIS_RECEIVER = {
  ...STANDARD,
  transport: "atheris-receiver",
  wireless: true,
  hasBattery: true,
  maxDpi: DPI_FOCUS,
} as const satisfies ProductDefaults;

/**
 * The modern HyperSpeed generation, wired half. These are wireless mice on a
 * cable, so they keep their battery commands; the cable itself runs at the
 * legacy ceiling.
 */
const MODERN_WIRED = {
  transport: "new-receiver",
  wireless: false,
  pollingRates: RATES_1K,
  maxDpi: DPI_FOCUS,
  hasBattery: true,
  highRatePolling: false,
  liftOff: false,
  asymmetricLiftOff: false,
  verified: false,
} as const satisfies ProductDefaults;

/** The stock 1000 Hz receiver these ship with. */
const MODERN_RECEIVER = {
  ...MODERN_WIRED,
  wireless: true,
  highRatePolling: true,
} as const satisfies ProductDefaults;

/**
 * Older HyperSpeed receivers, which predate the extended polling command and
 * answer only the legacy one.
 */
const LEGACY_RECEIVER = {
  ...MODERN_RECEIVER,
  highRatePolling: false,
} as const satisfies ProductDefaults;

/** Receivers that ship as HyperPolling dongles and reach 8000 Hz. */
const HYPERPOLLING_RECEIVER = {
  ...MODERN_RECEIVER,
  pollingRates: RATES_8K,
  maxDpi: DPI_FOCUS_PRO_35K,
} as const satisfies ProductDefaults;

/** Viper Ultimate / Viper Mini SE / DeathAdder V2 Pro timing group. */
const VIPER_RECEIVER_WIRED = {
  ...MODERN_WIRED,
  transport: "viper-receiver",
} as const satisfies ProductDefaults;

const VIPER_RECEIVER_WIRELESS = {
  ...MODERN_RECEIVER,
  transport: "viper-receiver",
} as const satisfies ProductDefaults;

/**
 * DeathAdder Essential family. 6400 DPI is the officially published maximum
 * and the ceiling the vendor software offers.
 *
 * Not verified: it shipped before this registry existed and TESTING.md has
 * always carried it under "not yet hardware-tested". An earlier revision of
 * this file marked it verified by mistake, which was wrong in both directions —
 * it suppressed the "untested model" label and armed the strict battery read.
 */
const DEATHADDER_ESSENTIAL = {
  transport: "standard",
  wireless: false,
  pollingRates: RATES_1K,
  maxDpi: 6400,
  hasBattery: false,
  vendorControlInterface: true,
  highRatePolling: false,
  liftOff: false,
  asymmetricLiftOff: false,
  verified: false,
} as const satisfies ProductDefaults;

const VIPER_V2_PRO = {
  transport: "new-receiver",
  maxDpi: DPI_FOCUS_PRO,
  hasBattery: true,
  // Stock receiver, not an 8K HyperPolling dongle.
  pollingRates: RATES_1K,
  liftOff: true,
  asymmetricLiftOff: true,
  verified: true,
} as const;

const VIPER_V3_PRO = {
  transport: "viper-receiver",
  maxDpi: DPI_FOCUS_PRO_35K,
  hasBattery: true,
  liftOff: true,
  asymmetricLiftOff: true,
  verified: true,
} as const;

/**
 * Every product this driver claims, before the audited transaction id is
 * attached. Build `RAZER_PRODUCTS` from this rather than reading it directly.
 *
 * The `verified: true` entries are the ones a hardware report has covered;
 * the rest come from the OpenRazer reference and have never been connected.
 */
const PRODUCT_DEFINITIONS: ReadonlyArray<[number, Omit<RazerProduct, "transactionId">]> = [
  // ---- Verified on hardware -------------------------------------------------
  [0x00a5, { model: "Viper V2 Pro", wireless: false, highRatePolling: false, ...VIPER_V2_PRO }],
  [0x00a6, { model: "Viper V2 Pro", wireless: true, highRatePolling: true, ...VIPER_V2_PRO }],
  [0x00c0, { model: "Viper V3 Pro", wireless: false, pollingRates: RATES_1K, highRatePolling: false, ...VIPER_V3_PRO }],
  [0x00c1, { model: "Viper V3 Pro", wireless: true, pollingRates: RATES_8K, highRatePolling: true, ...VIPER_V3_PRO }],
  [0x006e, { model: "DeathAdder Essential", ...DEATHADDER_ESSENTIAL }],
  [0x0071, { model: "DeathAdder Essential White Edition", ...DEATHADDER_ESSENTIAL }],
  [0x0098, { model: "DeathAdder Essential (2021)", ...DEATHADDER_ESSENTIAL }],

  // ---- standard: wired, original transaction id -----------------------------
  // Ceilings encoded in a model's own name are used as given; the rest take the
  // generation default.
  [0x0015, { model: "Naga", ...STANDARD, maxDpi: DPI_PRE_CHROMA }],
  [0x001f, { model: "Naga Epic", ...STANDARD, maxDpi: DPI_PRE_CHROMA }],
  [0x0020, { model: "Abyssus 1800", ...STANDARD, maxDpi: 1800 }],
  [0x0024, { model: "Mamba 2012 (Wired)", ...STANDARD, maxDpi: DPI_PRE_CHROMA }],
  [0x0025, { model: "Mamba 2012", ...STANDARD_WIRELESS, maxDpi: DPI_PRE_CHROMA }],
  [0x002e, { model: "Naga 2012", ...STANDARD, maxDpi: DPI_PRE_CHROMA }],
  [0x002f, { model: "Imperator 2012", ...STANDARD, maxDpi: DPI_PRE_CHROMA }],
  [0x0032, { model: "Ouroboros 2012", ...STANDARD, maxDpi: DPI_PRE_CHROMA }],
  [0x0034, { model: "Taipan", ...STANDARD, maxDpi: DPI_PRE_CHROMA }],
  [0x0036, { model: "Naga Hex (Red)", ...STANDARD, maxDpi: DPI_PRE_CHROMA }],
  [0x0037, { model: "DeathAdder 2013", ...STANDARD, maxDpi: 6400 }],
  [0x0038, { model: "DeathAdder 1800", ...STANDARD, maxDpi: 1800 }],
  [0x0039, { model: "Orochi 2013", ...STANDARD_WIRELESS, maxDpi: DPI_PRE_CHROMA }],
  [0x003e, { model: "Naga Epic Chroma (Wired)", ...STANDARD }],
  [0x003f, { model: "Naga Epic Chroma", ...STANDARD_WIRELESS }],
  [0x0040, { model: "Naga 2014", ...STANDARD, maxDpi: DPI_PRE_CHROMA }],
  [0x0041, { model: "Naga Hex", ...STANDARD }],
  [0x0042, { model: "Abyssus 2014", ...STANDARD, maxDpi: 1800 }],
  [0x0043, { model: "DeathAdder Chroma", ...STANDARD }],
  [0x0044, { model: "Mamba (Wired)", ...STANDARD }],
  [0x0045, { model: "Mamba", ...STANDARD_WIRELESS }],
  [0x0046, { model: "Mamba Tournament Edition", ...STANDARD }],
  [0x0048, { model: "Orochi (Wired)", ...STANDARD, maxDpi: DPI_PRE_CHROMA }],
  [0x004c, { model: "Diamondback Chroma", ...STANDARD }],
  [0x004f, { model: "DeathAdder 2000", ...STANDARD, maxDpi: 2000 }],
  [0x0050, { model: "Naga Hex V2", ...STANDARD }],
  [0x0053, { model: "Naga Chroma", ...STANDARD }],
  [0x0054, { model: "DeathAdder 3500", ...STANDARD, maxDpi: 3500 }],
  [0x0059, { model: "Lancehead (Wired)", ...STANDARD }],
  [0x005a, { model: "Lancehead", ...STANDARD_WIRELESS }],
  [0x005b, { model: "Abyssus V2", ...STANDARD, maxDpi: 5000 }],
  [0x005c, { model: "DeathAdder Elite", ...STANDARD }],
  [0x005e, { model: "Abyssus 2000", ...STANDARD, maxDpi: 2000 }],
  [0x0060, { model: "Lancehead Tournament Edition", ...STANDARD }],
  [0x0064, { model: "Basilisk", ...STANDARD }],
  [0x0065, { model: "Basilisk Essential", ...STANDARD, maxDpi: 6400 }],
  [0x0067, { model: "Naga Trinity", ...STANDARD }],
  [0x006a, { model: "Abyssus Elite (D.Va Edition)", ...STANDARD, maxDpi: 7200 }],
  [0x006b, { model: "Abyssus Essential", ...STANDARD, maxDpi: 7200 }],
  [0x006c, { model: "Mamba Elite", ...STANDARD }],
  [0x0078, { model: "Viper", ...STANDARD, maxDpi: DPI_FOCUS }],
  [0x0084, { model: "DeathAdder V2", ...STANDARD, maxDpi: DPI_FOCUS }],
  [0x0085, { model: "Basilisk V2", ...STANDARD, maxDpi: DPI_FOCUS }],
  [0x008c, { model: "DeathAdder V2 Mini", ...STANDARD, maxDpi: 8500 }],
  [0x008d, { model: "Naga Left-Handed Edition 2020", ...STANDARD, maxDpi: DPI_FOCUS }],
  // Wired, but the whole point of the model is 8000 Hz, which the legacy
  // polling command cannot encode.
  [0x0091, { model: "Viper 8KHz", ...STANDARD, maxDpi: DPI_FOCUS, pollingRates: RATES_8K, highRatePolling: true }],
  [0x00a1, { model: "DeathAdder V2 Lite", ...STANDARD, maxDpi: 8500 }],
  [0x00a3, { model: "Cobra", ...STANDARD, maxDpi: 8500 }],
  [0x00b2, { model: "DeathAdder V3", ...STANDARD, maxDpi: DPI_FOCUS_PRO }],

  // ---- index3: wired, control channel on USB interface 3 --------------------
  [0x0096, { model: "Naga X", ...INDEX3, maxDpi: 18_000 }],
  [0x0099, { model: "Basilisk V3", ...INDEX3, maxDpi: 26_000 }],
  [0x00cb, { model: "Basilisk V3 35K", ...INDEX3, maxDpi: DPI_FOCUS_PRO_35K }],

  // ---- atheris-receiver: longer receiver wait -------------------------------
  [0x0062, { model: "Atheris", ...ATHERIS_RECEIVER, maxDpi: 7200 }],
  [0x0094, { model: "Orochi V2", ...ATHERIS_RECEIVER, maxDpi: 18_000 }],

  // ---- viper-receiver -------------------------------------------------------
  [0x007a, { model: "Viper Ultimate (Wired)", ...VIPER_RECEIVER_WIRED }],
  [0x007b, { model: "Viper Ultimate", ...VIPER_RECEIVER_WIRELESS }],
  [0x007c, { model: "DeathAdder V2 Pro (Wired)", ...VIPER_RECEIVER_WIRED }],
  [0x007d, { model: "DeathAdder V2 Pro", ...VIPER_RECEIVER_WIRELESS }],
  [0x009e, { model: "Viper Mini Signature Edition (Wired)", ...VIPER_RECEIVER_WIRED, maxDpi: DPI_FOCUS_PRO }],
  [0x009f, { model: "Viper Mini Signature Edition", ...VIPER_RECEIVER_WIRELESS, maxDpi: DPI_FOCUS_PRO, pollingRates: RATES_8K }],
  // Verified on hardware with the stock HyperSpeed receiver, and the first
  // model to prove `highRatePolling` is genuinely per-PID rather than a
  // property of the transport group or of being wireless: this receiver
  // answers only the legacy divisor-of-1000 command and rejects the extended
  // one (`0x00`/`0x40`) as unsupported. 125/500/1000 Hz were each written and
  // read back.
  //
  // Do not "tidy" this back onto the group default. 0x00a6 is the standing
  // counter-example in the other direction — a 1000 Hz receiver that does use
  // the extended command — so neither the group nor the rate ceiling predicts
  // this, and it can only be settled per product.
  // Lift-off reported working here, so the tracking control stays on — but not
  // the asymmetric pair, which was never exercised. If this model turns out to
  // answer `0x0b`/`0x85` with zeros the way the Basilisk X HyperSpeed does, it
  // will show a permanent "Low" and refuse every level; that is the thing to
  // check before trusting it.
  [0x00b8, { model: "Viper V3 HyperSpeed", ...VIPER_RECEIVER_WIRELESS, highRatePolling: false, liftOff: true, maxDpi: DPI_FOCUS_PRO, verified: true }],

  // ---- new-receiver ---------------------------------------------------------
  [0x006f, { model: "Lancehead Wireless", ...LEGACY_RECEIVER, maxDpi: DPI_CHROMA }],
  [0x0070, { model: "Lancehead Wireless (Wired)", ...MODERN_WIRED, maxDpi: DPI_CHROMA }],
  [0x0072, { model: "Mamba Wireless", ...LEGACY_RECEIVER, maxDpi: DPI_CHROMA }],
  [0x0073, { model: "Mamba Wireless (Wired)", ...MODERN_WIRED, maxDpi: DPI_CHROMA }],
  [0x0077, { model: "Pro Click", ...LEGACY_RECEIVER, maxDpi: DPI_CHROMA }],
  [0x0080, { model: "Pro Click (Wired)", ...MODERN_WIRED, maxDpi: DPI_CHROMA }],
  [0x0083, { model: "Basilisk X HyperSpeed", ...LEGACY_RECEIVER, maxDpi: DPI_CHROMA }],
  [0x0086, { model: "Basilisk Ultimate (Wired)", ...MODERN_WIRED }],
  [0x0088, { model: "Basilisk Ultimate", ...LEGACY_RECEIVER }],
  [0x008f, { model: "Naga Pro (Wired)", ...MODERN_WIRED }],
  [0x0090, { model: "Naga Pro", ...LEGACY_RECEIVER }],
  [0x009a, { model: "Pro Click Mini", ...LEGACY_RECEIVER, maxDpi: 12_000 }],
  [0x009c, { model: "DeathAdder V2 X HyperSpeed", ...LEGACY_RECEIVER, maxDpi: 14_000 }],
  [0x00a7, { model: "Naga V2 Pro (Wired)", ...MODERN_WIRED, maxDpi: DPI_FOCUS_PRO }],
  [0x00a8, { model: "Naga V2 Pro", ...MODERN_RECEIVER, maxDpi: DPI_FOCUS_PRO }],
  [0x00aa, { model: "Basilisk V3 Pro (Wired)", ...MODERN_WIRED, maxDpi: DPI_FOCUS_PRO }],
  [0x00ab, { model: "Basilisk V3 Pro", ...MODERN_RECEIVER, maxDpi: DPI_FOCUS_PRO }],
  [0x00af, { model: "Cobra Pro (Wired)", ...MODERN_WIRED, maxDpi: DPI_FOCUS_PRO }],
  [0x00b0, { model: "Cobra Pro", ...MODERN_RECEIVER, maxDpi: DPI_FOCUS_PRO }],
  [0x00b4, { model: "Naga V2 HyperSpeed", ...LEGACY_RECEIVER, maxDpi: DPI_FOCUS_PRO }],
  [0x00b6, { model: "DeathAdder V3 Pro (Wired)", ...MODERN_WIRED, maxDpi: DPI_FOCUS_PRO }],
  [0x00b7, { model: "DeathAdder V3 Pro", ...MODERN_RECEIVER, maxDpi: DPI_FOCUS_PRO }],
  [0x00b9, { model: "Basilisk V3 X HyperSpeed", ...LEGACY_RECEIVER, maxDpi: 18_000 }],
  [0x00be, { model: "DeathAdder V4 Pro (Wired)", ...MODERN_WIRED, maxDpi: DPI_FOCUS_PRO_35K }],
  [0x00bf, { model: "DeathAdder V4 Pro", ...HYPERPOLLING_RECEIVER }],
  [0x00c2, { model: "DeathAdder V3 Pro (Wired)", ...MODERN_WIRED, maxDpi: DPI_FOCUS_PRO }],
  [0x00c3, { model: "DeathAdder V3 Pro", ...MODERN_RECEIVER, maxDpi: DPI_FOCUS_PRO }],
  [0x00c4, { model: "DeathAdder V3 HyperSpeed (Wired)", ...MODERN_WIRED, maxDpi: DPI_FOCUS_PRO }],
  [0x00c5, { model: "DeathAdder V3 HyperSpeed", ...LEGACY_RECEIVER, maxDpi: DPI_FOCUS_PRO }],
  [0x00c7, { model: "Pro Click V2 Vertical Edition (Wired)", ...MODERN_WIRED }],
  [0x00c8, { model: "Pro Click V2 Vertical Edition", ...LEGACY_RECEIVER }],
  [0x00cc, { model: "Basilisk V3 Pro 35K (Wired)", ...MODERN_WIRED, maxDpi: DPI_FOCUS_PRO_35K }],
  [0x00cd, { model: "Basilisk V3 Pro 35K", ...HYPERPOLLING_RECEIVER }],
  [0x00d0, { model: "Pro Click V2 (Wired)", ...MODERN_WIRED }],
  [0x00d1, { model: "Pro Click V2", ...LEGACY_RECEIVER }],
  [0x00d3, { model: "Basilisk Mobile (Wired)", ...MODERN_WIRED, maxDpi: 18_000 }],
  [0x00d4, { model: "Basilisk Mobile", ...LEGACY_RECEIVER, maxDpi: 18_000 }],
  [0x00d6, { model: "Basilisk V3 Pro 35K Phantom Green (Wired)", ...MODERN_WIRED, maxDpi: DPI_FOCUS_PRO_35K }],
  [0x00d7, { model: "Basilisk V3 Pro 35K Phantom Green", ...HYPERPOLLING_RECEIVER }],
];

/**
 * Every product, with its audited transaction id attached.
 *
 * Joined here rather than written into each row so there is exactly one place
 * the id can come from, and no preset can supply one by inheritance.
 */
export const RAZER_PRODUCTS: ReadonlyMap<number, RazerProduct> = new Map(
  PRODUCT_DEFINITIONS.map(([productId, product]) => [
    productId,
    { ...product, transactionId: transactionIdFor(productId) },
  ]),
);

/** Product ids for the WebHID picker filters in `../vendors.ts`. */
export const RAZER_PRODUCT_IDS: readonly number[] = [...RAZER_PRODUCTS.keys()];
