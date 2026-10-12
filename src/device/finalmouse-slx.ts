import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";

/**
 * Starlight X (SLX) helpers for the Finalmouse family.
 *
 * The wire protocol lives in `@openmouse/protocol/finalmouse`; this module
 * only reads the status fields the SLX-capable driver fills in. The numeric
 * mirrors below must match the protocol package (command 31/53/55/57+,
 * xpanel 2.6.2) — they are duplicated here instead of imported so the app
 * still compiles against a protocol release that predates SLX support.
 * Runtime calls always go through `SlxClient` feature detection, so old
 * drivers simply report their methods missing.
 */

/** 0 = mechanical switch, 1 = TMR analog (xpanel click-mode reply order). */
export const SLX_CLICK_MECHANICAL = 0;
export const SLX_CLICK_ANALOG = 1;

/** Release point: 0 normal (default), 1 early, 2 late. */
export const SLX_RELEASE_NORMAL = 0;
export const SLX_RELEASE_EARLY = 1;
export const SLX_RELEASE_LATE = 2;

/** Actuation range in 0.01 mm steps, and rapid-trigger range in µm. */
export const SLX_TMR = {
  actuationMinSteps: 1,
  actuationMaxSteps: 40,
  rtMinUm: 150,
  rtMaxUm: 250,
  rtStepUm: 10,
  rtRecommendedUm: 220,
} as const;

/** Extra status fields an SLX-capable driver fills in. */
export interface SlxStatusFields {
  finalmouseIsSlx?: boolean | null;
  finalmouseClickModeL?: number | null;
  finalmouseClickModeR?: number | null;
  finalmouseClickReleaseL?: number | null;
  finalmouseClickReleaseR?: number | null;
  finalmouseTmrThrL?: number | null;
  finalmouseTmrThrR?: number | null;
  finalmouseTmrHystL?: number | null;
  finalmouseTmrHystR?: number | null;
  finalmouseTmrMspL?: number | null;
  finalmouseTmrMspR?: number | null;
  finalmousePawLodMm?: number | null;
  finalmousePawLodCustom?: boolean | null;
  finalmouseProfileCount?: number | null;
  finalmouseProfileActive?: number | null;
  finalmouseProfileEnabledMask?: number | null;
  finalmouseProfileNames?: Record<number, string> | null;
}

export type SlxStatus = MouseStatus & SlxStatusFields;

function fields(status: MouseStatus | null | undefined): SlxStatusFields {
  return (status ?? {}) as SlxStatusFields;
}

/** True when the connected driver reported a Starlight X dongle. */
export function isSlxStatus(status: MouseStatus | null | undefined): boolean {
  return fields(status).finalmouseIsSlx === true;
}

/** TMR click-mode / actuation / MSP snapshot, or null when not reported. */
export function slxTmr(status: MouseStatus | null | undefined): {
  modeL: number;
  modeR: number;
  relL: number | null;
  relR: number | null;
  thrL: number | null;
  thrR: number | null;
  hystL: number | null;
  hystR: number | null;
  mspL: number | null;
  mspR: number | null;
} | null {
  const f = fields(status);
  if (f.finalmouseClickModeL == null || f.finalmouseClickModeR == null) return null;
  return {
    modeL: f.finalmouseClickModeL,
    modeR: f.finalmouseClickModeR,
    relL: f.finalmouseClickReleaseL ?? null,
    relR: f.finalmouseClickReleaseR ?? null,
    thrL: f.finalmouseTmrThrL ?? null,
    thrR: f.finalmouseTmrThrR ?? null,
    hystL: f.finalmouseTmrHystL ?? null,
    hystR: f.finalmouseTmrHystR ?? null,
    mspL: f.finalmouseTmrMspL ?? null,
    mspR: f.finalmouseTmrMspR ?? null,
  };
}

/** Profile roster snapshot, or null when the driver did not report one. */
export function slxProfiles(status: MouseStatus | null | undefined): {
  count: number;
  active: number;
  enabledMask: number | null;
  names: Record<number, string>;
} | null {
  const f = fields(status);
  if (f.finalmouseProfileCount == null || f.finalmouseProfileActive == null) return null;
  return {
    count: f.finalmouseProfileCount,
    active: f.finalmouseProfileActive,
    enabledMask: f.finalmouseProfileEnabledMask ?? null,
    names: f.finalmouseProfileNames ?? {},
  };
}

/** Driver methods an SLX-capable client exposes. All are optional at runtime. */
export interface SlxClient {
  setClickMode?(modeL: number, modeR: number, relL?: number, relR?: number): Promise<unknown>;
  setTmrActuation?(actuationMmL: number, actuationMmR: number, rtUmL?: number, rtUmR?: number): Promise<unknown>;
  setPawLodMm?(mm: number): Promise<number>;
  setActiveProfile?(index: number): Promise<number>;
  setProfileName?(index: number, name: string): Promise<string>;
  setProfileEnabled?(index: number, enabled: boolean): Promise<boolean>;
}

export function slxClientOf(client: unknown): SlxClient | null {
  if (!client || typeof client !== "object") return null;
  const candidate = client as SlxClient;
  return typeof candidate.setClickMode === "function"
    || typeof candidate.setTmrActuation === "function"
    || typeof candidate.setPawLodMm === "function"
    || typeof candidate.setActiveProfile === "function"
    ? candidate
    : null;
}

/** Steps (0.01 mm units) to millimetres for display. */
export function tmrStepsToMm(steps: number): number {
  return Math.min(0.4, Math.max(0.01, Math.round(steps) / 100));
}

/** Millimetres to steps, clamped to the 1-40 device range. */
export function tmrMmToSteps(mm: number): number {
  return Math.min(SLX_TMR.actuationMaxSteps, Math.max(SLX_TMR.actuationMinSteps, Math.round(mm * 100)));
}
