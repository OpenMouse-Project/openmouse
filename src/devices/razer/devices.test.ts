import assert from "node:assert/strict";
import test from "node:test";

import { RAZER_PRODUCTS, RAZER_PRODUCT_IDS, RATES_1K, RATES_8K } from "./devices.ts";
import {
  RAZER_TRANSACTION_ID,
  RAZER_TRANSACTION_ID_FF,
  RAZER_TRANSACTION_ID_3F,
  razerSetExtendedPollingCommand,
  razerSetLegacyPollingCommand,
} from "./protocol.ts";
import { VIPER_MINI_PRODUCT_ID } from "./viper-mini-hid.ts";
import { VIPER_V4_PRO_PRODUCTS } from "./viper-v4-pro-hid.ts";

interface VerifiedProfile {
  model: string;
  wireless: boolean;
  maxDpi: number;
  transactionId: number;
  rates: readonly number[];
  highRate: boolean;
}

/**
 * The models the driver already treated as verified before the OpenRazer
 * registry was added. `highRatePolling` was read off `wireless` back then, so
 * these seven also pin that the refactor changed no behaviour — see the
 * separate test below, which is a claim about *these* products rather than
 * about verified products in general.
 */
const REFACTOR_BASELINE: ReadonlyArray<[number, VerifiedProfile]> = [
  [0x00a5, { model: "Viper V2 Pro", wireless: false, maxDpi: 30000, transactionId: RAZER_TRANSACTION_ID, rates: RATES_1K, highRate: false }],
  [0x00a6, { model: "Viper V2 Pro", wireless: true, maxDpi: 30000, transactionId: RAZER_TRANSACTION_ID, rates: RATES_1K, highRate: true }],
  [0x00c0, { model: "Viper V3 Pro", wireless: false, maxDpi: 35000, transactionId: RAZER_TRANSACTION_ID, rates: RATES_1K, highRate: false }],
  [0x00c1, { model: "Viper V3 Pro", wireless: true, maxDpi: 35000, transactionId: RAZER_TRANSACTION_ID, rates: RATES_8K, highRate: true }],
  [0x006e, { model: "DeathAdder Essential", wireless: false, maxDpi: 6400, transactionId: RAZER_TRANSACTION_ID_3F, rates: RATES_1K, highRate: false }],
  [0x0071, { model: "DeathAdder Essential White Edition", wireless: false, maxDpi: 6400, transactionId: RAZER_TRANSACTION_ID_3F, rates: RATES_1K, highRate: false }],
  [0x0098, { model: "DeathAdder Essential (2021)", wireless: false, maxDpi: 6400, transactionId: RAZER_TRANSACTION_ID_3F, rates: RATES_1K, highRate: false }],
];

/** Models promoted by a hardware report since. */
const VERIFIED_SINCE: ReadonlyArray<[number, VerifiedProfile]> = [
  // Reported against the stock HyperSpeed receiver: the extended polling
  // command is refused as unsupported, and 125/500/1000 Hz each round-tripped
  // on the legacy one.
  [0x00b8, { model: "Viper V3 HyperSpeed", wireless: true, maxDpi: 30000, transactionId: RAZER_TRANSACTION_ID, rates: RATES_1K, highRate: false }],
];

const VERIFIED = [...REFACTOR_BASELINE, ...VERIFIED_SINCE];

/**
 * Products a hardware report has actually covered.
 *
 * Deliberately smaller than REFACTOR_BASELINE: the DeathAdder Essential family
 * shipped with the driver but TESTING.md has always listed it as "not yet
 * hardware-tested", so it is pinned like the others without claiming to be
 * verified.
 */
const HARDWARE_VERIFIED: readonly number[] = [0x00a5, 0x00a6, 0x00c0, 0x00c1, 0x00b8];

test("every pinned product keeps exactly the profile it was given", () => {
  // A silent change to any of these would only show up on hardware, which is
  // the one place this project cannot re-run on demand.
  for (const [productId, expected] of VERIFIED) {
    const product = RAZER_PRODUCTS.get(productId);
    assert.ok(product, `0x${productId.toString(16)} is missing from the registry`);
    assert.equal(product.model, expected.model);
    assert.equal(product.wireless, expected.wireless);
    assert.equal(product.maxDpi, expected.maxDpi);
    assert.equal(product.transactionId, expected.transactionId);
    assert.deepEqual([...product.pollingRates], [...expected.rates]);
    assert.equal(product.highRatePolling, expected.highRate);
  }
});

