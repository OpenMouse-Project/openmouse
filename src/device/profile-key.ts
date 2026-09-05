import type { MouseLightingMode, MouseStatus } from "@openmouse/protocol/drivers/mouse-types";

/**
 * Exportable profile keys: a base64 blob a user can copy out of Settings,
 * save anywhere, and paste back in — on this machine or another — to carry
 * their mouse's settings over to a different unit of the *same model*.
 *
 * Only fields with a matching generic `apply*` in controller.ts are
 * captured. Anything staged from the key is queued as an ordinary pending
 * change, same as editing the control by hand — nothing is written until
 * the user flashes it.
 */

const KEY_VERSION = 1;
const KEY_PREFIX = "OMK1:";

export interface ProfileKeyLighting {
  zoneIndex: number;
  mode?: MouseLightingMode;
  color?: string;
  color2?: string;
  speed?: number;
  brightness?: number;
}

export interface ProfileKeyPayload {
  v: typeof KEY_VERSION;
  /** Identifies the exact model this key was captured from. */
  brand: MouseStatus["brand"];
  name: string;
  dpi?: number;
  dpiStages?: number[];
  activeDpiStage?: number;
  pollingRateHz?: number;
  liftOffDistance?: MouseStatus["liftOffDistance"];
  wheelMode?: MouseStatus["wheelMode"];
  smartShiftThreshold?: number | null;
  hiResScroll?: boolean | null;
  invertScroll?: boolean | null;
  thumbWheelInverted?: boolean | null;
  lighting?: ProfileKeyLighting[];
}

export function buildProfileKeyPayload(status: MouseStatus): ProfileKeyPayload {
  const lighting: ProfileKeyLighting[] = [];
  const zones = status.lightingZones ?? (status.lighting ? [status.lighting] : []);
  zones.forEach((zone, zoneIndex) => {
    if (!zone.mode) return;
    lighting.push({
      zoneIndex,
      mode: zone.mode,
      color: zone.color ?? undefined,
      color2: zone.color2 ?? undefined,
      speed: zone.speed ?? undefined,
      brightness: zone.brightness ?? undefined,
    });
  });

  return {
    v: KEY_VERSION,
    brand: status.brand,
    name: status.name,
    dpi: status.dpi,
    dpiStages: status.dpiStages ? [...status.dpiStages] : undefined,
    activeDpiStage: status.activeDpiStage,
    pollingRateHz: status.pollingRateHz,
    liftOffDistance: status.liftOffDistance ?? undefined,
    wheelMode: status.wheelMode,
    smartShiftThreshold: status.smartShiftThreshold ?? undefined,
    hiResScroll: status.hiResScroll,
    invertScroll: status.invertScroll,
    thumbWheelInverted: status.thumbWheelInverted,
    lighting: lighting.length > 0 ? lighting : undefined,
  };
}

export function encodeProfileKey(status: MouseStatus): string {
  const payload = buildProfileKeyPayload(status);
  const json = JSON.stringify(payload);
  const base64 = btoa(unescape(encodeURIComponent(json)));
  return `${KEY_PREFIX}${base64}`;
}

export type DecodeResult =
  | { ok: true; payload: ProfileKeyPayload }
  | { ok: false; error: string };

export function decodeProfileKey(rawKey: string): DecodeResult {
  const trimmed = rawKey.trim();
  if (!trimmed) return { ok: false, error: "Paste a profile key first." };
  const base64 = trimmed.startsWith(KEY_PREFIX) ? trimmed.slice(KEY_PREFIX.length) : trimmed;
  let json: string;
  try {
    json = decodeURIComponent(escape(atob(base64)));
  } catch {
    return { ok: false, error: "That doesn't look like a valid profile key." };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return { ok: false, error: "That doesn't look like a valid profile key." };
  }
  if (
    typeof payload !== "object" || payload === null
    || !("v" in payload) || (payload as { v: unknown }).v !== KEY_VERSION
    || !("brand" in payload) || !("name" in payload)
  ) {
    return { ok: false, error: "This key is from an incompatible OpenMouse version." };
  }
  return { ok: true, payload: payload as ProfileKeyPayload };
}

/** A key only carries over to the exact model it was exported from. */
export function profileKeyMatchesDevice(payload: ProfileKeyPayload, status: MouseStatus): boolean {
  return payload.brand === status.brand && payload.name === status.name;
}
