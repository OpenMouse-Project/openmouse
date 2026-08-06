import {
  CAPTURE_ACTIONS,
  diffSectors,
  formatCaptureMarkdown,
  formatProfileVerificationMarkdown,
  formatProfileWriteProbeBackupMarkdown,
  formatProfileWriteProbeReportMarkdown,
  type ProfileVerificationExport,
  type SectorBytes,
  type SectorDiff,
} from "./capture-format";
import type {
  ProfileContentWriteProbeBackup,
  ProfileContentWriteProbeReport,
} from "./devices/logitech/hidpp";
import { escapeHtml } from "./ui/dom";

/**
 * Profile capture panel.
 *
 * Snapshot the profiles, change one setting in the vendor app, compare. The
 * bytes that moved are what that setting maps to, which is what confirms a
 * layout — and what makes a write safe to implement.
 *
 * Raw HID traffic is deliberately not shown: it is dominated by routine polling,
 * and a vendor app's writes are invisible to us in any case.
 */

export interface CaptureProfileSource {
  read(): Promise<Array<{ sector: number; bytes: Uint8Array }>>;
  readVerification(): Promise<Omit<ProfileVerificationExport, "device" | "profileFormat">>;
  describeOffset(offset: number): string | null;
  /** Applies the change with OpenMouse's own encoders, for verification. */
  reproduce(before: Uint8Array, after: Uint8Array): Uint8Array;
  prepareWriteProbe?(): Promise<ProfileContentWriteProbeBackup>;
  runWriteProbe?(backup: ProfileContentWriteProbeBackup): Promise<ProfileContentWriteProbeReport>;
}

interface CaptureContext {
  device: string | null;
  profileFormat: string | null;
  profiles: CaptureProfileSource | null;
}

let context: CaptureContext = { device: null, profileFormat: null, profiles: null };
/** Sector -> bytes, taken before the vendor-app change. */
let snapshot: Map<number, Uint8Array> | null = null;
let diffs: SectorDiff[] = [];
let sectors: SectorBytes[] = [];
const selectedActions = new Set<string>();

export function setCaptureContext(next: CaptureContext): void {
  context = next;
}

function renderActions(): void {
  const container = document.querySelector<HTMLElement>("#capture-action-list");
  if (!container) return;
  container.innerHTML = CAPTURE_ACTIONS.map((action) => {
    const active = selectedActions.has(action.id);
    return `<button type="button" data-capture-action="${action.id}" aria-pressed="${active}" style="padding:.22rem .5rem;border:1px solid ${active ? action.color : "#3a3a3f"};border-radius:999px;background:${active ? `${action.color}22` : "#19191c"};color:${active ? action.color : "#8b8b90"};font-size:.6rem;font-weight:600;cursor:pointer">${escapeHtml(action.label)}</button>`;
  }).join("");
}

function renderDiffs(): void {
  const container = document.querySelector<HTMLElement>("#capture-diff");
  if (!container) return;

  const changed = diffs.filter((diff) => diff.changes.length > 0);
  if (changed.length === 0) {
    const message = diffs.length > 0
      ? "No profile bytes changed — this setting is not stored in a profile."
      : snapshot
        ? "Snapshot ready. Change one setting in the vendor app, then Compare."
        : "Snapshot the profiles, change one setting in the vendor app, then Compare.";
    container.innerHTML = `<p style="color:#77777c;font-size:.62rem;margin:0">${message}</p>`;
    return;
  }

  container.innerHTML = changed.map((diff) => {
    const verdict = diff.unreproduced === undefined
      ? ""
      : diff.unreproduced.length === 0
        ? `<span style="color:#6fd3a0;font-size:.6rem;font-weight:600">✓ write path verified</span>`
        : `<span style="color:#e8798f;font-size:.6rem;font-weight:600">✗ ${diff.unreproduced.length} byte(s) not reproducible</span>`;
    return `
    <div style="margin-bottom:.5rem">
      <div style="display:flex;gap:.5rem;align-items:baseline;flex-wrap:wrap"><strong style="font-size:.66rem;color:#e6e6ea">Sector ${diff.sector} — ${diff.changes.length} byte(s)</strong>${verdict}</div>
      <div style="display:grid;gap:.1rem;margin-top:.2rem">
        ${diff.changes.map((change) => `<div style="display:flex;gap:.6rem;font-size:.62rem;color:#d8d8dc;align-items:baseline">
          <code style="color:#8b8b90;min-width:3.2rem">0x${change.offset.toString(16).padStart(2, "0")}</code>
          <code style="min-width:5rem">${change.before.toString(16).padStart(2, "0")} → ${change.after.toString(16).padStart(2, "0")}</code>
          <span style="color:${change.field === "checksum" ? "#77777c" : "#6fd3a0"}">${escapeHtml(change.field ?? "unknown")}</span>
        </div>`).join("")}
      </div>
    </div>`;
  }).join("");
}

