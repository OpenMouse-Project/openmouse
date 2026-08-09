import { pendingChangeCount, pendingChanges } from "../pending-changes";
import { setText } from "./dom";

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
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    element.hidden = false;
    element.classList.remove("is-leaving", "is-flashing");
    setText("#pending-changes-count", "No pending changes");
    setText("#pending-changes-summary", "Adjust a setting to preview it before writing.");
    element.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = true;
    });
    return;
  }
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  element.classList.remove("is-leaving");
  element.hidden = false;
  element.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.disabled = false;
  });
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
  setText("#pending-flash-label", busy ? "Applying…" : "Apply changes");
  if (!busy) renderPendingBar();
}

export function setPendingBarStatus(text: string): void {
  setText("#pending-changes-summary", text);
}
