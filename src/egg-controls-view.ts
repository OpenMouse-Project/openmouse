import {
  EGG_BUTTON_MAPPINGS,
  EGG_BUTTON_NAMES,
  type EggButtonIndex,
  type EggButtonMapping,
} from "./egg-op1-hid";
import type { MouseStatus } from "./mouse-types";

export interface EggControlActions {
  applyCpiStage(level: number, x: number, y: number): Promise<void>;
  applyMulticlick(button: EggButtonIndex, value: number): Promise<void>;
  applyButtonMapping(button: EggButtonIndex, mapping: EggButtonMapping): Promise<void>;
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
    return `<div style="padding:.55rem;border:1px solid #303034;border-radius:6px">
      <strong style="font-size:.7rem">Stage ${index + 1}</strong>
      <label style="display:flex;align-items:center;gap:.35rem;margin:.4rem 0;color:#8b8b90;font-size:.62rem"><input data-cpi-split="${index}" type="checkbox" ${split ? "checked" : ""} /> Separate X/Y</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.35rem">
        <label style="color:#77777c;font-size:.58rem">X<input data-cpi-x="${index}" type="number" min="50" max="26000" step="50" value="${stage.x}" style="width:100%;box-sizing:border-box;margin-top:.15rem;padding:.35rem;background:#171719;color:#eee;border:1px solid #343438;border-radius:5px" /></label>
        <label style="color:#77777c;font-size:.58rem">Y<input data-cpi-y="${index}" type="number" min="50" max="26000" step="50" value="${stage.y}" ${split ? "" : "disabled"} style="width:100%;box-sizing:border-box;margin-top:.15rem;padding:.35rem;background:#171719;color:#eee;border:1px solid #343438;border-radius:5px" /></label>
      </div>
      <button data-apply-cpi="${index}" type="button" style="margin-top:.4rem;padding:.3rem .5rem">Apply stage</button>
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
    return `<div style="padding:.55rem;border:1px solid #303034;border-radius:6px">
      <strong style="font-size:.7rem">${name}</strong>
      <label style="display:block;margin-top:.35rem;color:#77777c;font-size:.58rem">Multiclick filter<input data-multiclick="${index}" type="number" min="0" max="25" step="1" value="${filters[index]}" ${gxActive ? "disabled" : ""} style="width:100%;box-sizing:border-box;margin-top:.15rem;padding:.35rem;background:#171719;color:#eee;border:1px solid #343438;border-radius:5px" /></label>
      <label style="display:block;margin-top:.35rem;color:#77777c;font-size:.58rem">Mapping<select data-button-mapping="${index}" style="width:100%;margin-top:.15rem;padding:.35rem;background:#171719;color:#eee;border:1px solid #343438;border-radius:5px">${unsupported}${mappingOptions}</select></label>
    </div>`;
  }).join("");
  container.querySelectorAll<HTMLInputElement>("[data-multiclick]").forEach((input) => input.addEventListener("change", () => void applyMulticlick(Number(input.dataset.multiclick) as EggButtonIndex, Number(input.value))));
  container.querySelectorAll<HTMLSelectElement>("[data-button-mapping]").forEach((select) => select.addEventListener("change", () => void applyButtonMapping(Number(select.dataset.buttonMapping) as EggButtonIndex, select.value as EggButtonMapping)));
}