function setCaptureMessage(message: string): void {
  const status = document.querySelector<HTMLElement>("#capture-status");
  if (status) status.textContent = message;
}

export function refreshCapturePanel(): void {
  renderActions();
  renderDiffs();
  const probe = document.querySelector<HTMLButtonElement>("#capture-write-probe");
  if (probe) probe.hidden = !context.profiles?.prepareWriteProbe || !context.profiles.runWriteProbe;
}

async function takeSnapshot(): Promise<void> {
  if (!context.profiles) {
    setCaptureMessage("Connect a Logitech mouse with onboard profiles first.");
    return;
  }
  setCaptureMessage("Reading profiles…");
  try {
    const sectors = await context.profiles.read();
    snapshot = new Map(sectors.map((entry) => [entry.sector, entry.bytes]));
    diffs = [];
    renderDiffs();
    setCaptureMessage(`Snapshot taken (${snapshot.size} profiles). Change one setting in G HUB or Onboard Memory Manager, then press Compare.`);
  } catch (error) {
    setCaptureMessage(error instanceof Error ? error.message : "Could not read profiles.");
  }
}

async function compareSnapshot(): Promise<void> {
  if (!context.profiles || !snapshot) {
    setCaptureMessage("Take a snapshot first.");
    return;
  }
  setCaptureMessage("Re-reading profiles…");
  try {
    const sectorsNow = await context.profiles.read();
    sectors = sectorsNow.map((entry) => ({
      sector: entry.sector,
      before: snapshot!.get(entry.sector) ?? entry.bytes,
      after: entry.bytes,
    }));
    diffs = sectorsNow.map((entry) => {
      const before = snapshot!.get(entry.sector) ?? entry.bytes;
      const changes = diffSectors(before, entry.bytes, (offset) => context.profiles!.describeOffset(offset));
      if (changes.length === 0) return { sector: entry.sector, changes };

      // Replay the same change through our own encoders. Anything we cannot
      // reproduce is a field we would write incorrectly.
      const reproduced = context.profiles!.reproduce(before, entry.bytes);
      const unreproduced = [...entry.bytes].flatMap((byte, offset) =>
        (reproduced[offset] === byte ? [] : [offset]));
      return { sector: entry.sector, changes, unreproduced };
    });
    renderDiffs();

    const total = diffs.reduce((sum, diff) => sum + diff.changes.length, 0);
    const failed = diffs.reduce((sum, diff) => sum + (diff.unreproduced?.length ?? 0), 0);
    setCaptureMessage(total === 0
      ? "No profile bytes changed."
      : failed === 0
        ? `${total} byte(s) changed — write path verified, OpenMouse reproduces this exactly.`
        : `${total} byte(s) changed, ${failed} not reproducible by OpenMouse yet.`);
  } catch (error) {
    setCaptureMessage(error instanceof Error ? error.message : "Could not read profiles.");
  }
}

