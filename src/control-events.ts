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
  toggleSidebar(): void;
  resetInterfacePreferences(): void;
  downloadDiagnostics(): void;
  chooseCustomDpi(): void;
  sanitizeCustomDpi(): void;
  finishCustomDpiEditing(): void;
  applyLogitechAxisDpi(): void;
  applyLogitechAnalogButton(button: 0 | 1): void;
  applyLogitechAnalogButtons(): void;
  setSuperstrikeTuningMode(mode: "independent" | "both"): void;
  toggleDongleLed(): void;
  applyPulsarValue(setting: "debounce" | "sleep", value: number): void;
  toggleSleep(enabled: boolean): void;
  applyPulsarToggle(setting: PulsarToggleSetting, enabled: boolean): void;
  applyEggFilter(setting: EggFilterSetting, enabled: boolean): void;
  applyEggSpdtMode(button: "left" | "right", mode: EggSpdtMode): void;
  applyEggCpiLevels(levels: number): void;
  updateCustomPollingPreview(): void;
  applyEggPollingDivider(divider: number): void;
  applyProSetting(setting: "wheelAcceleration" | "angleTuning" | "profile", value: boolean | number): void;
  applyFinalmouseSetting(setting: "dongleLed" | "tournamentScroll" | "tournamentTimeout", value: number): void;
  applyPollingRate(rate: number): void;
  applyLiftOffDistance(lod: NonNullable<MouseStatus["liftOffDistance"]>): void;
  applyLiftOffMode(mode: "single" | "asymmetric"): void;
  applyAsymmetricLiftOff(liftOff: number, landing: number): void;
  capLandingToLiftOff(): void;
  applyGamingSurfaceMode(mode: NonNullable<MouseStatus["gamingSurfaceMode"]>): void;
  applyLightforceSwitchMode(mode: NonNullable<MouseStatus["lightforceSwitchMode"]>): void;
  flashPendingChanges(): Promise<void>;
  revertPendingChanges(): void;
}

function onClick(selector: string, listener: () => void): void {
  document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", listener);
}

export function bindControlEvents(handlers: ControlEventHandlers): void {
  const showDevice = (run: () => void) => () => {
    handlers.closeInterfaceSettings();
    run();
  };
  onClick("#connect-button", showDevice(() => void handlers.connect()));
  onClick("#empty-connect-button", showDevice(() => void handlers.connect()));
  document.querySelector<HTMLElement>("#sidebar-device-list")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-device-index]");
    if (button) showDevice(() => void handlers.selectAuthorizedDevice(Number(button.dataset.deviceIndex)))();
  });
  onClick("#pending-flash", () => void handlers.flashPendingChanges());
  onClick("#pending-revert", handlers.revertPendingChanges);
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
  onClick("#sidebar-menu-toggle", handlers.toggleSidebar);
  onClick("#reset-interface-settings", handlers.resetInterfacePreferences);
  onClick("#download-diagnostics", handlers.downloadDiagnostics);
  onClick("#custom-dpi", () => void handlers.chooseCustomDpi());
  onClick("#apply-logitech-axes", () => void handlers.applyLogitechAxisDpi());
  onClick("#apply-logitech-left-button", () => void handlers.applyLogitechAnalogButton(0));
  onClick("#apply-logitech-right-button", () => void handlers.applyLogitechAnalogButton(1));
  onClick("#apply-logitech-both-buttons", () => void handlers.applyLogitechAnalogButtons());
  document.querySelectorAll<HTMLButtonElement>("[data-superstrike-tab]").forEach((button) => {
    button.addEventListener("click", () => handlers.setSuperstrikeTuningMode(button.dataset.superstrikeTab as "independent" | "both"));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-superstrike-input]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector<HTMLInputElement>(`#${button.dataset.superstrikeInput}`);
      if (!input || !button.dataset.superstrikeValue) return;
      input.value = button.dataset.superstrikeValue;
      document.querySelectorAll<HTMLButtonElement>(`[data-superstrike-input="${input.id}"]`).forEach((option) => {
        option.setAttribute("aria-pressed", String(option === button));
      });
    });
  });
  document.querySelector<HTMLInputElement>("#dpi-output")?.addEventListener("input", handlers.sanitizeCustomDpi);
  document.querySelector<HTMLInputElement>("#dpi-output")?.addEventListener("click", (event) => {
    if ((event.currentTarget as HTMLInputElement).readOnly) handlers.chooseCustomDpi();
  });
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
  for (const [selector, setting] of [
    ["#finalmouse-dongle-led", "dongleLed"],
    ["#finalmouse-tournament-scroll", "tournamentScroll"],
    ["#finalmouse-tournament-timeout", "tournamentTimeout"],
  ] as const) {
    document.querySelector<HTMLSelectElement>(selector)?.addEventListener("change", (event) => {
      handlers.applyFinalmouseSetting(setting, Number((event.target as HTMLSelectElement).value));
    });
  }
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => {
    button.addEventListener("click", () => void handlers.applyPollingRate(Number(button.dataset.rate)));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => {
    button.addEventListener("click", () => {
      const lod = button.dataset.lod as MouseStatus["liftOffDistance"];
      if (lod) void handlers.applyLiftOffDistance(lod);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lod-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.lodMode;
      if (mode === "single" || mode === "asymmetric") handlers.applyLiftOffMode(mode);
    });
  });
  const liftOffSlider = document.querySelector<HTMLInputElement>("#lod-lift-off");
  const landingSlider = document.querySelector<HTMLInputElement>("#lod-landing");
  for (const slider of [liftOffSlider, landingSlider]) {
    // `input` keeps the readout and the landing ceiling honest while dragging;
    // `change` fires on release, so a drag stages one change rather than thirty.
    slider?.addEventListener("input", () => handlers.capLandingToLiftOff());
    slider?.addEventListener("change", () => {
      handlers.capLandingToLiftOff();
      const liftOff = Number(liftOffSlider?.value);
      const landing = Number(landingSlider?.value);
      if (Number.isFinite(liftOff) && Number.isFinite(landing)) handlers.applyAsymmetricLiftOff(liftOff, landing);
    });
  }
  document.querySelectorAll<HTMLButtonElement>("[data-gaming-surface]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.gamingSurface as MouseStatus["gamingSurfaceMode"];
      if (mode) void handlers.applyGamingSurfaceMode(mode);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lightforce]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.lightforce as MouseStatus["lightforceSwitchMode"];
      if (mode) void handlers.applyLightforceSwitchMode(mode);
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
