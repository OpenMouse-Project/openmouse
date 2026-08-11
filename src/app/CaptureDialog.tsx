import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CAPTURE_ACTIONS,
  diffSectors,
  formatCaptureMarkdown,
  formatProfileVerificationMarkdown,
  formatProfileWriteProbeBackupMarkdown,
  formatProfileWriteProbeReportMarkdown,
  type SectorBytes,
  type SectorDiff,
} from "../capture-format";
import { captureContext } from "../capture-context";

export function CaptureDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [snapshot, setSnapshot] = useState<Map<number, Uint8Array> | null>(null);
  const [diffs, setDiffs] = useState<SectorDiff[]>([]);
  const [sectors, setSectors] = useState<SectorBytes[]>([]);
  const [selectedActions, setSelectedActions] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    } else if (typeof element.close === "function") {
      if (element.open) element.close();
    } else {
      element.removeAttribute("open");
    }
  }, [open]);

  const context = captureContext();
  const probe = context.writeProbe;

  async function takeSnapshot(): Promise<void> {
    if (!context.profiles) {
      setMessage("Connect a Logitech mouse with onboard profiles first.");
      return;
    }
    setMessage("Reading profiles…");
    try {
      const read = await context.profiles.read();
      const next = new Map(read.map((entry) => [entry.sector, entry.bytes]));
      setSnapshot(next);
      setDiffs([]);
      setMessage(`Snapshot taken (${next.size} profiles). Change one setting in G HUB or Onboard Memory Manager, then press Compare.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read profiles.");
    }
  }

  async function compareSnapshot(): Promise<void> {
    if (!context.profiles || !snapshot) {
      setMessage("Take a snapshot first.");
      return;
    }
    setMessage("Re-reading profiles…");
    try {
      const sectorsNow = await context.profiles.read();
      setSectors(sectorsNow.map((entry) => ({
        sector: entry.sector,
        before: snapshot.get(entry.sector) ?? entry.bytes,
        after: entry.bytes,
      })));
      const next = sectorsNow.map((entry) => {
        const before = snapshot.get(entry.sector) ?? entry.bytes;
        const changes = diffSectors(before, entry.bytes, (offset) => context.profiles!.describeOffset(offset));
        if (changes.length === 0) return { sector: entry.sector, changes };
        const reproduced = context.profiles!.reproduce(before, entry.bytes);
        const unreproduced = [...entry.bytes].flatMap((byte, offset) =>
          (reproduced[offset] === byte ? [] : [offset]));
        return { sector: entry.sector, changes, unreproduced };
      });
      setDiffs(next);

      const total = next.reduce((sum, diff) => sum + diff.changes.length, 0);
      const failed = next.reduce((sum, diff) => sum + (diff.unreproduced?.length ?? 0), 0);
      setMessage(total === 0
        ? "No profile bytes changed."
        : failed === 0
          ? `${total} byte(s) changed — write path verified, OpenMouse reproduces this exactly.`
          : `${total} byte(s) changed, ${failed} not reproducible by OpenMouse yet.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read profiles.");
    }
  }

  const changed = diffs.filter((diff) => diff.changes.length > 0);

  return (
    <dialog
      id="capture-dialog"
      ref={dialog}
      style={{
        width: "min(1100px,94vw)",
        maxWidth: "none",
        height: "min(88vh,900px)",
        padding: 0,
        border: "1px solid #303036",
        borderRadius: "12px",
        background: "#131316",
        color: "#d8d8dc",
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      onClose={onClose}
    >
      <div style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "1rem 1.1rem",
        boxSizing: "border-box",
        gap: ".6rem",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
          <div>
            <p style={{ margin: 0, color: "#77777c", fontSize: ".6rem", letterSpacing: ".05em" }}>DEVELOPMENT</p>
            <h2 style={{ margin: ".1rem 0 0", fontSize: "1rem", color: "#ececef" }}>HID++ capture</h2>
          </div>
          <button id="capture-close" type="button" aria-label="Close capture" onClick={onClose}>Close</button>
        </div>

        <small style={{ color: "#77777c", fontSize: ".64rem" }}>
          <strong style={{ color: "#a8a8ae" }}>Verify a format:</strong> copy a read-only bundle containing the
          memory geometry, full directory, every profile and all CRC results. To map an individual setting,
          snapshot the profiles, change only that setting in G HUB or Onboard Memory Manager, compare, mark the
          change and copy the comparison.
        </small>

        <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem", alignItems: "center" }}>
          <button
            id="capture-verification"
            type="button"
            className="is-primary"
            disabled={busy}
            onClick={() => {
              if (!context.profiles) {
                setMessage("Connect a Logitech mouse with onboard profiles first.");
                return;
              }
              setBusy(true);
              setMessage("Reading the directory and every profile sector…");
              void context.profiles.readVerification().then(async (verification) => {
                await navigator.clipboard.writeText(formatProfileVerificationMarkdown({
                  ...verification,
                  device: context.device,
                  profileFormat: context.profileFormat,
                }));
                setMessage(`Verification data copied (${verification.profiles.length} profiles, format ${verification.info.profileFormatId}).`);
              }).catch((error: unknown) => {
                setMessage(error instanceof Error ? error.message : "Could not collect profile verification data.");
              }).finally(() => setBusy(false));
            }}
          >
            Copy verification data
          </button>

          {probe ? (
            <button
              id="capture-write-probe"
              type="button"
              disabled={busy || probe.supported !== true}
              title={probe.reason}
              style={{ borderColor: "#7d3038", background: "#32181c", color: "#ff9ca5" }}
              onClick={() => {
                if (!probe.supported || !probe.prepare || !probe.run) return;
                setBusy(true);
                setMessage("Reading and copying the recovery backup…");
                void probe.prepare().then(async (backup) => {
                  await navigator.clipboard.writeText(formatProfileWriteProbeBackupMarkdown(backup));
                  const approved = window.confirm(
                    "Recovery backup copied. This test performs six profile-sector erase/write cycles, temporarily changes the profile name, DPI, and polling rate, then restores the exact original after every step. Do not disconnect or power off the mouse. Run the probe now?",
                  );
                  if (!approved) {
                    setMessage("Recovery backup copied. Write probe cancelled before any flash write.");
                    return;
                  }
                  setMessage("Running write probe. Do not disconnect or power off the mouse…");
                  const report = await probe.run!(backup);
                  await navigator.clipboard.writeText(formatProfileWriteProbeReportMarkdown(report));
                  setMessage(report.ok
                    ? "Write probe passed and the original profile was restored. Report copied."
                    : `Write probe failed. Recovery report copied; profile restored: ${report.restored}, mode restored: ${report.modeRestored}.`);
                }).catch((error: unknown) => {
                  setMessage(error instanceof Error ? error.message : "Could not run the profile write probe.");
                }).finally(() => setBusy(false));
              }}
            >
              Verify profile writes
            </button>
          ) : null}

          <button id="capture-snapshot" type="button" onClick={() => void takeSnapshot()}>Snapshot profiles</button>
          <button id="capture-compare" type="button" onClick={() => void compareSnapshot()}>Compare</button>
          <button
            id="capture-reset"
            type="button"
            onClick={() => {
              setSnapshot(null);
              setDiffs([]);
              setSectors([]);
              setSelectedActions(new Set());
              setMessage("Cleared.");
            }}
          >
            Clear
          </button>
          <button
            id="capture-copy"
            type="button"
            onClick={() => {
              const markdown = formatCaptureMarkdown({
                device: context.device,
                profileFormat: context.profileFormat,
                actions: [...selectedActions],
                notes,
                diffs,
                sectors,
              });
              void navigator.clipboard.writeText(markdown).then(
                () => setMessage("Capture copied — paste it into a GitHub issue."),
                () => setMessage("Could not copy to the clipboard."),
              );
            }}
          >
            Copy comparison
          </button>
          <span id="capture-status" role="status" aria-live="polite" style={{ color: "#77777c", fontSize: ".62rem" }}>
            {message}
          </span>
        </div>

        <div
          id="capture-diff"
          style={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid #26262a", borderRadius: "8px", padding: ".5rem" }}
        >
          {changed.length === 0 ? (
            <p style={{ color: "#77777c", fontSize: ".62rem", margin: 0 }}>
              {diffs.length > 0
                ? "No profile bytes changed — this setting is not stored in a profile."
                : snapshot
                  ? "Snapshot ready. Change one setting in the vendor app, then Compare."
                  : "Snapshot the profiles, change one setting in the vendor app, then Compare."}
            </p>
          ) : (
            changed.map((diff) => (
              <div key={diff.sector} style={{ marginBottom: ".5rem" }}>
                <div style={{ display: "flex", gap: ".5rem", alignItems: "baseline", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: ".66rem", color: "#e6e6ea" }}>
                    Sector {diff.sector} — {diff.changes.length} byte(s)
                  </strong>
                  {diff.unreproduced === undefined ? null : diff.unreproduced.length === 0 ? (
                    <span style={{ color: "#6fd3a0", fontSize: ".6rem", fontWeight: 600 }}>✓ write path verified</span>
                  ) : (
                    <span style={{ color: "#e8798f", fontSize: ".6rem", fontWeight: 600 }}>
                      ✗ {diff.unreproduced.length} byte(s) not reproducible
                    </span>
                  )}
                </div>
                <div style={{ display: "grid", gap: ".1rem", marginTop: ".2rem" }}>
                  {diff.changes.map((change) => (
                    <div
                      key={change.offset}
                      style={{ display: "flex", gap: ".6rem", fontSize: ".62rem", color: "#d8d8dc", alignItems: "baseline" }}
                    >
                      <code style={{ color: "#8b8b90", minWidth: "3.2rem" }}>
                        0x{change.offset.toString(16).padStart(2, "0")}
                      </code>
                      <code style={{ minWidth: "5rem" }}>
                        {change.before.toString(16).padStart(2, "0")} → {change.after.toString(16).padStart(2, "0")}
                      </code>
                      <span style={{ color: change.field === "checksum" ? "#77777c" : "#6fd3a0" }}>
                        {change.field ?? "unknown"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div>
          <p style={{ margin: "0 0 .25rem", color: "#77777c", fontSize: ".62rem" }}>What did you change?</p>
          <div id="capture-action-list" style={{ display: "flex", flexWrap: "wrap", gap: ".3rem" }}>
            {CAPTURE_ACTIONS.map((action) => {
              const active = selectedActions.has(action.id);
              return (
                <button
                  key={action.id}
                  type="button"
                  aria-pressed={active}
                  style={{
                    padding: ".22rem .5rem",
                    border: `1px solid ${active ? action.color : "#3a3a3f"}`,
                    borderRadius: "999px",
                    background: active ? `${action.color}22` : "#19191c",
                    color: active ? action.color : "#8b8b90",
                    fontSize: ".6rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  onClick={() => setSelectedActions((current) => {
                    const next = new Set(current);
                    if (next.has(action.id)) next.delete(action.id);
                    else next.add(action.id);
                    return next;
                  })}
                >
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>

        <textarea
          id="capture-notes"
          rows={2}
          placeholder="Optional detail, e.g. wireless polling 8000 Hz to 1000 Hz"
          value={notes}
          onChange={(event) => setNotes(event.currentTarget.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: ".45rem",
            border: "1px solid #343438",
            borderRadius: "6px",
            background: "#171719",
            color: "#d8d8dc",
            fontSize: ".66rem",
          }}
        />
      </div>
    </dialog>
  );
}
