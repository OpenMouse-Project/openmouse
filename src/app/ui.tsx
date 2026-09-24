import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Minus, Plus } from "lucide-react";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import { batteryFillWidth, batteryIconState, batteryLevel } from "../ui/battery-icon";
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";

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
  return (
    <button
      id={id}
      className={`switch-button${unsupported ? " is-na" : value ? " is-on" : ""}`}
      type="button"
      role="switch"
      aria-checked={unsupported ? false : value}
      aria-label={label ? (unsupported ? `${label}, unavailable on this mouse` : label) : undefined}
      disabled={unsupported || disabled}
      onClick={() => onChange(value !== true)}
    >
      {unsupported ? (
        <span className="switch-na">N/A</span>
      ) : (
        <span className="switch-thumb" aria-hidden="true">
          {value ? <Check size={10} strokeWidth={3.4} /> : null}
        </span>
      )}
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

export interface OptionMenuChoice<T> {
  value: T;
  label: string;
  hidden?: boolean;
  disabled?: boolean;
}

/**
 * Unified dropdown replacing every native `<select>` in the mouse-option
 * cards. One visual language (trigger + popover listbox), full keyboard
 * support, theme-token-only styling. The trigger keeps the caller's `id`
 * so existing selectors and tests keep working.
 */
export function OptionMenu<T extends string | number>({
  id,
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
}: {
  id?: string;
  options: ReadonlyArray<OptionMenuChoice<T>>;
  value: T | null | undefined;
  onChange: (next: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<T | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const visible = options.filter((option) => !option.hidden);
  const current = visible.find((option) => option.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    setActive(value ?? null);
    const close = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", key);
    };
  }, [open, value]);

  const choose = (next: T): void => {
    setOpen(false);
    triggerRef.current?.focus();
    if (next !== value) onChange(next);
  };

  const moveActive = (direction: 1 | -1): void => {
    const enabled = visible.filter((option) => !option.disabled);
    if (enabled.length === 0) return;
    const index = enabled.findIndex((option) => option.value === active);
    const next = enabled[(index + direction + enabled.length) % enabled.length];
    if (!next) return;
    setActive(next.value);
    document.getElementById(`${menuId}-${String(next.value)}`)?.focus();
  };

  return (
    <div ref={rootRef} className={`option-menu${open ? " is-open" : ""}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="option-menu-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          if (!disabled) setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!disabled) setOpen(true);
          }
        }}
      >
        <span>{current?.label ?? "—"}</span>
        <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {open && !disabled ? (
        <ul
          id={menuId}
          className="option-menu-list"
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveActive(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveActive(-1);
            } else if (event.key === "Tab") {
              setOpen(false);
            }
          }}
        >
          {visible.map((option) => (
            <li
              key={String(option.value)}
              id={`${menuId}-${String(option.value)}`}
              role="option"
              tabIndex={option.disabled ? -1 : 0}
              aria-selected={option.value === value}
              aria-disabled={option.disabled}
              className={option.value === value ? "is-selected" : ""}
              onClick={() => {
                if (!option.disabled) choose(option.value);
              }}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && !option.disabled) {
                  event.preventDefault();
                  choose(option.value);
                }
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Unified stepper + slider replacing the old hand-rolled
 * `.angle-tuning-control` clones (debounce, anti-mistouch, angle-tune,
 * sensor rotation). Drag previews locally and commits on release;
 * steppers commit immediately. Format the readout via `formatValue`
 * (e.g. `12 ms`, `+5°`) — the same text doubles as the slider's
 * screen-reader value, so it stays locale-neutral.
 */
export function StepperSlider({
  id,
  label,
  badge,
  toggle,
  value,
  min,
  max,
  step,
  scale,
  formatValue,
  disabled,
  pendingKey,
  onCommit,
}: {
  id: string;
  label: string;
  /** Small pill next to the label, e.g. "Locked" for write-locked rows. */
  badge?: string;
  /**
   * Optional control (e.g. an on/off SwitchRow) rendered at the top of the
   * same zone, above the slider head.
   */
  toggle?: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  scale: readonly [string, string, string];
  formatValue: (shown: number) => string;
  disabled?: boolean;
  pendingKey?: string;
  onCommit: (next: number) => void;
}): ReactNode {
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? value;
  const clamp = (next: number): number => Math.max(min, Math.min(max, next));
  const commit = (next: number): void => {
    if (!disabled) onCommit(clamp(next));
  };
  const span = Math.max(Number.EPSILON, max - min);

  return (
    <div className="stepper-slider" data-pending-key={pendingKey}>
      {toggle ? <div className="stepper-slider-toggle">{toggle}</div> : null}
      <div className="stepper-slider-head">
        <span className="stepper-slider-title">
          <span>{label}</span>
          {badge ? <em className="stepper-slider-badge">{badge}</em> : null}
        </span>
        <output id={`${id}-value`} htmlFor={id}>{formatValue(shown)}</output>
      </div>
      <div className="stepper-slider-inputs">
        <button
          type="button"
          aria-label={`${label}: decrease`}
          disabled={disabled || shown <= min}
          onClick={() => commit(shown - step)}
        >
          <Minus size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={formatValue(shown)}
          style={{ "--fill": `${((shown - min) / span) * 100}%` }}
          onInput={(event) => setDragging(Number(event.currentTarget.value))}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            setDragging(null);
            commit(next);
          }}
          onBlur={() => setDragging(null)}
        />
        <button
          type="button"
          aria-label={`${label}: increase`}
          disabled={disabled || shown >= max}
          onClick={() => commit(shown + step)}
        >
          <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
      <div className="stepper-slider-scale" aria-hidden="true">
        <span>{scale[0]}</span><i>{scale[1]}</i><span>{scale[2]}</span>
      </div>
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
  locale = "en",
}: {
  id?: string;
  options: number[];
  valueHz: number | null;
  label?: string;
  disabled?: boolean;
  hidden?: boolean;
  onChange: (hz: number) => void;
  locale?: InterfaceLocale;
  /** Kept for callers that used to hide the readout; buttons always show it. */
  bubble?: boolean;
}): ReactNode {
  if (options.length === 0) return <div id={id} className="rate-slider" hidden={hidden} />;
  const selected = valueHz !== null && options.includes(valueHz)
    ? options.indexOf(valueHz)
    : options.reduce(
      (best, rate, step) =>
        Math.abs(rate - (valueHz ?? options[0] ?? 0)) < Math.abs((options[best] ?? 0) - (valueHz ?? options[0] ?? 0))
          ? step
          : best,
      0,
    );

  return (
    <div id={id} className="rate-slider" hidden={hidden}>
      {label ? (
        <div className="rate-slider-head">
          <span>{label}</span>
          <output>{options[selected]?.toLocaleString() ?? "—"} Hz</output>
        </div>
      ) : null}
      <div className="rate-slider-buttons" role="group" aria-label={label ?? t(locale, "perf.reportRate")}>
        {options.map((rate, step) => {
          const on = step === selected;
          return (
            <button
              key={rate}
              type="button"
              className={on ? "is-on" : ""}
              aria-pressed={on}
              disabled={disabled}
              title={`${rate.toLocaleString()} Hz`}
              onClick={() => onChange(rate)}
            >
              {shortRate(rate)}
            </button>
          );
        })}
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
