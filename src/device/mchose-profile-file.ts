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
  // The same table sizes the parser accepts, so a saved file always loads back.
  const complete = state.travel.length === 128 && colors?.length === 128 && state.keymap.length === 4 && state.keymap.every((layer) => layer.length === 128)
    && advanced?.dks.length === 32 && advanced.modTap.length === 32 && advanced.toggle.length === 32;
  if (!settings || !lighting || !advanced || !colors || !complete) return null;
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
  const isObject = (value: unknown): boolean => typeof value === "object" && value !== null;
  const isAction = (value: unknown): boolean => isObject(value)
    && ["type", "code1", "code2"].every((field) => typeof (value as Record<string, unknown>)[field] === "number");
  const isNumbers = (value: unknown, fields: readonly string[]): boolean => isObject(value)
    && fields.every((field) => typeof (value as Record<string, unknown>)[field] === "number");
  const TRAVEL_FIELDS = ["pressPrecision", "releasePrecision", "actuation", "keyMode", "rapidTriggerPress", "rapidTriggerRelease", "pressDeadzone", "releaseDeadzone", "switchType", "priority"];
  const tables = file.advanced;
  // Every advanced-key slot the keymap points at must be in the file, or the key would lose its binding.
  const bound = (action: MchoseAction): boolean => {
    const table = action.type === 0x90 ? tables?.dks : action.type === 0x91 ? tables?.toggle : action.type >= 0x92 && action.type <= 0x95 ? tables?.modTap : null;
    const entry = table?.[action.code1] as Record<string, unknown> | null | undefined;
    if (!table) return true;
    // The entry the key points at must be complete for its kind, not just present.
    if (action.type === 0x90) return isObject(entry) && Array.isArray(entry!.points) && Array.isArray(entry!.actions);
    if (action.type === 0x91) return isAction(entry);
    return isObject(entry) && isAction(entry!.tap) && isAction(entry!.hold);
  };
  const complete = typeof file.settings === "object" && file.settings !== null
    && typeof file.lighting === "object" && file.lighting !== null
    && isList(file.travel, 128) && isList(file.colors, 128)
    && isList(file.keymap, 4) && file.keymap!.every((layer) => isList(layer, 128))
    && !!tables && isList(tables.dks, 32) && isList(tables.modTap, 32) && isList(tables.toggle, 32)
    // Entries too, so a damaged file is refused before the first write rather than part-way through.
    && file.keymap!.every((layer) => layer.every((action) => isAction(action) && bound(action)))
    && file.travel!.every((key) => isNumbers(key, TRAVEL_FIELDS)) && file.colors!.every((color) => isNumbers(color, ["r", "g", "b"]));
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
