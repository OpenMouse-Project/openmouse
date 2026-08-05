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

export function setSelected(button: HTMLButtonElement, selected: boolean): void {
  button.classList.toggle("selected", selected);
  button.setAttribute("aria-pressed", String(selected));
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
