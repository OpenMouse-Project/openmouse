import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { clamp, hexToHsv, hsvToHex, hexToRgb, rgbToHsv, type Hsv } from "../ui/color-math";

const HUE_STOPS = ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"];

function fitCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): void {
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(cssWidth * ratio));
  const height = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawSv(canvas: HTMLCanvasElement | null, hue: number): void {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  fitCanvas(canvas, rect.width, rect.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
  ctx.fillRect(0, 0, rect.width, rect.height);
  const saturation = ctx.createLinearGradient(0, 0, rect.width, 0);
  saturation.addColorStop(0, "#ffffff");
  saturation.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = saturation;
  ctx.fillRect(0, 0, rect.width, rect.height);
  const value = ctx.createLinearGradient(0, 0, 0, rect.height);
  value.addColorStop(0, "rgba(0, 0, 0, 0)");
  value.addColorStop(1, "#000000");
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, rect.width, rect.height);
}

function drawHue(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  fitCanvas(canvas, rect.width, rect.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
  HUE_STOPS.forEach((stop, index) => gradient.addColorStop(index / (HUE_STOPS.length - 1), stop));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, rect.width, rect.height);
}

export function ColorPicker({
  id,
  value,
  disabled,
  ariaLabel,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (hex: string) => void;
}): ReactNode {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value);
  const dragging = useRef<"sv" | "hue" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const svCanvas = useRef<HTMLCanvasElement>(null);
  const hueCanvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (dragging.current) return;
    setHsv(hexToHsv(value));
    setHexText(value);
  }, [value]);

  useEffect(() => {
    drawSv(svCanvas.current, hsv.hue);
    drawHue(hueCanvas.current);
  }, [hsv.hue]);

  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (element.getBoundingClientRect().width > 0) {
        drawSv(svCanvas.current, hsv.hue);
        drawHue(hueCanvas.current);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hsv.hue]);

  const hex = hsvToHex(hsv);

  const track = (area: "sv" | "hue") => (event: PointerEvent<HTMLElement>): void => {
    if (disabled) return;
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const x = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
    const y = rect.height > 0 ? clamp((event.clientY - rect.top) / rect.height, 0, 1) : 0;
    const next: Hsv = area === "sv"
      ? { ...hsv, saturation: x, value: 1 - y }
      : { ...hsv, hue: clamp(x * 360, 0, 359.999) };
    setHsv(next);
    setHexText(hsvToHex(next));
    return;
  };

  const finish = (area: "sv" | "hue") => (event: PointerEvent<HTMLElement>): void => {
    if (dragging.current !== area) return;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const committed = hsvToHex(hsv);
    if (committed !== value) onChange(committed);
  };

  return (
    <div className={`lighting-color-picker${disabled ? " is-disabled" : ""}`} ref={root}>
      <input type="hidden" id={id} value={hex} aria-label={ariaLabel} readOnly />
      <div
        className="lighting-color-panel"
        onPointerDown={(event) => {
          if (disabled || dragging.current) return;
          dragging.current = "sv";
          event.currentTarget.setPointerCapture(event.pointerId);
          track("sv")(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current === "sv") track("sv")(event);
        }}
        onPointerUp={finish("sv")}
        onPointerCancel={finish("sv")}
      >
        <canvas className="lighting-sv-canvas" width={220} height={150} aria-hidden="true" ref={svCanvas} />
        <i
          className="lighting-sv-thumb"
          aria-hidden="true"
          style={{ left: `${hsv.saturation * 100}%`, top: `${(1 - hsv.value) * 100}%` }}
        />
      </div>
      <div
        className="lighting-hue-bar"
        onPointerDown={(event) => {
          if (disabled || dragging.current) return;
          dragging.current = "hue";
          event.currentTarget.setPointerCapture(event.pointerId);
          track("hue")(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current === "hue") track("hue")(event);
        }}
        onPointerUp={finish("hue")}
        onPointerCancel={finish("hue")}
      >
        <canvas className="lighting-hue-canvas" width={220} height={14} aria-hidden="true" ref={hueCanvas} />
        <i className="lighting-hue-thumb" aria-hidden="true" style={{ left: `${(hsv.hue / 360) * 100}%` }} />
      </div>
      <div className="lighting-color-actions">
        <span className="lighting-color-swatch" aria-hidden="true" style={{ background: hex }} />
        <input
          className="lighting-color-hex"
          type="text"
          maxLength={7}
          spellcheck={false}
          autoComplete="off"
          value={hexText}
          disabled={disabled}
          aria-label={`${ariaLabel} hex value`}
          onChange={(event) => setHexText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          onBlur={() => {
            const rgb = hexToRgb(hexText);
            if (!rgb) {
              setHexText(hex);
              return;
            }
            const next = rgbToHsv(rgb[0], rgb[1], rgb[2]);
            setHsv(next);
            const committed = hsvToHex(next);
            setHexText(committed);
            if (committed !== value) onChange(committed);
          }}
        />
      </div>
    </div>
  );
}
