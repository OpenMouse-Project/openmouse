import {
  EGG_BUTTON_MAPPINGS,
  EGG_BUTTON_NAMES,
  type EggButtonIndex,
  type EggButtonMapping,
} from "./egg-op1-hid";
import type { MouseStatus } from "../mouse-types";

export interface EggControlActions {
  applyCpiStage(level: number, x: number, y: number): void;
  applyMulticlick(button: EggButtonIndex, value: number): void;
  applyButtonMapping(button: EggButtonIndex, mapping: EggButtonMapping): void;
}

export function renderEggControls(status: MouseStatus, actions: EggControlActions): void {
  renderCpiStages(status, actions.applyCpiStage);
  renderButtons(status, actions.applyMulticlick, actions.applyButtonMapping);
}

function renderCpiStages(status: MouseStatus, applyCpiStage: EggControlActions["applyCpiStage"]): void {
  const container = document.querySelector<HTMLElement>("#egg-cpi-stage-list");
  const stages = status.eggCpiStages;
  const levels = status.eggCpiLevels ?? 0;
  if (!container || !stages) return;
  container.innerHTML = stages.slice(0, levels).map((stage, index) => {
    const split = stage.x !== stage.y;
    return `<div>
      <strong>Stage ${index + 1}</strong>
      <label class="egg-split-toggle"><input data-cpi-split="${index}" type="checkbox" ${split ? "checked" : ""} /> Separate X/Y</label>
      <div class="egg-tile-pair">
        <label class="egg-tile-label">X<input data-cpi-x="${index}" class="egg-tile-field" type="number" min="50" max="26000" step="50" value="${stage.x}" /></label>
        <label class="egg-tile-label">Y<input data-cpi-y="${index}" class="egg-tile-field" type="number" min="50" max="26000" step="50" value="${stage.y}" ${split ? "" : "disabled"} /></label>
      </div>
      <button data-apply-cpi="${index}" type="button">Apply stage</button>
    </div>`;
  }).join("");
  container.querySelectorAll<HTMLInputElement>("[data-cpi-split]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const y = container.querySelector<HTMLInputElement>(`[data-cpi-y="${checkbox.dataset.cpiSplit}"]`);
      if (y) y.disabled = !checkbox.checked;
    });
  });
  container.querySelectorAll<HTMLButtonElement>("[data-apply-cpi]").forEach((button) => {
    button.addEventListener("click", () => {
      const level = Number(button.dataset.applyCpi);
      const x = Number(container.querySelector<HTMLInputElement>(`[data-cpi-x="${level}"]`)?.value);
      const split = container.querySelector<HTMLInputElement>(`[data-cpi-split="${level}"]`)?.checked === true;
      const y = split ? Number(container.querySelector<HTMLInputElement>(`[data-cpi-y="${level}"]`)?.value) : x;
      void applyCpiStage(level, x, y);
    });
  });
}

function renderButtons(
  status: MouseStatus,
  applyMulticlick: EggControlActions["applyMulticlick"],
  applyButtonMapping: EggControlActions["applyButtonMapping"],
): void {
  const container = document.querySelector<HTMLElement>("#egg-button-list");
  const filters = status.eggMulticlickFilters;
  const mappings = status.eggButtonMappings;
  if (!container || !filters || !mappings) return;
  container.innerHTML = EGG_BUTTON_NAMES.map((name, index) => {
    const gxActive = index === 0 ? status.leftSpdtMode !== "Off" : index === 1 ? status.rightSpdtMode !== "Off" : false;
    const mappingOptions = EGG_BUTTON_MAPPINGS.map((mapping) => `<option ${mappings[index] === mapping ? "selected" : ""}>${mapping}</option>`).join("");
    const unsupported = EGG_BUTTON_MAPPINGS.includes(mappings[index] as EggButtonMapping) ? "" : `<option selected disabled>${mappings[index]}</option>`;
    return `<div>
      <strong>${name}</strong>
      <label class="egg-tile-label stacked">Multiclick filter<input data-multiclick="${index}" class="egg-tile-field" type="number" min="0" max="25" step="1" value="${filters[index]}" ${gxActive ? "disabled" : ""} /></label>
      <label class="egg-tile-label stacked">Mapping<select data-button-mapping="${index}" class="egg-tile-field">${unsupported}${mappingOptions}</select></label>
    </div>`;
  }).join("");
  container.querySelectorAll<HTMLInputElement>("[data-multiclick]").forEach((input) => input.addEventListener("change", () => void applyMulticlick(Number(input.dataset.multiclick) as EggButtonIndex, Number(input.value))));
  container.querySelectorAll<HTMLSelectElement>("[data-button-mapping]").forEach((select) => select.addEventListener("change", () => void applyButtonMapping(Number(select.dataset.buttonMapping) as EggButtonIndex, select.value as EggButtonMapping)));
}
