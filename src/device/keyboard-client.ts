import type { KeyboardCommand, KeyboardWorkspace } from "./keyboard-workspace.ts";
import type { KeyboardIdentityView, KeyboardPollingView, KeyboardTriggerKey, KeyboardTriggerPatch, KeyboardTriggerSettings } from "./types.ts";

export interface KeyboardClient {
  readonly device: HIDDevice;
  readonly family: "wuque" | "kochi" | "wooting" | "razer" | "logitech" | "steelseries" | "keychron" | "arbiter";
  readonly brand: string;
  /** Set once the session needs a reconnect before it can be used again. */
  readonly faulted?: boolean;
  readonly name: string;
  open(): Promise<void>;
  close(): Promise<void>;
  readIdentity(): Promise<KeyboardIdentityView>;
  command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>>;
  /** State to merge after `command` threw, when the failure also changed what the board holds. */
  recoveredWorkspace?(): Partial<KeyboardWorkspace> | null;
  readPolling?(): Promise<KeyboardPollingView>;
  setPollingRate?(hz: number): Promise<KeyboardPollingView>;
  readTrigger?(): Promise<{ matrix: readonly (readonly number[])[]; keys: KeyboardTriggerKey[] }>;
  writeTrigger?(row: number, col: number, patch: KeyboardTriggerPatch): Promise<KeyboardTriggerSettings>;
}
