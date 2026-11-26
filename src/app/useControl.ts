import { useSyncExternalStore } from "react";
import { getSnapshot, subscribe } from "../device/controller";
import type { ControlSnapshot } from "../device/types";

export function useControl(): ControlSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useControlSelector<T>(selector: (snapshot: ControlSnapshot) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}
