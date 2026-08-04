import type { MouseStatus } from "./devices/mouse-types";

export interface PendingChange {
  // Dedupe key. Staging the same key again replaces the earlier entry.
  key: string;
  // Short summary shown in the unsaved-changes bar, e.g. "DPI 1,600".
  label: string;
  // Diagnostics command text recorded when the change is flashed.
  command: string;
  // Live-status copy shown while this change is being written.
  progress: string;
  // Mirrors the staged value onto a status snapshot so the UI can render it.
  preview(status: MouseStatus): void;
  // Writes the staged value to the device.
  apply(): Promise<void>;
}

const changes = new Map<string, PendingChange>();
const listeners = new Set<() => void>();

export function onPendingChanges(listener: () => void): void {
  listeners.add(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function stagePendingChange(change: PendingChange): void {
  // Re-insert so the bar lists changes in the order they were last touched.
  changes.delete(change.key);
  changes.set(change.key, change);
  notify();
}

export function pendingChanges(): PendingChange[] {
  return [...changes.values()];
}

export function pendingChangeCount(): number {
  return changes.size;
}

export function hasPendingChanges(): boolean {
  return changes.size > 0;
}

export function isPendingChange(key: string): boolean {
  return changes.has(key);
}

export function dropPendingChange(key: string): void {
  if (changes.delete(key)) notify();
}

export function clearPendingChanges(): void {
  if (changes.size === 0) return;
  changes.clear();
  notify();
}

/**
 * Returns `status` with every staged value mirrored onto a copy, so background
 * refreshes cannot snap the controls back to the values still on the device.
 */
export function withPendingChanges(status: MouseStatus): MouseStatus {
  if (changes.size === 0) return status;
  const preview = structuredClone(status);
  for (const change of changes.values()) change.preview(preview);
  return preview;
}
