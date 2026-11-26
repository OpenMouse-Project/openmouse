import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { KeychronCurve } from "@openmouse/keyboard-protocol/keychron";
import { CURVE_MAX_Y, CURVE_X_STEP_MM, setCurvePoint } from "../../../device/keychron-curve";
import { tp } from "../../../i18n/index";
import type { InterfaceLocale } from "../../settings/interface-preferences";

const LEFT = 34;
const RIGHT = 12;
const TOP = 12;
const BOTTOM = 26;
const PLOT_W = 280;
const PLOT_H = 200;
const WIDTH = LEFT + PLOT_W + RIGHT;
const HEIGHT = TOP + PLOT_H + BOTTOM;
const Y_TICKS = [0, 32, 64, 96, CURVE_MAX_Y];

const fixed = (value: number): string => String(Number(value.toFixed(2)));

/**
 * The response curve: key travel in millimetres across, output 0 to 127 up.
 * Points drag with a pointer and move with the arrow keys (Shift for 10 steps).
 * Every move goes through `setCurvePoint`, so a byte can never leave its range.
 */
export function KeychronCurveGraph({ curve, maxX, locale, disabled, active, onActive, onChange }: {
  curve: KeychronCurve;
  maxX: number;
  locale: InterfaceLocale;
  disabled: boolean;
  active: number | null;
  onActive: (index: number | null) => void;
  onChange: (next: KeychronCurve) => void;
}): ReactNode {
  const svg = useRef<SVGSVGElement>(null);
  const px = (x: number): number => LEFT + (x / maxX) * PLOT_W;
  const py = (y: number): number => TOP + PLOT_H - (y / CURVE_MAX_Y) * PLOT_H;
  const drag = (index: number, event: PointerEvent<SVGCircleElement>): void => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const scale = WIDTH / box.width;
    const x = (((event.clientX - box.left) * scale - LEFT) / PLOT_W) * maxX;
    const y = (1 - ((event.clientY - box.top) * scale - TOP) / PLOT_H) * CURVE_MAX_Y;
    onChange(setCurvePoint(curve, index, x, y, maxX));
  };
  const nudge = (index: number, event: KeyboardEvent<SVGCircleElement>): void => {
    const step = event.shiftKey ? 10 : 1;
    const [x, y] = curve[index]!;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const delta = move[event.key];
    if (!delta || disabled) return;
    event.preventDefault();
    onChange(setCurvePoint(curve, index, x + delta[0], y + delta[1], maxX));
  };
  const mmTicks = Array.from({ length: Math.floor(maxX * CURVE_X_STEP_MM) + 1 }, (_, mm) => mm / CURVE_X_STEP_MM);
  if (mmTicks[mmTicks.length - 1] !== maxX) mmTicks.push(maxX);
  return (
    <svg ref={svg} className="keychron-curve" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label={tp(locale, "kb.keychronCurveGraph", { max: fixed(maxX * CURVE_X_STEP_MM) })}>
      {mmTicks.map((x) => <path key={`x${x}`} className="keychron-curve-grid" d={`M${px(x)} ${TOP}V${TOP + PLOT_H}`} />)}
      {Y_TICKS.map((y) => <path key={`y${y}`} className="keychron-curve-grid" d={`M${LEFT} ${py(y)}H${LEFT + PLOT_W}`} />)}
      {mmTicks.map((x) => <text key={`xt${x}`} className="keychron-curve-tick" x={px(x)} y={HEIGHT - 8} textAnchor="middle">{fixed(x * CURVE_X_STEP_MM)}</text>)}
      {Y_TICKS.map((y) => <text key={`yt${y}`} className="keychron-curve-tick" x={LEFT - 6} y={py(y) + 4} textAnchor="end">{y}</text>)}
      <polyline className="keychron-curve-line" points={curve.map(([x, y]) => `${px(x)},${py(y)}`).join(" ")} />
      {curve.map(([x, y], index) => (
        <circle key={index} className={`keychron-curve-point${active === index ? " is-active" : ""}`} cx={px(x)} cy={py(y)} r={7}
          tabIndex={disabled ? -1 : 0} role="slider" aria-disabled={disabled}
          aria-label={tp(locale, "kb.keychronCurvePoint", { n: index + 1 })}
          aria-valuetext={tp(locale, "kb.keychronCurveReadout", { n: index + 1, mm: fixed(x * CURVE_X_STEP_MM), out: y, x, y })}
          aria-valuemin={0} aria-valuemax={maxX} aria-valuenow={x}
          onPointerDown={(event) => { if (!disabled) event.currentTarget.setPointerCapture(event.pointerId); onActive(index); }}
          onPointerMove={(event) => drag(index, event)}
          onPointerEnter={() => onActive(index)} onPointerLeave={() => onActive(null)}
          onFocus={() => onActive(index)} onBlur={() => onActive(null)}
          onKeyDown={(event) => nudge(index, event)} />
      ))}
    </svg>
  );
}
