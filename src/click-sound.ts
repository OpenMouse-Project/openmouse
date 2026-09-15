import { setSoundsEnabled } from "./sound-manager";

export function initClickSound(): void {
  setSoundsEnabled(true);
}

export function removeClickSound(): void {
  setSoundsEnabled(false);
}