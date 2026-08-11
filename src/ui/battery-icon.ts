import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";

export type BatteryIconState = "charging" | "dead" | "low" | "ok" | "unknown";

export const LOW_BATTERY_PERCENT = 20;

const CHARGING_STATES: ReadonlySet<MouseStatus["batteryState"]> = new Set([
  "Charging",
  "Charging slowly",
  "Almost full",
]);

export function batteryIconState(
  percent: number | null | undefined,
  state: MouseStatus["batteryState"],
): BatteryIconState {
  if (CHARGING_STATES.has(state)) return "charging";
  if (state === "Full") return "ok";
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return "unknown";
  if (percent <= 0) return "dead";
  if (percent < LOW_BATTERY_PERCENT) return "low";
  return "ok";
}

export function batteryNeedsCharging(
  percent: number | null | undefined,
  state: MouseStatus["batteryState"],
): boolean {
  const kind = batteryIconState(percent, state);
  return kind === "low" || kind === "dead";
}

export function batteryLevel(
  percent: number | null | undefined,
  state: MouseStatus["batteryState"],
): number | null {
  if (state === "Full") return 100;
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return null;
  return Math.max(0, Math.min(100, percent));
}

const TRACK_X = 2.85;
const TRACK_Y = 2.85;
const TRACK_WIDTH = 19.3;
const TRACK_HEIGHT = 9.3;
const TRACK_RADIUS = 2.1;

const MIN_VISIBLE_WIDTH = 1.4;

export function batteryFillWidth(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  if (clamped <= 0) return 0;
  return Math.max(MIN_VISIBLE_WIDTH, (TRACK_WIDTH * clamped) / 100);
}

const BOLT = "M14.3 3.1 9.3 9.2h3.1l-.9 3.9 5.2-6.2h-3.1l.7-3.8Z";
const DEAD_CROSS = "m9.9 5.7 5.2 3.9M15.1 5.7 9.9 9.6";

function fillRect(width: number, masked: boolean): string {
  return `<rect class="battery-fill"${masked ? ` mask="url(#battery-bolt-mask)"` : ""} x="${TRACK_X}" y="${TRACK_Y}" width="${width.toFixed(2)}" height="${TRACK_HEIGHT}" rx="${TRACK_RADIUS}"/>`;
}

export function batteryIconMarkup(
  percent: number | null | undefined,
  state: MouseStatus["batteryState"],
): string {
  const kind = batteryIconState(percent, state);
  const level = batteryLevel(percent, state);
  let inner = "";
  if (kind === "charging") {
    inner = `<mask id="battery-bolt-mask">
      <rect x="0" y="0" width="30" height="15" fill="#fff"/>
      <path d="${BOLT}" fill="#000" stroke="#000" stroke-width="1.8" stroke-linejoin="round"/>
    </mask>${level === null ? "" : fillRect(batteryFillWidth(level), true)}<path class="battery-bolt" d="${BOLT}"/>`;
  } else if (kind === "dead") {
    inner = `<path class="battery-dead" d="${DEAD_CROSS}"/>`;
  } else if (level !== null) {
    inner = fillRect(batteryFillWidth(level), false);
  }
  return `<svg class="battery-icon is-${kind}" viewBox="0 0 30 15" aria-hidden="true" focusable="false">
    <rect class="battery-shell" x="0.85" y="0.85" width="23.3" height="13.3" rx="3.6"/>
    <rect class="battery-cap" x="25.5" y="4.9" width="2.7" height="5.2" rx="1.35"/>
    <rect class="battery-track" x="${TRACK_X}" y="${TRACK_Y}" width="${TRACK_WIDTH}" height="${TRACK_HEIGHT}" rx="${TRACK_RADIUS}"/>
    ${inner}
  </svg>`;
}

export function renderBatteryIcon(
  container: HTMLElement,
  percent: number | null | undefined,
  state: MouseStatus["batteryState"],
): void {
  const kind = batteryIconState(percent, state);
  const level = batteryLevel(percent, state);
  const svg = container.querySelector("svg");
  const fill = svg?.querySelector<SVGRectElement>(".battery-fill");
  const sameShape = svg?.classList.contains(`is-${kind}`) === true && (level === null) === (fill === null);
  if (!sameShape) {
    container.innerHTML = batteryIconMarkup(percent, state);
    return;
  }
  if (fill && level !== null) fill.setAttribute("width", batteryFillWidth(level).toFixed(2));
}