test("splitting the polling command off `wireless` changed nothing for the models that predate it", () => {
  // The driver used to choose the polling command with `isWireless()`. For the
  // seven products that existed then the two must still agree, or the refactor
  // silently moved one of them onto the other encoding.
  for (const [productId, expected] of REFACTOR_BASELINE) {
    const product = RAZER_PRODUCTS.get(productId);
    assert.equal(product?.highRatePolling, product?.wireless, `0x${productId.toString(16)}`);
    assert.equal(product?.highRatePolling, expected.highRate);
  }
});

test("a wireless model can still answer only the legacy polling command", () => {
  // The reason the two are separate fields. 0x00b8 is wireless and refuses the
  // extended command; 0x00a6 is wireless, tops out at 1000 Hz too, and accepts
  // it. Neither the transport group nor the rate ceiling predicts which, so a
  // rule inferred from either would be wrong about one of these two.
  const hyperSpeed = RAZER_PRODUCTS.get(0x00b8);
  const viperV2 = RAZER_PRODUCTS.get(0x00a6);
  assert.equal(hyperSpeed?.wireless, true);
  assert.equal(hyperSpeed?.highRatePolling, false);
  assert.equal(viperV2?.wireless, true);
  assert.equal(viperV2?.highRatePolling, true);
  // Same ceiling, opposite encoding: the rate list cannot be what decides.
  assert.deepEqual([...hyperSpeed?.pollingRates ?? []], [...viperV2?.pollingRates ?? []]);
});

test("only models connected by this project claim to be verified", () => {
  // `verified` drives the "untested model" label and whether a failed battery
  // read is fatal, so it must mean "someone plugged one in", not "shipped for
  // a while".
  const verified = RAZER_PRODUCT_IDS.filter((id) => RAZER_PRODUCTS.get(id)?.verified === true);
  assert.deepEqual([...verified].sort(), [...HARDWARE_VERIFIED].sort());
});

test("the DeathAdder Essential family does not claim to be tested", () => {
  // TESTING.md carries it under "not yet hardware-tested", and an earlier
  // revision of the registry contradicted that.
  for (const productId of [0x006e, 0x0071, 0x0098]) {
    assert.equal(RAZER_PRODUCTS.get(productId)?.verified, false, `0x${productId.toString(16)}`);
  }
});

test("lift-off is only offered where the mouse is known to have it", () => {
  // A model without lift-off can still answer 0x0b/0x85: the Basilisk X
  // HyperSpeed replies status 0x02 with zeros, which decode as "Low". Offering
  // the control on a successful read gave a picker where Medium was silently
  // ignored and High was refused, on a mouse with no lift-off control at all.
  const offered = RAZER_PRODUCT_IDS.filter((id) => RAZER_PRODUCTS.get(id)?.liftOff === true);
  assert.deepEqual(offered.sort(), [0x00a5, 0x00a6, 0x00b8, 0x00c0, 0x00c1]);
  for (const id of offered) {
    assert.equal(RAZER_PRODUCTS.get(id)?.verified, true, `0x${id.toString(16)} offers lift-off without being verified`);
  }
});

test("the asymmetric pair is never armed without the tracking control", () => {
  // The pair write is a superset: `setLiftOff` reads the same 0x0b/0x85 reply
  // back, so a product claiming the pair but not the level would probe a
  // command whose reply it does not trust.
  for (const [productId, product] of RAZER_PRODUCTS) {
    if (!product.asymmetricLiftOff) continue;
    assert.equal(product.liftOff, true, `0x${productId.toString(16)} claims the pair but not the level`);
  }
});

test("the asymmetric lift-off write probe is only armed where it was confirmed", () => {
  // Establishing the mode is a write, so an unverified model must not be sent
  // one during an ordinary status read.
  const armed = RAZER_PRODUCT_IDS.filter((id) => RAZER_PRODUCTS.get(id)?.asymmetricLiftOff === true);
  assert.deepEqual(armed.sort(), [0x00a5, 0x00a6, 0x00c0, 0x00c1]);
  for (const id of armed) assert.equal(RAZER_PRODUCTS.get(id)?.verified, true);
});

test("no product is claimed by both this registry and a dedicated Razer driver", () => {
  // `driverFor` returns the first match in DEVICE_DRIVERS, so an overlap would
  // silently kill whichever driver is registered later.
  assert.equal(RAZER_PRODUCTS.has(VIPER_MINI_PRODUCT_ID), false);
  for (const productId of VIPER_V4_PRO_PRODUCTS.keys()) {
    assert.equal(RAZER_PRODUCTS.has(productId), false, `0x${productId.toString(16)} also has a Viper V4 Pro driver`);
  }
});

