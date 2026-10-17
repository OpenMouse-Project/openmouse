import type { KeyboardCommand, KeyboardWorkspace } from "./keyboard-workspace.ts";
import type { KeyboardIdentityView, KeyboardPollingView, KeyboardTriggerKey, KeyboardTriggerPatch, KeyboardTriggerSettings } from "./types.ts";

export interface KeyboardClient {
  readonly device: HIDDevice;
  readonly family: "wuque" | "kochi";
  readonly brand: string;
  readonly name: string;
  open(): Promise<void>;
  close(): Promise<void>;
  readIdentity(): Promise<KeyboardIdentityView>;
  command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>>;
  readPolling?(): Promise<KeyboardPollingView>;
  setPollingRate?(hz: number): Promise<KeyboardPollingView>;
  readTrigger?(): Promise<{ matrix: readonly (readonly number[])[]; keys: KeyboardTriggerKey[] }>;
  writeTrigger?(row: number, col: number, patch: KeyboardTriggerPatch): Promise<KeyboardTriggerSettings>;
}
