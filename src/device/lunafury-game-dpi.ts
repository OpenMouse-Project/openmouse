import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import type { LunaFuryDpiStorage } from "@openmouse/protocol/lamzu";
import type { GameProfileSnapshot } from "./game-profile-snapshot.ts";

export interface LunaFuryGameDpiPlan {
  count?: number;
  stages: Array<{ stage: number; x: number; y: number }>;
  activeStage?: number;
}

/** Scalars in older snapshots describe the target stage, not the old active one. */
export function lunaFuryGameDpiPlan(status: MouseStatus, snapshot: GameProfileSnapshot): LunaFuryGameDpiPlan | null {
  if (status.brand !== "LunaFury" || !status.ui?.dpiStageEditor || !status.dpiStages?.length || !status.dpiStagesY?.length) return null;
  const storage = snapshot.lunaFuryDpiStorage;
  const baselineX = storage ? storage.stages.slice(0, storage.count).map(stage => stage.x) : status.dpiStages;
  const baselineY = storage ? storage.stages.slice(0, storage.count).map(stage => stage.y) : status.dpiStagesY;
  const baselineActive = storage ? Math.min(status.activeDpiStage ?? 0, storage.count - 1) : status.activeDpiStage ?? 0;
  const separate = snapshot.lunafury?.separateDpiAxes ?? status.lunafury?.separateDpiAxes;
  const xs = snapshot.dpiStages?.length ? [...snapshot.dpiStages] : [...baselineX];
  const ys = xs.map((x, stage) => snapshot.dpiStagesY?.[stage]
    ?? (x !== baselineX[stage] && separate === false ? x : baselineY[stage] ?? x));
  const target = snapshot.activeDpiStage ?? baselineActive;
  if (Number.isInteger(target) && target >= 0 && target < xs.length) {
    if (snapshot.dpi != null) xs[target] = snapshot.dpi;
    if (snapshot.dpiY != null) ys[target] = snapshot.dpiY;
    else if (snapshot.dpi != null && separate === false && snapshot.dpi !== baselineX[target]) ys[target] = snapshot.dpi;
  }
  return {
    ...(xs.length !== baselineX.length && status.ui.dpiStageEditor.countEditable === true ? { count: xs.length } : {}),
    stages: xs.flatMap((x, stage) => x === baselineX[stage] && ys[stage] === baselineY[stage]
      ? [] : [{ stage, x, y: ys[stage] }]),
    ...(snapshot.activeDpiStage != null ? { activeStage: snapshot.activeDpiStage } : {}),
  };
}

/** Resolve lower-priority legacy scalars at their own stage before overlaying tables. */
export function canonicalLunaFuryDpiSnapshot(status: MouseStatus, snapshot: GameProfileSnapshot): GameProfileSnapshot {
  if (snapshot.dpi == null && snapshot.dpiY == null) return snapshot;
  const plan = lunaFuryGameDpiPlan(status, snapshot);
  if (!plan) return snapshot;
  const storage = snapshot.lunaFuryDpiStorage;
  const xs = snapshot.dpiStages?.slice() ?? storage?.stages.slice(0, storage.count).map(stage => stage.x) ?? status.dpiStages!.slice();
  const ys = xs.map((x, stage) => snapshot.dpiStagesY?.[stage] ?? storage?.stages[stage]?.y ?? status.dpiStagesY![stage] ?? x);
  for (const { stage, x, y } of plan.stages) { xs[stage] = x; ys[stage] = y; }
  const { dpi: _dpi, dpiY: _dpiY, ...rest } = snapshot;
  return { ...rest, dpiStages: xs, dpiStagesY: ys };
}

export function stageLunaFuryGameDpi(status: MouseStatus, snapshot: GameProfileSnapshot, actions: {
  storage(storage: LunaFuryDpiStorage): void;
  count(count: number): void;
  axes(stage: number, x: number, y: number): void;
  active(stage: number): void;
}): boolean {
  const plan = lunaFuryGameDpiPlan(status, snapshot);
  if (!plan) return false;
  if (snapshot.lunaFuryDpiStorage) {
    // Compose the final table before staging. Restoring first would make the
    // ordinary count/slot setters deduplicate and order against stale hardware.
    const target = structuredClone(snapshot.lunaFuryDpiStorage);
    if (plan.count != null) target.count = plan.count;
    for (const { stage, x, y } of plan.stages) target.stages[stage] = { x, y };
    if (JSON.stringify(target) !== JSON.stringify(status.lunafury?.dpiStorage)) actions.storage(target);
  } else {
    if (plan.count != null) actions.count(plan.count);
    for (const { stage, x, y } of plan.stages) actions.axes(stage, x, y);
  }
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
  if ((plan.stages.length > 0 || plan.count != null) && status.lunafury?.dpiStorage) {
    picked.lunaFuryDpiStorage = structuredClone(status.lunafury.dpiStorage);
  }
  if (((snapshot.dpi != null || snapshot.dpiY != null || snapshot.dpiStages?.length) && plan.stages.length > 0) || plan.count != null) {
    picked.dpiStages = [...status.dpiStages!];
    picked.dpiStagesY = [...status.dpiStagesY!];
    delete picked.dpi;
    delete picked.dpiY;
  }
  if (plan.count != null && status.activeDpiStage != null) picked.activeDpiStage = status.activeDpiStage;
}
