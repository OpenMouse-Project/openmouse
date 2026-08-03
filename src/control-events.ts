import type { EggSpdtMode } from "./devices/endgame/egg-op1-hid";
import type { MouseStatus } from "./devices/mouse-types";

type PulsarToggleSetting = "motionSync" | "angleSnapping" | "rippleControl" | "performanceMode";
type EggFilterSetting = "slamclick" | "motionJitter";

export interface ControlEventHandlers {
  connect(): Promise<void>;
  selectAuthorizedDevice(index: number): Promise<void>;
  openInterfaceSettings(): void;
  closeInterfaceSettings(): void;
  setInterfaceDensity(value: string): void;
  setInterfaceTheme(value: string): void;
  setReducedMotion(enabled: boolean): void;
  setExpandSections(enabled: boolean): void;
  setShowExperimental(enabled: boolean): void;
  resetInterfacePreferences(): void;
  copyDiagnostics(): Promise<void>;
  chooseCustomDpi(): Promise<void>;
  finishCustomDpiEditing(): void;
  applyLogitechAxisDpi(): Promise<void>;
  applyLogitechAnalogButton(button: 0 | 1): Promise<void>;
  toggleDongleLed(): Promise<void>;
  applyPulsarValue(setting: "debounce" | "sleep", value: number): Promise<void>;
  toggleSleep(enabled: boolean): Promise<void>;
  applyPulsarToggle(setting: PulsarToggleSetting, enabled: boolean): Promise<void>;
  applyEggFilter(setting: EggFilterSetting, enabled: boolean): Promise<void>;
  applyEggSpdtMode(button: "left" | "right", mode: EggSpdtMode): Promise<void>;
  applyEggCpiLevels(levels: number): Promise<void>;
  updateCustomPollingPreview(): void;
  applyEggPollingDivider(divider: number): Promise<void>;
  applyProSetting(setting: "wheelAcceleration" | "angleTuning" | "profile", value: boolean | number): Promise<void>;
  applyPollingRate(rate: number): Promise<void>;
  applyLiftOffDistance(lod: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void>;
}

function onClick(selector: string, listener: () => void): void {
  document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", listener);
}

export function bindControlEvents(handlers: ControlEventHandlers): void {
  onClick("#connect-button", () => void handlers.connect());
  onClick("#empty-connect-button", () => void handlers.connect());
  document.querySelector<HTMLElement>("#sidebar-device-list")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-device-index]");
    if (button) void handlers.selectAuthorizedDevice(Number(button.dataset.deviceIndex));
  });
  onClick("#interface-settings-button", handlers.openInterfaceSettings);
  onClick("#close-interface-settings", handlers.closeInterfaceSettings);

  document.querySelector<HTMLSelectElement>("#interface-density")?.addEventListener("change", (event) => {
    handlers.setInterfaceDensity((event.target as HTMLSelectElement).value);
  });
  document.querySelector<HTMLSelectElement>("#interface-theme")?.addEventListener("change", (event) => {
    handlers.setInterfaceTheme((event.target as HTMLSelectElement).value);
  });
  document.querySelector<HTMLInputElement>("#interface-reduced-motion")?.addEventListener("change", (event) => {
    handlers.setReducedMotion((event.target as HTMLInputElement).checked);
  });
  document.querySelector<HTMLInputElement>("#interface-expand-sections")?.addEventListener("change", (event) => {
    handlers.setExpandSections((event.target as HTMLInputElement).checked);
  });
  document.querySelector<HTMLInputElement>("#interface-show-experimental")?.addEventListener("change", (event) => {
    handlers.setShowExperimental((event.target as HTMLInputElement).checked);
  });
  onClick("#reset-interface-settings", handlers.resetInterfacePreferences);
  onClick("#copy-diagnostics", () => void handlers.copyDiagnostics());
  onClick("#custom-dpi", () => void handlers.chooseCustomDpi());
  onClick("#apply-logitech-axes", () => void handlers.applyLogitechAxisDpi());
  onClick("#apply-logitech-left-button", () => void handlers.applyLogitechAnalogButton(0));
  onClick("#apply-logitech-right-button", () => void handlers.applyLogitechAnalogButton(1));
  document.querySelector<HTMLInputElement>("#dpi-output")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handlers.chooseCustomDpi();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      handlers.finishCustomDpiEditing();
    }
  });
  onClick("#dongle-led-toggle", () => void handlers.toggleDongleLed());

  for (let angle = -30; angle <= 30; angle += 1) {
    document.querySelector<HTMLSelectElement>("#angle-tuning-select")?.add(new Option(`${angle}°`, String(angle)));
  }
  document.querySelector<HTMLSelectElement>("#debounce-select")?.addEventListener("change", (event) => {
    void handlers.applyPulsarValue("debounce", Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLSelectElement>("#sleep-select")?.addEventListener("change", (event) => {
    void handlers.applyPulsarValue("sleep", Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLButtonElement>("#sleep-toggle")?.addEventListener("click", (event) => {
    const enabled = (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true";
    void handlers.toggleSleep(enabled);
  });

  for (const [selector, setting] of [["#motion-sync-toggle", "motionSync"], ["#angle-snapping-toggle", "angleSnapping"], ["#ripple-control-toggle", "rippleControl"], ["#performance-mode-toggle", "performanceMode"]] as const) {
    document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", (event) => {
      void handlers.applyPulsarToggle(setting, (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true");
    });
  }
  for (const [selector, setting] of [["#slamclick-filter-toggle", "slamclick"], ["#motion-jitter-filter-toggle", "motionJitter"]] as const) {
    document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", (event) => {
      void handlers.applyEggFilter(setting, (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true");
    });
  }
  document.querySelector<HTMLSelectElement>("#left-spdt-select")?.addEventListener("change", (event) => {
    void handlers.applyEggSpdtMode("left", (event.target as HTMLSelectElement).value as EggSpdtMode);
  });
  document.querySelector<HTMLSelectElement>("#right-spdt-select")?.addEventListener("change", (event) => {
    void handlers.applyEggSpdtMode("right", (event.target as HTMLSelectElement).value as EggSpdtMode);
  });
  document.querySelector<HTMLSelectElement>("#egg-cpi-levels")?.addEventListener("change", (event) => {
    void handlers.applyEggCpiLevels(Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLInputElement>("#egg-polling-divider")?.addEventListener("input", handlers.updateCustomPollingPreview);
  onClick("#apply-egg-polling", () => {
    const divider = Number(document.querySelector<HTMLInputElement>("#egg-polling-divider")?.value);
    void handlers.applyEggPollingDivider(divider);
  });
  document.querySelector<HTMLButtonElement>("#wheel-acceleration-toggle")?.addEventListener("click", (event) => {
    void handlers.applyProSetting("wheelAcceleration", (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true");
  });
  document.querySelector<HTMLSelectElement>("#angle-tuning-select")?.addEventListener("change", (event) => {
    void handlers.applyProSetting("angleTuning", Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLSelectElement>("#profile-select")?.addEventListener("change", (event) => {
    void handlers.applyProSetting("profile", Number((event.target as HTMLSelectElement).value));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => {
    button.addEventListener("click", () => void handlers.applyPollingRate(Number(button.dataset.rate)));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => {
    button.addEventListener("click", () => {
      const lod = button.dataset.lod as MouseStatus["liftOffDistance"];
      if (lod) void handlers.applyLiftOffDistance(lod);
    });
  });
  const shell = document.querySelector<HTMLElement>(".control-shell");
  const panel = document.querySelector<HTMLElement>(".control-panel");
  shell?.addEventListener("wheel", (event) => {
    if (!panel || panel.contains(event.target as Node) || event.deltaY === 0) return;
    panel.scrollTop += event.deltaY;
    event.preventDefault();
  }, { passive: false });
}