test("families that cannot work over this transport are left out", () => {
  // Orochi 2011 and the two DeathAdder 3.5G ids predate the 90-byte report and
  // need direct USB control writes; 0x0095 is a Bluetooth path, and 0x00b3 is a
  // dongle rather than a mouse. Listing any of them would produce a device that
  // connects and then times out.
  for (const productId of [0x0013, 0x0016, 0x0029, 0x0095, 0x00b3]) {
    assert.equal(RAZER_PRODUCTS.has(productId), false, `0x${productId.toString(16)} cannot be driven by this transport`);
  }
});

test("every product answers on a transaction id the protocol defines", () => {
  // A wrong id is silent — the mouse simply never replies — so an id outside
  // the three known ones would be a guess with no failure mode to catch it.
  const known = new Set([RAZER_TRANSACTION_ID, RAZER_TRANSACTION_ID_3F, RAZER_TRANSACTION_ID_FF]);
  for (const [productId, product] of RAZER_PRODUCTS) {
    assert.equal(known.has(product.transactionId), true, `0x${productId.toString(16)} uses an unknown transaction id`);
  }
});

/**
 * The transaction id every product is expected to answer on, transcribed from
 * the id OpenRazer's `razer_attr_read_firmware_version()` selects — the gating
 * first read, so a product that disagrees there cannot be reached at all.
 *
 * What this does and does not buy, stated plainly because the difference
 * matters: this list and the one in `devices.ts` were transcribed from the same
 * reading of the driver, in one sitting, by the same person. They are two
 * copies of one transcription, not two independent readings. A misreading of
 * the driver is therefore present in both and this test will not catch it.
 *
 * What it does catch is drift — an id edited in `devices.ts` without a
 * corresponding decision here — and it forces every deliberate divergence to be
 * declared in EXPECTED_DIVERGENCE with its evidence rather than sitting in the
 * table looking like an audited value. Independent confirmation only comes from
 * connecting the mouse.
 */
const OPENRAZER_TRANSACTION_IDS: ReadonlyMap<number, number> = new Map([
  ...[
    0x0050, 0x0059, 0x005a, 0x005c, 0x0060, 0x0064, 0x0065, 0x006f, 0x0070,
    0x0072, 0x0073, 0x007c, 0x007d, 0x0084, 0x008c,
  ].map((id) => [id, 0x3f] as const),
  ...[
    0x0062, 0x006c, 0x0077, 0x0080, 0x0085, 0x0086, 0x0088, 0x008d, 0x008f,
    0x0090, 0x0094, 0x0096, 0x0099, 0x009a, 0x009c, 0x009e, 0x009f, 0x00a1,
    0x00a5, 0x00a6, 0x00a7, 0x00a8, 0x00aa, 0x00ab, 0x00af, 0x00b0, 0x00b2,
    0x00b4, 0x00b6, 0x00b7, 0x00b8, 0x00b9, 0x00be, 0x00bf, 0x00c0, 0x00c1,
    0x00c2, 0x00c3, 0x00c4, 0x00c5, 0x00c7, 0x00c8, 0x00cb, 0x00cc, 0x00cd,
    0x00d0, 0x00d1, 0x00d3, 0x00d4, 0x00d6, 0x00d7,
  ].map((id) => [id, 0x1f] as const),
]);

/** Products where this driver knowingly sends something else, and why. */
const EXPECTED_DIVERGENCE: ReadonlyMap<number, { ours: number; openRazer: number; why: string }> = new Map([
  [0x007a, { ours: 0x3f, openRazer: 0xff, why: "hardware report: 0x1f silent, 0x3f reads correctly" }],
  [0x007b, { ours: 0x3f, openRazer: 0xff, why: "hardware report: 0x1f silent, 0x3f reads correctly" }],
  [0x006e, { ours: 0x3f, openRazer: 0xff, why: "predates the audit; untested either way" }],
  [0x0071, { ours: 0x3f, openRazer: 0xff, why: "predates the audit; untested either way" }],
  [0x0098, { ours: 0x3f, openRazer: 0xff, why: "predates the audit; untested either way" }],
]);

test("every transaction id matches OpenRazer, or is a divergence with a reason", () => {
  // This field has no failure mode that reaches the user as anything but
  // silence, so it is checked product by product against the reference rather
  // than inherited from a transport group — which is how 26 of them were wrong.
  const wrong: string[] = [];
  for (const [productId, product] of RAZER_PRODUCTS) {
    const divergence = EXPECTED_DIVERGENCE.get(productId);
    const expected = divergence?.ours ?? OPENRAZER_TRANSACTION_IDS.get(productId) ?? 0xff;
    if (product.transactionId !== expected) {
      wrong.push(`0x${productId.toString(16).padStart(4, "0")} ${product.model}:`
        + ` sends 0x${product.transactionId.toString(16)}, expected 0x${expected.toString(16)}`);
    }
  }
  assert.deepEqual(wrong, [], "A transaction id disagrees with the OpenRazer audit and is not a listed divergence.");
});

