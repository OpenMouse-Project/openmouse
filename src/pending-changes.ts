import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";

export interface PendingChange {
  // Dedupe key. Staging the same key again replaces the earlier entry.
  key: string;
  // Settings that land in the same byte, sector or transaction share a group.
  // A group is written once, by the last change staged into it, so its apply
  // has to write every staged value in the group rather than only its own.
  // Without this, two changes to one byte cost two writes and the second is
  // built from a device read the first has already invalidated.
  group?: string;
  // Short summary shown in the unsaved-changes bar, e.g. "DPI 1,600".
  label: string;
  // Diagnostics command text recorded when the change is flashed.
  command: string;
  // Live-status copy shown while this change is being written.
  progress: string;
  // Mirrors the staged value onto a status snapshot so the UI can render it.
  // Omitted when the setting is not part of MouseStatus (a Logitech onboard
  // profile value, say); such a change renders itself and cannot be compared
  // against the device status.
  preview?(status: MouseStatus): void;
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

/**
 * Staged changes split into the batches a flash should write, in staging order.
 * Changes sharing a group collapse into one batch; an ungrouped change is a
 * batch of its own. The last entry of a batch is the one that performs the
 * write, so a batch is applied by calling `apply` on `batch.at(-1)`.
 */
export function pendingChangeBatches(): PendingChange[][] {
  const batches: PendingChange[][] = [];
  const byGroup = new Map<string, PendingChange[]>();
  for (const change of changes.values()) {
    if (change.group === undefined) {
      batches.push([change]);
      continue;
    }
    const existing = byGroup.get(change.group);
    if (existing) {
      existing.push(change);
      continue;
    }
    // The batch keeps the position of its first member, so the bar and the
    // flash order follow the order settings were touched.
    const batch = [change];
    byGroup.set(change.group, batch);
    batches.push(batch);
  }
  return batches;
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
  for (const change of changes.values()) change.preview?.(preview);
  return preview;
}
