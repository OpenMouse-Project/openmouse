import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import type { GameProfileSnapshot } from "./game-profile-snapshot.ts";

export interface LunaFuryGameDpiPlan {
  count?: number;
  stages: Array<{ stage: number; x: number; y: number }>;
  activeStage?: number;
}

/** Scalars in older snapshots describe the target stage, not the old active one. */
export function lunaFuryGameDpiPlan(status: MouseStatus, snapshot: GameProfileSnapshot): LunaFuryGameDpiPlan | null {
  if (status.brand !== "LunaFury" || !status.ui?.dpiStageEditor || !status.dpiStages?.length || !status.dpiStagesY?.length) return null;
  const separate = snapshot.lunafury?.separateDpiAxes ?? status.lunafury?.separateDpiAxes;
  const xs = snapshot.dpiStages?.length ? [...snapshot.dpiStages] : [...status.dpiStages];
  const ys = xs.map((x, stage) => snapshot.dpiStagesY?.[stage]
    ?? (x !== status.dpiStages![stage] && separate === false ? x : status.dpiStagesY![stage] ?? x));
  const target = snapshot.activeDpiStage ?? status.activeDpiStage ?? 0;
  if (Number.isInteger(target) && target >= 0 && target < xs.length) {
    if (snapshot.dpi != null) xs[target] = snapshot.dpi;
    if (snapshot.dpiY != null) ys[target] = snapshot.dpiY;
    else if (snapshot.dpi != null && separate === false && snapshot.dpi !== status.dpiStages[target]) ys[target] = snapshot.dpi;
  }
  return {
    ...(xs.length !== status.dpiStages.length && status.ui.dpiStageEditor.countEditable === true ? { count: xs.length } : {}),
    stages: xs.flatMap((x, stage) => x === status.dpiStages![stage] && ys[stage] === status.dpiStagesY![stage]
      ? [] : [{ stage, x, y: ys[stage] }]),
    ...(snapshot.activeDpiStage != null ? { activeStage: snapshot.activeDpiStage } : {}),
  };
}

export function stageLunaFuryGameDpi(status: MouseStatus, snapshot: GameProfileSnapshot, actions: {
  count(count: number): void;
  axes(stage: number, x: number, y: number): void;
  active(stage: number): void;
}): boolean {
  const plan = lunaFuryGameDpiPlan(status, snapshot);
  if (!plan) return false;
  if (plan.count != null) actions.count(plan.count);
  for (const { stage, x, y } of plan.stages) actions.axes(stage, x, y);
  if (plan.activeStage != null) actions.active(plan.activeStage);
  return true;
}

/** Stage selection changes the displayed DPI without editing either table. */
export function withoutDerivedLunaFuryDpi(status: MouseStatus, snapshot: GameProfileSnapshot): GameProfileSnapshot {
  if (!lunaFuryGameDpiPlan(status, {}) || !(snapshot.dpiStages?.length || snapshot.dpiStagesY?.length || snapshot.activeDpiStage != null)) return snapshot;
  const { dpi: _dpi, dpiY: _dpiY, ...rest } = snapshot;
  return rest;
}

/** X/scalar edits also back up Y storage, including values dormant under axis lock. */
export function preserveLunaFuryDpiTables(status: MouseStatus, snapshot: GameProfileSnapshot, picked: GameProfileSnapshot): void {
  const plan = lunaFuryGameDpiPlan(status, snapshot);
  if (!plan) return;
  if (((snapshot.dpi != null || snapshot.dpiY != null || snapshot.dpiStages?.length) && plan.stages.length > 0) || plan.count != null) {
    picked.dpiStages = [...status.dpiStages!];
    picked.dpiStagesY = [...status.dpiStagesY!];
    delete picked.dpi;
    delete picked.dpiY;
  }
  if (plan.count != null && status.activeDpiStage != null) picked.activeDpiStage = status.activeDpiStage;
}