test("each declared divergence really does differ from OpenRazer", () => {
  // Otherwise the list accumulates entries that no longer say anything, and the
  // next person cannot tell which ones still need a decision.
  for (const [productId, divergence] of EXPECTED_DIVERGENCE) {
    assert.notEqual(divergence.ours, divergence.openRazer, `0x${productId.toString(16)} is listed but does not diverge`);
    assert.equal(OPENRAZER_TRANSACTION_IDS.has(productId), false,
      `0x${productId.toString(16)} is in both the audit map and the divergence list`);
    assert.ok(divergence.why.length > 0);
  }
});

test("every advertised polling rate can be encoded by the command that model uses", () => {
  // The two encodings are divisors of 1000 and 8000, so a rate that divides
  // neither would be offered in the panel and then rejected by the builder.
  for (const [productId, product] of RAZER_PRODUCTS) {
    for (const rate of product.pollingRates) {
      const build = () => (product.highRatePolling
        ? razerSetExtendedPollingCommand(rate)
        : razerSetLegacyPollingCommand(rate));
      assert.doesNotThrow(build, `0x${productId.toString(16)} cannot encode ${rate} Hz`);
    }
  }
});

test("a model is only offered rates above 1000 Hz when it uses the extended command", () => {
  // The legacy command encodes a divisor of 1000, so it cannot express a faster
  // rate at all.
  for (const [productId, product] of RAZER_PRODUCTS) {
    if (product.highRatePolling) continue;
    const fastest = Math.max(...product.pollingRates);
    assert.ok(fastest <= 1000, `0x${productId.toString(16)} offers ${fastest} Hz on the legacy command`);
  }
});

test("every product has a usable DPI range", () => {
  for (const [productId, product] of RAZER_PRODUCTS) {
    assert.ok(Number.isInteger(product.maxDpi), `0x${productId.toString(16)} has a non-integer ceiling`);
    // 100 is the floor the driver offers, so a lower ceiling would leave the
    // DPI control with nothing to show.
    assert.ok(product.maxDpi >= 100, `0x${productId.toString(16)} has a ceiling below the 100 DPI floor`);
    assert.ok(product.pollingRates.length > 0, `0x${productId.toString(16)} advertises no polling rate`);
    assert.ok(product.model.length > 0);
  }
});

test("only wireless-capable models are sent battery commands", () => {
  // An unsupported reply to the battery read aborts the whole status read, so a
  // wired-only model must never be asked. The converse is not true: a wireless
  // mouse on its cable still has a cell.
  for (const [productId, product] of RAZER_PRODUCTS) {
    if (!product.wireless) continue;
    assert.equal(product.hasBattery, true, `0x${productId.toString(16)} is wireless but reports no battery`);
  }
});

test("the picker filter list covers every product in the registry", () => {
  // Built from the same map, so this guards the wiring rather than the data:
  // an id in the registry with no filter can never reach the driver.
  assert.equal(RAZER_PRODUCT_IDS.length, RAZER_PRODUCTS.size);
  assert.equal(new Set(RAZER_PRODUCT_IDS).size, RAZER_PRODUCT_IDS.length, "duplicate product id");
});

test("the catch-all filter does not widen a filter that was deliberately narrowed", async () => {
  // The Viper V2/V3 collection filters are limited to known ids so they cannot
  // surface Razer keyboards or the V4 Pro's boot-mouse interfaces. A whole-device
  // filter for the same id would put those interfaces back in the picker.
  const { RAZER_REGISTRY_FILTERS, SUPPORTED_HID_FILTERS, VENDOR_ID } = await import("../vendors.ts");

  const broad = new Set(RAZER_REGISTRY_FILTERS.map((filter) => filter.productId));
  for (const productId of [0x00a5, 0x00a6, 0x00c0, 0x00c1, 0x006e, 0x0071, 0x0098]) {
    assert.equal(broad.has(productId), false, `0x${productId.toString(16)} is filtered twice`);
  }
  // Every registry id still reaches the picker, through one filter or another.
  const offered = SUPPORTED_HID_FILTERS
    .filter((filter) => filter.vendorId === VENDOR_ID.razer && filter.productId !== undefined)
    .map((filter) => filter.productId);
  for (const productId of RAZER_PRODUCT_IDS) {
    assert.ok(offered.includes(productId), `0x${productId.toString(16)} is not offered in the picker`);
  }
});
