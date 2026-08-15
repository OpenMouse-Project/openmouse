import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import { batteryFillWidth, batteryIconState, batteryLevel } from "../ui/battery-icon";

export function SwitchButton({
  id,
  value,
  label,
  disabled,
  onChange,
}: {
  id?: string;
  value: boolean | null | undefined;
  label?: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}): ReactNode {
  const unsupported = value === null || value === undefined;
  const style = unsupported
    ? { background: "#202023", borderColor: "#3a3a3f", color: "#66666b" }
    : value
      ? { background: "var(--ui-accent)", borderColor: "var(--ui-accent)", color: "var(--ui-accent-ink)" }
      : { background: "#202023", borderColor: "#3a3a3f", color: "#8b8b90" };
  return (
    <button
      id={id}
      className="switch-button"
      type="button"
      role="switch"
      aria-checked={unsupported ? false : value}
      aria-label={label ? (unsupported ? `${label}, unavailable on this mouse` : label) : undefined}
      disabled={unsupported || disabled}
      style={style}
      onClick={() => onChange(value !== true)}
    >
      {unsupported ? "N/A" : value ? "On" : "Off"}
    </button>
  );
}

export function SwitchRow({
  id,
  label,
  value,
  disabled,
  onChange,
  hidden,
  labelId,
}: {
  id?: string;
  label: string;
  value: boolean | null | undefined;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  hidden?: boolean;
  labelId?: string;
}): ReactNode {
  if (hidden) return null;
  return (
    <div className="switch-row">
      <span id={labelId}>{label}</span>
      <SwitchButton id={id} value={value} label={label} disabled={disabled} onChange={onChange} />
    </div>
  );
}

export interface SegmentedOption<T> {
  value: T;
  label: string;
  hidden?: boolean;
  disabled?: boolean;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  disabled,
  id,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T | null | undefined;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}): ReactNode {
  return (
    <div id={id} className={["segmented", className].filter(Boolean).join(" ")} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          hidden={option.hidden}
          className={option.value === value ? "selected" : ""}
          aria-pressed={option.value === value}
          disabled={disabled || option.disabled || option.hidden}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function shortRate(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}K` : String(hz);
}

export function RateSlider({
  id,
  options,
  valueHz,
  label,
  disabled,
  hidden,
  onChange,
}: {
  id?: string;
  options: number[];
  valueHz: number | null;
  label?: string;
  disabled?: boolean;
  hidden?: boolean;
  onChange: (hz: number) => void;
}): ReactNode {
  const [dragging, setDragging] = useState<number | null>(null);
  if (options.length === 0) return <div id={id} className="rate-slider" hidden={hidden} />;

  const exact = options.indexOf(valueHz ?? -1);
  const settled = exact >= 0
    ? exact
    : options.reduce(
      (best, rate, step) =>
        Math.abs(rate - (valueHz ?? options[0] ?? 0)) < Math.abs((options[best] ?? 0) - (valueHz ?? options[0] ?? 0))
          ? step
          : best,
      0,
    );
  const index = dragging ?? settled;
  const last = Math.max(1, options.length - 1);
  const position = (step: number): string => `calc(7px + (100% - 14px) * ${step} / ${last})`;
  const fill = `${(index / last) * 100}%`;

  return (
    <div id={id} className={`rate-slider${dragging !== null ? " is-dragging" : ""}`} hidden={hidden}>
      {label ? (
        <div className="rate-slider-head">
          <span>{label}</span>
          <output>{options[index]?.toLocaleString() ?? "—"} Hz</output>
        </div>
      ) : null}
      <div className="rate-slider-rail">
        <input
          type="range"
          className="rate-slider-input"
          style={{ "--fill": fill }}
          min={0}
          max={last}
          step={1}
          value={index}
          disabled={disabled}
          aria-label={label ?? "Report rate"}
          aria-valuetext={`${options[index] ?? 0} Hz`}
          // "change" fires on release, so a drag stages one change rather than
          // thirty; "input" only moves the readout and the lit dots.
          onInput={(event) => setDragging(Number(event.currentTarget.value))}
          onChange={(event) => {
            const hz = options[Number(event.currentTarget.value)];
            setDragging(null);
            if (hz !== undefined) onChange(hz);
          }}
          onBlur={() => setDragging(null)}
        />
        <output className="rate-slider-bubble" style={{ left: position(index) }} aria-hidden="true">
          {options[index]?.toLocaleString() ?? "—"} Hz
        </output>
      </div>
      <div className="rate-slider-scale">
        {options.map((rate, step) => (
          <Fragment key={rate}>
            <i className={step <= index ? "is-on" : ""} style={{ left: position(step) }} />
            <span className={step === index ? "is-on" : ""} style={{ left: position(step) }}>
              {shortRate(rate)}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function BatteryIcon({
  percent,
  state,
}: {
  percent: number | null | undefined;
  state: MouseStatus["batteryState"];
}): ReactNode {
  const kind = batteryIconState(percent, state);
  const level = batteryLevel(percent, state);
  const TRACK = { x: 2.85, y: 2.85, width: 19.3, height: 9.3, radius: 2.1 };
  const BOLT = "M14.3 3.1 9.3 9.2h3.1l-.9 3.9 5.2-6.2h-3.1l.7-3.8Z";
  const DEAD_CROSS = "m9.9 5.7 5.2 3.9M15.1 5.7 9.9 9.6";
  return (
    <svg className={`battery-icon is-${kind}`} viewBox="0 0 30 15" aria-hidden="true" focusable="false">
      <rect className="battery-shell" x="0.85" y="0.85" width="23.3" height="13.3" rx="3.6" />
      <rect className="battery-cap" x="25.5" y="4.9" width="2.7" height="5.2" rx="1.35" />
      <rect className="battery-track" x={TRACK.x} y={TRACK.y} width={TRACK.width} height={TRACK.height} rx={TRACK.radius} />
      {kind === "charging" ? (
        <>
          <mask id="battery-bolt-mask">
            <rect x="0" y="0" width="30" height="15" fill="#fff" />
            <path d={BOLT} fill="#000" stroke="#000" strokeWidth="1.8" strokeLinejoin="round" />
          </mask>
          {level === null ? null : (
            <rect
              className="battery-fill"
              mask="url(#battery-bolt-mask)"
              x={TRACK.x}
              y={TRACK.y}
              width={batteryFillWidth(level).toFixed(2)}
              height={TRACK.height}
              rx={TRACK.radius}
            />
          )}
          <path className="battery-bolt" d={BOLT} />
        </>
      ) : kind === "dead" ? (
        <path className="battery-dead" d={DEAD_CROSS} />
      ) : level !== null ? (
        <rect
          className="battery-fill"
          x={TRACK.x}
          y={TRACK.y}
          width={batteryFillWidth(level).toFixed(2)}
          height={TRACK.height}
          rx={TRACK.radius}
        />
      ) : null}
    </svg>
  );
}

export function Collapsible({
  id,
  className,
  overline,
  title,
  open,
  onToggle,
  hidden,
  children,
}: {
  id?: string;
  className: string;
  overline: string;
  title: string;
  open: boolean;
  onToggle?: (open: boolean) => void;
  hidden?: boolean;
  children: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.open = open;
  }, [open]);
  return (
    <details
      id={id}
      ref={ref}
      className={className}
      hidden={hidden}
      onToggle={(event) => onToggle?.((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span>
          <small>{overline}</small>
          {title}
        </span>
        <i aria-hidden="true" />
      </summary>
      <div className={className === "egg-experimental" ? "egg-experimental-body" : "egg-collapsible-body"}>
        {children}
      </div>
    </details>
  );
}
