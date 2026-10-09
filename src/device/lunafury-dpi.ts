/** Official numeric inputs clamp to the sensor range and round down to 50 DPI. */
export function lunaFuryDpiInput(raw: string, max = 30000): number {
  const value = Number(raw);
  return Math.min(max, Math.max(50, Number.isFinite(value) ? Math.floor(value / 50) * 50 : 50));
}

/** Keep X/Y pairs together when the shared editor removes a middle stage. */
export function lunaFuryDpiEdits(
  rows: readonly { enabled: boolean; x: number; y?: number }[],
  currentX: readonly number[],
  currentY: readonly number[],
  separate: boolean,
): Array<{ stage: number; x: number; y: number }> {
  return rows.filter((row) => row.enabled).flatMap((row, stage) => {
    const y = separate ? row.y ?? row.x : row.x;
    return currentX[stage] === row.x && currentY[stage] === y ? [] : [{ stage, x: row.x, y }];
  });
}
