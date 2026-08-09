import assert from "node:assert/strict";
import test from "node:test";

import { RAZER_PRODUCTS, RAZER_PRODUCT_IDS, RATES_1K, RATES_8K } from "./devices.ts";
import {
  RAZER_TRANSACTION_ID,
  RAZER_TRANSACTION_ID_DEFAULT,
  RAZER_TRANSACTION_ID_LEGACY,
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
  [0x006e, { model: "DeathAdder Essential", wireless: false, maxDpi: 6400, transactionId: RAZER_TRANSACTION_ID_LEGACY, rates: RATES_1K, highRate: false }],
  [0x0071, { model: "DeathAdder Essential White Edition", wireless: false, maxDpi: 6400, transactionId: RAZER_TRANSACTION_ID_LEGACY, rates: RATES_1K, highRate: false }],
  [0x0098, { model: "DeathAdder Essential (2021)", wireless: false, maxDpi: 6400, transactionId: RAZER_TRANSACTION_ID_LEGACY, rates: RATES_1K, highRate: false }],
];

/** Models promoted by a hardware report since. */
const VERIFIED_SINCE: ReadonlyArray<[number, VerifiedProfile]> = [
  // Reported against the stock HyperSpeed receiver: the extended polling
  // command is refused as unsupported, and 125/500/1000 Hz each round-tripped
  // on the legacy one.
  [0x00b8, { model: "Viper V3 HyperSpeed", wireless: true, maxDpi: 30000, transactionId: RAZER_TRANSACTION_ID, rates: RATES_1K, highRate: false }],
];

const VERIFIED = [...REFACTOR_BASELINE, ...VERIFIED_SINCE];

test("the models verified on hardware keep exactly the profile they were given", () => {
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
    assert.equal(product.verified, true);
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
  const verified = RAZER_PRODUCT_IDS.filter((id) => RAZER_PRODUCTS.get(id)?.verified === true);
  assert.deepEqual(verified.sort(), VERIFIED.map(([id]) => id).sort());
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
  const known = new Set([RAZER_TRANSACTION_ID, RAZER_TRANSACTION_ID_LEGACY, RAZER_TRANSACTION_ID_DEFAULT]);
  for (const [productId, product] of RAZER_PRODUCTS) {
    assert.equal(known.has(product.transactionId), true, `0x${productId.toString(16)} uses an unknown transaction id`);
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
