/** Official numeric inputs clamp to the sensor range and round down to 50 DPI. */
export function lunaFuryDpiInput(raw: string, max = 30000): number {
  const value = Number(raw);
  return Math.min(max, Math.max(50, Number.isFinite(value) ? Math.floor(value / 50) * 50 : 50));
}
