// Explicit extension so node --test can resolve this module (see rate-slider.test.ts).
import { escapeHtml } from "./dom.ts";

/** Fallback stops for a driver that does not advertise a rate list. */
export const RATE_STEPS_HZ = [125, 250, 500, 1000, 2000, 4000, 8000];

/** 125 to "125", 8000 to "8K": the scale has to fit under a narrow card. */
export function shortRate(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}K` : String(hz);
}

/**
 * The supported rate closest to a target, for picking a default against a
 * mouse whose list does not contain it. Ties go to the lower rate, so a
 * default never silently lands on the faster, more power-hungry option.
 */
export function nearestRate(options: readonly number[], targetHz: number): number | null {
  if (options.length === 0) return null;
  return options.reduce((best, hz) =>
    Math.abs(hz - targetHz) < Math.abs(best - targetHz) ? hz : best);
}

/**
 * Renders a rate picker as a slider with one stop per supported rate.
 *
 * The slider runs over indices rather than hertz because the steps are not
 * evenly spaced, 125 to 8000 doubles each time, so an index scale puts the
 * stops at equal distances, which is what makes the dots line up.
 */
export function renderRateSlider(
  root: HTMLElement | null,
  options: number[],
  valueHz: number | null,
  state: { label?: string; disabled: boolean },
): void {
  if (!root) return;
  if (options.length === 0) {
    root.innerHTML = "";
    return;
  }
  // A stored rate can sit off the scale, another tool may have written one
  // above this link's ceiling. Land on the nearest stop rather than falling
  // back to index 0, which would read as the slowest rate rather than the
  // fastest one available.
  const exact = options.indexOf(valueHz ?? -1);
  const index = exact >= 0
    ? exact
    : options.reduce(
      (best, rate, step) =>
        Math.abs(rate - (valueHz ?? options[0] ?? 0)) < Math.abs((options[best] ?? 0) - (valueHz ?? options[0] ?? 0))
          ? step
          : best,
      0,
    );
  const last = Math.max(1, options.length - 1);
  // The thumb centre travels between half a thumb in from each end, so the
  // dots are inset by the same amount to sit under it.
  const position = (step: number): string => `calc(7px + (100% - 14px) * ${step} / ${last})`;

  const scale = options.map((rate, step) => {
    const on = step <= index;
    return `<i class="${on ? "is-on" : ""}" style="left:${position(step)}"></i>`
      + `<span class="${step === index ? "is-on" : ""}" style="left:${position(step)}">${shortRate(rate)}</span>`;
  }).join("");

  root.innerHTML = `${state.label ? `<div class="rate-slider-head"><span>${escapeHtml(state.label)}</span><output>${options[index]?.toLocaleString() ?? "—"} Hz</output></div>` : ""}
    <input type="range" class="rate-slider-input" min="0" max="${last}" step="1" value="${index}"${state.disabled ? " disabled" : ""} aria-label="${escapeHtml(state.label ?? "Report rate")}" aria-valuetext="${options[index] ?? 0} Hz" />
    <div class="rate-slider-scale">${scale}</div>`;
  // The index is only meaningful next to the list it came from.
  root.dataset.rates = options.join(",");
}

/** Maps a slider index back to hertz using the list that produced it. */
export function rateFromSlider(selector: string, index: number): number | null {
  const root = document.querySelector<HTMLElement>(selector);
  if (!root) return null;
  const rates = (root.dataset.rates ?? "").split(",").map(Number).filter((rate) => rate > 0);
  return rates[index] ?? null;
}

/**
 * Updates a slider's readout and lit dots as the thumb moves. Nothing is
 * staged: the value only counts once the drag ends.
 */
export function previewRateSlider(selector: string, index: number): void {
  const root = document.querySelector<HTMLElement>(selector);
  if (!root) return;
  const hz = rateFromSlider(selector, index);
  const output = root.querySelector("output");
  if (output && hz !== null) output.textContent = `${hz.toLocaleString()} Hz`;
  root.querySelectorAll<HTMLElement>(".rate-slider-scale i").forEach((dot, step) => {
    dot.classList.toggle("is-on", step <= index);
  });
  root.querySelectorAll<HTMLElement>(".rate-slider-scale span").forEach((label, step) => {
    label.classList.toggle("is-on", step === index);
  });
}