export function bindCapturePanel(): void {
  const dialog = document.querySelector<HTMLDialogElement>("#capture-dialog");
  const openDialog = (): void => {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  };
  const closeDialog = (): void => {
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  };
  document.querySelector<HTMLButtonElement>("#capture-open")?.addEventListener("click", () => {
    refreshCapturePanel();
    openDialog();
  });
  document.querySelector<HTMLButtonElement>("#capture-close")?.addEventListener("click", closeDialog);
  // Clicking the backdrop closes; clicks inside the panel must not.
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });

  document.querySelector<HTMLElement>("#capture-action-list")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-capture-action]");
    if (!button) return;
    const id = button.dataset.captureAction!;
    if (selectedActions.has(id)) selectedActions.delete(id);
    else selectedActions.add(id);
    renderActions();
  });

  document.querySelector<HTMLButtonElement>("#capture-snapshot")?.addEventListener("click", () => void takeSnapshot());
  document.querySelector<HTMLButtonElement>("#capture-compare")?.addEventListener("click", () => void compareSnapshot());
  document.querySelector<HTMLButtonElement>("#capture-verification")?.addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (!context.profiles) {
      setCaptureMessage("Connect a Logitech mouse with onboard profiles first.");
      return;
    }
    button.disabled = true;
    setCaptureMessage("Reading the directory and every profile sector…");
    void context.profiles.readVerification().then(async (verification) => {
      const markdown = formatProfileVerificationMarkdown({
        ...verification,
        device: context.device,
        profileFormat: context.profileFormat,
      });
      await navigator.clipboard.writeText(markdown);
      setCaptureMessage(`Verification data copied (${verification.profiles.length} profiles, format ${verification.info.profileFormatId}).`);
    }).catch((error) => {
      setCaptureMessage(error instanceof Error ? error.message : "Could not collect profile verification data.");
    }).finally(() => {
      button.disabled = false;
    });
  });

  document.querySelector<HTMLButtonElement>("#capture-write-probe")?.addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const source = context.profiles;
    if (!source?.prepareWriteProbe || !source.runWriteProbe) return;
    button.disabled = true;
    setCaptureMessage("Reading and copying the recovery backup…");
    void source.prepareWriteProbe().then(async (backup) => {
      await navigator.clipboard.writeText(formatProfileWriteProbeBackupMarkdown(backup));
      const approved = window.confirm(
        "Recovery backup copied. This test performs six profile-sector erase/write cycles, temporarily changes the profile name, DPI, and polling rate, then restores the exact original after every step. Do not disconnect or power off the mouse. Run the probe now?",
      );
      if (!approved) {
        setCaptureMessage("Recovery backup copied. Write probe cancelled before any flash write.");
        return;
      }
      setCaptureMessage("Running write probe. Do not disconnect or power off the mouse…");
      const report = await source.runWriteProbe!(backup);
      await navigator.clipboard.writeText(formatProfileWriteProbeReportMarkdown(report));
      setCaptureMessage(report.ok
        ? "Write probe passed and the original profile was restored. Report copied."
        : `Write probe failed. Recovery report copied; profile restored: ${report.restored}, mode restored: ${report.modeRestored}.`);
    }).catch((error) => {
      setCaptureMessage(error instanceof Error ? error.message : "Could not run the profile write probe.");
    }).finally(() => {
      button.disabled = false;
    });
  });

  document.querySelector<HTMLButtonElement>("#capture-reset")?.addEventListener("click", () => {
    snapshot = null;
    diffs = [];
    sectors = [];
    selectedActions.clear();
    refreshCapturePanel();
    setCaptureMessage("Cleared.");
  });

  document.querySelector<HTMLButtonElement>("#capture-copy")?.addEventListener("click", () => {
    const markdown = formatCaptureMarkdown({
      device: context.device,
      profileFormat: context.profileFormat,
      actions: [...selectedActions],
      notes: document.querySelector<HTMLTextAreaElement>("#capture-notes")?.value ?? "",
      diffs,
      sectors,
    });
    void navigator.clipboard.writeText(markdown).then(
      () => setCaptureMessage("Capture copied — paste it into a GitHub issue."),
      () => setCaptureMessage("Could not copy to the clipboard."),
    );
  });
}
