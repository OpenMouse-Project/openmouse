const f32 = Math.fround;

export const ASCII_RAMP = " .:-=+*#%@";
export const ASCII_ROWS = 40;
export const ASCII_MIN_COLS = 24;
export const ASCII_MAX_COLS = 104;
export const ASCII_FONT_PX = 11;
export const ASCII_LINE = 1.4;
export const ASCII_SWEEP_MS = 520;
export const ASCII_SWEEP_OFFSET = 220;
export const ASCII_SWEEP_STAGGER = 0.55;

const SHARE = f32(0.42);
const CELL_WIDTH = f32(f32(ASCII_FONT_PX) * f32(0.6));
const ALPHA = f32(0.24);
const FADE_SPAN = f32(1 - f32(0.55));
const STAGGER = f32(ASCII_SWEEP_STAGGER);
const SWEEP_SPAN = f32(1 - STAGGER);
const CELL_ASPECT = f32(0.43);
const ORIGIN_X = f32(1.02);
const ORIGIN_Y = f32(-0.04);
const REACH = f32(0.62);
const GLOW_POWER = f32(1.1);
const GRID_COLS = f32(14);

export type AsciiSeed = readonly [number, number];
export type AsciiField = { cols: number; seed: AsciiSeed; rows: string[] };

function lattice(x: number, y: number): number {
  let h = (Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return f32((h & 0xffff) / 65535);
}

function smooth(t: number): number {
  return f32(f32(t * t) * f32(3 - f32(2 * t)));
}

function lerp(a: number, b: number, t: number): number {
  return f32(a + f32(f32(b - a) * t));
}

function valueNoise(x: number, y: number): number {
  const xf = Math.floor(x);
  const yf = Math.floor(y);
  const fx = smooth(f32(x - xf));
  const fy = smooth(f32(y - yf));
  const top = lerp(lattice(xf, yf), lattice(xf + 1, yf), fx);
  const bottom = lerp(lattice(xf, yf + 1), lattice(xf + 1, yf + 1), fx);
  return lerp(top, bottom, fy);
}

export function asciiGlowRows(cols: number, rows: number, seed: AsciiSeed): string[] {
  const len = ASCII_RAMP.length;
  const gridRows = Math.max(2, Math.round(f32(f32(GRID_COLS * rows) / f32(Math.max(cols, 1) * CELL_ASPECT))));
  const ox = f32(ORIGIN_X * cols);
  const oy = f32(ORIGIN_Y * rows);
  const radius = f32(f32(REACH * cols) * CELL_ASPECT);
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    let line = "";
    for (let x = 0; x < cols; x++) {
      const d = f32(f32(Math.hypot(f32(f32(x - ox) * CELL_ASPECT), f32(y - oy))) / radius);
      const glow = f32(Math.pow(Math.max(f32(1 - d), 0), GLOW_POWER));
      const noise = valueNoise(
        f32(f32(f32(x / cols) * GRID_COLS) + seed[0]),
        f32(f32(f32(y / rows) * gridRows) + seed[1]),
      );
      const jitter = f32(f32(lattice(x + 7919, y - 104_729) - 0.5) * f32(0.06));
      const level = f32(f32(glow * f32(f32(0.6) + f32(f32(0.4) * noise))) + jitter);
      const index = Math.min(Math.max(Math.floor(f32(f32(level * len) * f32(1.35))), 0), len - 1);
      line += ASCII_RAMP[index];
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function asciiColumns(viewportWidth: number): number {
  const raw = Math.trunc(f32(f32(f32(viewportWidth) * SHARE) / CELL_WIDTH));
  return Math.min(Math.max(Number.isFinite(raw) ? Math.max(raw, 0) : 0, ASCII_MIN_COLS), ASCII_MAX_COLS);
}

export function asciiRowAlpha(position: number): number {
  const s = Math.min(Math.max(f32(f32(1 - position) / FADE_SPAN), 0), 1);
  return f32(f32(f32(ALPHA * s) * s) * f32(3 - f32(2 * s)));
}

export function asciiSweepOffset(delta: number, position: number): number {
  const local = Math.min(Math.max(f32(f32(delta - f32(position * STAGGER)) / SWEEP_SPAN), 0), 1);
  const rest = f32(1 - local);
  const eased = f32(1 - f32(f32(rest * rest) * rest));
  return f32(f32(1 - eased) * ASCII_SWEEP_OFFSET);
}

export function asciiSeedFrom(nanos: number): [number, number] {
  const n = nanos >>> 0;
  return [f32(f32(n % 997) * f32(1.37)), f32(f32(Math.floor(n / 997) % 991) * f32(0.73))];
}

let sessionSeed: [number, number] | null = null;

export function asciiSessionSeed(): [number, number] {
  if (!sessionSeed) {
    const bits = new Uint32Array(1);
    globalThis.crypto.getRandomValues(bits);
    sessionSeed = asciiSeedFrom(bits[0]!);
  }
  return sessionSeed;
}

export function nextAsciiField(previous: AsciiField | null, viewportWidth: number, seed: AsciiSeed): AsciiField {
  const cols = asciiColumns(viewportWidth);
  if (previous && previous.cols === cols && previous.seed === seed) return previous;
  return { cols, seed, rows: asciiGlowRows(cols, ASCII_ROWS, seed) };
}

export function asciiRowTiming(index: number): { position: number; alpha: number; delayMs: number; durationMs: number } {
  const position = f32(f32(index + 0.5) / ASCII_ROWS);
  return {
    position,
    alpha: asciiRowAlpha(position),
    delayMs: position * ASCII_SWEEP_STAGGER * ASCII_SWEEP_MS,
    durationMs: (1 - ASCII_SWEEP_STAGGER) * ASCII_SWEEP_MS,
  };
}

export function asciiSweepRuns({ reducedMotion, prefersReducedMotion }: { reducedMotion: boolean; prefersReducedMotion: boolean }): boolean {
  return !reducedMotion && !prefersReducedMotion;
}
