import { pendingChangeCount, pendingChanges } from "../pending-changes";
import { setText } from "./dom";

// Must stay in step with the `pending-bar-sink` animation in control.css
const HIDE_DELAY_MS = 220;

let hideTimer: number | null = null;
let suppressed = false;

function bar(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#pending-changes-bar");
}

function hideNow(element: HTMLElement): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  element.classList.remove("is-leaving");
  element.hidden = true;
  document.querySelector<HTMLElement>(".control-shell")?.classList.remove("has-pending-changes");
}

export function setPendingBarSuppressed(value: boolean): void {
  suppressed = value;
  renderPendingBar();
}

export function renderPendingBar(): void {
  const element = bar();
  if (!element) return;
  if (suppressed) {
    hideNow(element);
    return;
  }
  const count = pendingChangeCount();
  document.querySelector<HTMLElement>(".control-shell")?.classList.toggle("has-pending-changes", count > 0);
  if (count === 0) {
    if (element.hidden || element.classList.contains("is-leaving")) return;
    element.classList.add("is-leaving");
    hideTimer = window.setTimeout(() => {
      element.hidden = true;
      element.classList.remove("is-leaving");
      hideTimer = null;
    }, HIDE_DELAY_MS);
    return;
  }
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  element.classList.remove("is-leaving");
  element.hidden = false;
  setText("#pending-changes-count", count === 1 ? "1 unsaved change" : `${count} unsaved changes`);
  setText("#pending-changes-summary", pendingChanges().map((change) => change.label).join(" · "));
}

// Swaps the bar into its loading state while staged changes are written.
export function setPendingBarBusy(busy: boolean): void {
  const element = bar();
  if (!element) return;
  element.classList.toggle("is-flashing", busy);
  element.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.disabled = busy;
  });
  setText("#pending-flash-label", busy ? "Flashing…" : "Flash");
  if (!busy) renderPendingBar();
}

export function setPendingBarStatus(text: string): void {
  setText("#pending-changes-summary", text);
}
