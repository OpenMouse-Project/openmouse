import type {
  MchoseAction,
  MchoseAdvancedKeys,
  MchoseKeyTravel,
  MchoseKeyTravelUpdate,
  MchoseLighting,
  MchoseRgb,
  MchoseSettings,
} from "@openmouse/keyboard-protocol/mchose";
import type { MchoseWorkspace } from "./mchose-workspace.ts";

/**
 * One MCHOSE onboard profile saved to a file: everything the profile holds on
 * the keyboard. Macros are shared by every profile, so they are left out.
 */
export interface MchoseProfileFile {
  format: typeof MCHOSE_PROFILE_FORMAT;
  version: 1;
  product: string;
  productId: number;
  firmware: string;
  name: string | null;
  pollingHz: number | null;
  settings: MchoseSettings;
  lighting: MchoseLighting;
  /** Key-travel records by matrix slot, in the firmware's own steps. */
  travel: MchoseKeyTravel[];
  /** Four layers of 128 matrix slots. */
  keymap: MchoseAction[][];
  advanced: MchoseAdvancedKeys;
  colors: MchoseRgb[];
}

export const MCHOSE_PROFILE_FORMAT = "openmouse.mchose-profile";

/** The file for the workspace's active profile, or null while part of it is still unread. */
export function mchoseProfileFile(state: MchoseWorkspace): MchoseProfileFile | null {
  const { settings, lighting, advanced, colors } = state;
  if (!settings || !lighting || !advanced || !colors || state.travel.length === 0 || state.keymap.length === 0) return null;
  return {
    format: MCHOSE_PROFILE_FORMAT,
    version: 1,
    product: state.product.name,
    productId: state.product.productId,
    firmware: state.info.firmwareVersion,
    name: state.profileNames[state.profile] ?? null,
    pollingHz: state.performance?.pollingHz ?? null,
    settings,
    lighting,
    travel: [...state.travel],
    keymap: state.keymap.map((layer) => [...layer]),
    advanced,
    colors: [...colors],
  };
}

/**
 * Parse a profile file for this product. Only the shape is checked here; the
 * values go through the protocol's own range checks when they are written.
 */
export function parseMchoseProfileFile(text: string, productId: number): MchoseProfileFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RangeError("not-profile");
  }
  const file = data as Partial<MchoseProfileFile> | null;
  if (!file || file.format !== MCHOSE_PROFILE_FORMAT || file.version !== 1) throw new RangeError("not-profile");
  if (file.productId !== productId) throw new RangeError("other-product");
  const isList = (value: unknown, length: number): boolean => Array.isArray(value) && value.length === length;
  const tables = file.advanced;
  const complete = typeof file.settings === "object" && file.settings !== null
    && typeof file.lighting === "object" && file.lighting !== null
    && isList(file.travel, 128) && isList(file.colors, 128)
    && isList(file.keymap, 4) && file.keymap!.every((layer) => isList(layer, 128))
    && !!tables && isList(tables.dks, 32) && isList(tables.modTap, 32) && isList(tables.toggle, 32);
  if (!complete) throw new RangeError("not-profile");
  return file as MchoseProfileFile;
}

/** A travel record as the update that writes it back. */
export function mchoseTravelRestore(index: number, key: MchoseKeyTravel): MchoseKeyTravelUpdate {
  return {
    index,
    pressPrecision: key.pressPrecision,
    releasePrecision: key.releasePrecision,
    actuation: key.actuation,
    rapidTrigger: key.keyMode === 1,
    rapidTriggerPress: key.rapidTriggerPress,
    rapidTriggerRelease: key.rapidTriggerRelease,
    pressDeadzone: key.pressDeadzone,
    releaseDeadzone: key.releaseDeadzone,
    switchType: key.switchType,
    priority: key.priority,
  };
}

const sameAction = (a: MchoseAction | undefined, b: MchoseAction): boolean => !!a && a.type === b.type && a.code1 === b.code1 && a.code2 === b.code2;

/** Keymap updates per layer that turn `current` into `target`, skipping slots that already match. */
export function mchoseKeymapChanges(current: readonly (readonly MchoseAction[])[], target: readonly (readonly MchoseAction[])[]): { index: number; action: MchoseAction }[][] {
  return target.map((layer, n) => layer.flatMap((action, index) => (sameAction(current[n]?.[index], action) ? [] : [{ index, action }])));
}

/** A name for the downloaded file, from the product and profile names. */
export function mchoseProfileFileName(file: MchoseProfileFile, fallback: string): string {
  const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug(file.product) || "mchose"}-${slug(file.name ?? "") || slug(fallback) || "profile"}.json`;
}
