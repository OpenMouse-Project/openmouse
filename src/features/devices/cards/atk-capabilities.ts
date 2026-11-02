import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import { ATK_BUTTON_CLASS, ATK_R1_MACRO_START_TYPES } from "@openmouse/protocol/atk";

type AtkCatalogFeatures = MouseStatus["atkCatalogFeatures"];

type AtkMacroBinding = {
  keyClass: number;
  value1: number;
  value2: number;
};

/**
 * Sensor sampling modes this mouse exposes: Basic (0) and Shard (1) on models
 * flagged noAthleticsMax, otherwise the full Basic/Shard/Shard MAX set.
 */
export function atkSensorModes(features: AtkCatalogFeatures): Array<0 | 1 | 2> {
  return features?.noAthleticsMax === true ? [0, 1] : [0, 1, 2];
}

export function atkVisibleButtons<T extends { id: string }>(
  buttons: readonly T[] | undefined,
  features: AtkCatalogFeatures,
): T[] {
  const rows = buttons ? [...buttons] : [];
  return features?.noBottomButton === true
    ? rows.filter((row) => row.id !== "bottom")
    : rows;
}

/** R1-family mice expose the shared button record format and macro slots. */
export function atkSupportsMacroBindings(status: MouseStatus | null | undefined): boolean {
  return status?.ui?.family === "atk"
    && status.brand === "VXE"
    && /^VXE R1(?:\s|$|SE)/i.test(status.name ?? "")
    && (status.atkButtonMappings?.length ?? 0) > 0;
}

/** Playback mode belongs to one button-slot binding, not to the slot alone. */
export function atkMacroBindingStartType(
  mapping: AtkMacroBinding | undefined,
  slot: number,
): number {
  return mapping?.keyClass === ATK_BUTTON_CLASS.macro && mapping.value1 === slot
    ? mapping.value2
    : ATK_R1_MACRO_START_TYPES.stopImmediately;
}
