import { useSyncExternalStore } from "react";
import { getSnapshot, subscribe } from "../device/controller";
import type { ControlSnapshot } from "../device/types";

export function useControl(): ControlSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}
