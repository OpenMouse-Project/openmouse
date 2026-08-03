export function setText(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

export function setControlValue(selector: string, value: number | string | null | undefined): void {
  const control = document.querySelector<HTMLSelectElement>(selector);
  if (!control) return;
  control.disabled = value === null || value === undefined;
  if (!control.disabled) control.value = String(value);
}

export function setToggleValue(selector: string, value: boolean | null | undefined): void {
  const control = document.querySelector<HTMLButtonElement>(selector);
  if (!control) return;
  control.disabled = value === null || value === undefined;
  if (control.disabled) {
    control.textContent = "N/A";
    control.style.background = "#202023";
    control.style.borderColor = "#3a3a3f";
    control.style.color = "#66666b";
    return;
  }
  control.setAttribute("aria-checked", String(value));
  control.textContent = value ? "On" : "Off";
  control.style.background = value ? "var(--ui-accent)" : "#202023";
  control.style.borderColor = value ? "var(--ui-accent)" : "#3a3a3f";
  control.style.color = value ? "var(--ui-accent-ink)" : "#8b8b90";
}

/** HSV, not HSL: saturation 0 gives white, which is what the wheel's centre shows. */
export function hsvToHex(hue: number, saturation: number, value: number): string {
  const chroma = value * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = value - chroma;
  const [red, green, blue] = hue < 60 ? [chroma, secondary, 0]
    : hue < 120 ? [secondary, chroma, 0]
      : hue < 180 ? [0, chroma, secondary]
        : hue < 240 ? [0, secondary, chroma]
          : hue < 300 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const channel = (amount: number): string => Math.round((amount + match) * 255).toString(16).padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/**
 * Maps a point offset from the wheel's centre to a color plus the thumb position,
 * clamped to the rim. The CSS conic-gradient starts red at 12 o'clock and runs
 * clockwise through magenta, so hue runs the opposite way round from the angle.
 */
export function wheelColorAt(dx: number, dy: number, radius: number): { hex: string; x: number; y: number } {
  if (radius <= 0) return { hex: "#ffffff", x: 0, y: 0 };
  const distance = Math.hypot(dx, dy);
  const scale = distance > radius ? radius / distance : 1;
  const angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  return {
    hex: hsvToHex((360 - angle) % 360, Math.min(1, distance / radius), 1),
    x: dx * scale,
    y: dy * scale,
  };
}

/** Scales a "#rrggbb" toward black. 100 leaves it untouched, 0 turns the zone off. */
export function scaleBrightness(color: string, percent: number): string {
  const value = Math.max(0, Math.min(100, percent)) / 100;
  const channel = (offset: number): string => Math.round(parseInt(color.slice(offset, offset + 2), 16) * value)
    .toString(16).padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

export function formatHex(value: number, width = 2): string {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}
