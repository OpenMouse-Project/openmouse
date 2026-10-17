export interface Hsv {
  hue: number;
  saturation: number;
  value: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const parsed = parseInt(match[1], 16);
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
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

export function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
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

export function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number): string => value.toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function hsvToHex({ hue, saturation, value }: Hsv): string {
  const [r, g, b] = hsvToRgb(hue, saturation, value);
  return rgbToHex(r, g, b);
}

export function hexToHsv(hex: string): Hsv {
  const rgb = hexToRgb(hex) ?? [255, 255, 255];
  return rgbToHsv(rgb[0], rgb[1], rgb[2]);
}
