// Vendor-catalog capability helpers for the ATK cards.
//
// Kept as pure functions in a .ts module so they can be unit-tested with
// `node --test` (which cannot load the .tsx cards). The ATK driver reports the
// vendor HUB's per-model capability flags on `status.atkCatalogFeatures`; the
// cards use these to show only the controls a given mouse actually has.

import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";

type AtkCatalogFeatures = MouseStatus["atkCatalogFeatures"];

/**
 * Sensor sampling modes this mouse exposes: Basic (0) and Shard (1) on models
 * flagged noAthleticsMax, otherwise the full Basic/Shard/Shard MAX set.
 */
export function atkSensorModes(features: AtkCatalogFeatures): Array<0 | 1 | 2> {
  return features?.noAthleticsMax === true ? [0, 1] : [0, 1, 2];
}

/**
 * Button rows to display: drops the underside (`bottom`) row on models flagged
 * noBottomButton.
 */
export function atkVisibleButtons<T extends { id: string }>(
  buttons: readonly T[] | undefined,
  features: AtkCatalogFeatures,
): T[] {
  const rows = buttons ? [...buttons] : [];
  return features?.noBottomButton === true
    ? rows.filter((row) => row.id !== "bottom")
    : rows;
}
