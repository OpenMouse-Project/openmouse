const HUE_STOPS = ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"];

interface ColorPickerState {
  picker: HTMLElement;
  input: HTMLInputElement;
  panel: HTMLElement;
  svCanvas: HTMLCanvasElement;
  svThumb: HTMLElement;
  hueBar: HTMLElement;
  hueCanvas: HTMLCanvasElement;
  hueThumb: HTMLElement;
  swatch: HTMLElement;
  hex: HTMLInputElement;
  hue: number;
  saturation: number;
  value: number;
  dragging: "sv" | "hue" | null;
}

const pickers: ColorPickerState[] = [];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const parsed = parseInt(match[1], 16);
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

function rgbToHsv(r: number, g: number, b: number): { hue: number; saturation: number; value: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const saturation = max === 0 ? 0 : delta / max;
  return { hue, saturation, value: max / 255 };
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const chroma = value * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = value - chroma;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [chroma, secondary, 0];
  else if (hue < 120) rgb = [secondary, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, secondary];
  else if (hue < 240) rgb = [0, secondary, chroma];
  else if (hue < 300) rgb = [secondary, 0, chroma];
  else rgb = [chroma, 0, secondary];
  return [
    Math.round((rgb[0] + match) * 255),
    Math.round((rgb[1] + match) * 255),
    Math.round((rgb[2] + match) * 255),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number) => value.toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function pickerHex(state: ColorPickerState): string {
  const [r, g, b] = hsvToRgb(state.hue, state.saturation, state.value);
  return rgbToHex(r, g, b);
}

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

function drawSv(state: ColorPickerState): void {
  const rect = state.svCanvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  fitCanvas(state.svCanvas, rect.width, rect.height);
  const ctx = state.svCanvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = `hsl(${state.hue}, 100%, 50%)`;
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

function drawHue(state: ColorPickerState): void {
  const rect = state.hueCanvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  fitCanvas(state.hueCanvas, rect.width, rect.height);
  const ctx = state.hueCanvas.getContext("2d");
  if (!ctx) return;
  const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
  HUE_STOPS.forEach((stop, index) => gradient.addColorStop(index / (HUE_STOPS.length - 1), stop));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, rect.width, rect.height);
}

function render(state: ColorPickerState): void {
  drawSv(state);
  drawHue(state);
  state.svThumb.style.left = `${state.saturation * 100}%`;
  state.svThumb.style.top = `${(1 - state.value) * 100}%`;
  state.hueThumb.style.left = `${(state.hue / 360) * 100}%`;
  const hex = pickerHex(state);
  state.swatch.style.background = hex;
  state.hex.value = hex;
}

function pointerFraction(event: PointerEvent, element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0,
    y: rect.height > 0 ? clamp((event.clientY - rect.top) / rect.height, 0, 1) : 0,
  };
}

function applyPointer(state: ColorPickerState, element: HTMLElement, event: PointerEvent, area: "sv" | "hue"): void {
  const { x, y } = pointerFraction(event, element);
  if (area === "sv") {
    state.saturation = x;
    state.value = 1 - y;
  } else {
    state.hue = clamp(x * 360, 0, 359.999);
  }
  render(state);
}

function commit(state: ColorPickerState): void {
  if (state.input.disabled) return;
  const hex = pickerHex(state);
  if (hex === state.input.value) return;
  state.input.value = hex;
  state.input.dispatchEvent(new Event("change", { bubbles: true }));
}

function bindPointer(state: ColorPickerState, element: HTMLElement, area: "sv" | "hue"): void {
  element.addEventListener("pointerdown", (event) => {
    if (state.input.disabled || state.dragging) return;
    state.dragging = area;
    element.setPointerCapture(event.pointerId);
    applyPointer(state, element, event, area);
  });
  element.addEventListener("pointermove", (event) => {
    if (state.dragging !== area) return;
    applyPointer(state, element, event, area);
  });
  const finish = (event: PointerEvent) => {
    if (state.dragging !== area) return;
    state.dragging = null;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    commit(state);
  };
  element.addEventListener("pointerup", finish);
  element.addEventListener("pointercancel", finish);
}

function bindHex(state: ColorPickerState): void {
  state.hex.addEventListener("keydown", (event) => {
    if (event.key === "Enter") state.hex.blur();
  });
  state.hex.addEventListener("change", () => {
    if (state.input.disabled) return;
    const rgb = hexToRgb(state.hex.value);
    if (!rgb) {
      state.hex.value = state.input.value;
      return;
    }
    const hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    state.hue = hsv.hue;
    state.saturation = hsv.saturation;
    state.value = hsv.value;
    render(state);
    commit(state);
  });
}

function applyInputValue(state: ColorPickerState): void {
  const rgb = hexToRgb(state.input.value) ?? [255, 255, 255];
  const hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  state.hue = hsv.hue;
  state.saturation = hsv.saturation;
  state.value = hsv.value;
}

function bindPicker(pickerEl: HTMLElement): void {
  const input = pickerEl.querySelector<HTMLInputElement>('input[type="hidden"]');
  const panel = pickerEl.querySelector<HTMLElement>(".lighting-color-panel");
  const svCanvas = pickerEl.querySelector<HTMLCanvasElement>(".lighting-sv-canvas");
  const svThumb = pickerEl.querySelector<HTMLElement>(".lighting-sv-thumb");
  const hueBar = pickerEl.querySelector<HTMLElement>(".lighting-hue-bar");
  const hueCanvas = pickerEl.querySelector<HTMLCanvasElement>(".lighting-hue-canvas");
  const hueThumb = pickerEl.querySelector<HTMLElement>(".lighting-hue-thumb");
  const swatch = pickerEl.querySelector<HTMLElement>(".lighting-color-swatch");
  const hex = pickerEl.querySelector<HTMLInputElement>(".lighting-color-hex");
  if (!input || !panel || !svCanvas || !svThumb || !hueBar || !hueCanvas || !hueThumb || !swatch || !hex) return;

  const state: ColorPickerState = {
    picker: pickerEl,
    input,
    panel,
    svCanvas,
    svThumb,
    hueBar,
    hueCanvas,
    hueThumb,
    swatch,
    hex,
    hue: 0,
    saturation: 0,
    value: 1,
    dragging: null,
  };
  applyInputValue(state);
  render(state);
  pickers.push(state);
  bindPointer(state, panel, "sv");
  bindPointer(state, hueBar, "hue");
  bindHex(state);

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => {
      if (pickerEl.getBoundingClientRect().width > 0) render(state);
    }).observe(pickerEl);
  }
}

export function initColorPickers(): void {
  pickers.length = 0;
  document.querySelectorAll<HTMLElement>("[data-color-picker]").forEach(bindPicker);
}

export function syncColorPickers(): void {
  pickers.forEach((state) => {
    state.picker?.classList.toggle("is-disabled", state.input.disabled);
    applyInputValue(state);
    render(state);
  });
}
