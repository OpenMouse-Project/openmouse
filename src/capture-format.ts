import type {
  ProfileContentWriteProbeBackup,
  ProfileContentWriteProbeReport,
} from "@openmouse/protocol/drivers/logitech/hidpp";

/**
 * Export format for profile-layout confirmations.
 *
 * The useful signal is not raw HID traffic — most of it is routine polling, and
 * a vendor app's writes are invisible to us anyway. What confirms a layout is
 * the *result*: snapshot the profiles, change one setting in the vendor app,
 * and diff. The bytes that moved are what that setting maps to.
 */

export interface CaptureAction {
  id: string;
  label: string;
  /** Distinct colour so selected changes stay readable side by side. */
  color: string;
}

export const CAPTURE_ACTIONS: readonly CaptureAction[] = [
  { id: "dpi", label: "DPI", color: "#6fd3a0" },
  { id: "lod", label: "Lift-off distance", color: "#7fb2f0" },
  { id: "polling", label: "Polling rate", color: "#d9a45b" },
  { id: "surface", label: "Gaming surface", color: "#c08cf0" },
  { id: "lightforce", label: "LightForce switches", color: "#e8798f" },
  { id: "profile", label: "Profile switch", color: "#5fc9c9" },
  { id: "onboard", label: "Onboard/host mode", color: "#b0b84f" },
  { id: "buttons", label: "Button assignment", color: "#f0925b" },
  { id: "lighting", label: "Lighting", color: "#9d8cf0" },
  { id: "name", label: "Profile name", color: "#8fd0e8" },
  { id: "other", label: "Other", color: "#8b8b90" },
] as const;

export function actionById(id: string): CaptureAction | undefined {
  return CAPTURE_ACTIONS.find((action) => action.id === id);
}

export interface ByteChange {
  offset: number;
  before: number;
  after: number;
  /** Which profile field owns the byte, when the layout knows. */
  field: string | null;
}

export interface SectorDiff {
  sector: number;
  changes: ByteChange[];
  /**
   * Offsets our own encoder failed to reproduce. Empty means OpenMouse can
   * write this change byte-for-byte as the vendor app did; undefined means no
   * verification was run.
   */
  unreproduced?: number[];
}

/** Byte-level diff of a profile sector before and after a change. */
export function diffSectors(
  before: Uint8Array,
  after: Uint8Array,
  describe: (offset: number) => string | null,
): ByteChange[] {
  const changes: ByteChange[] = [];
  const length = Math.min(before.length, after.length);
  for (let offset = 0; offset < length; offset += 1) {
    if (before[offset] !== after[offset]) {
      changes.push({ offset, before: before[offset], after: after[offset], field: describe(offset) });
    }
  }
  return changes;
}

export interface SectorBytes {
  sector: number;
  before: Uint8Array;
  after: Uint8Array;
}

export interface CaptureExport {
  device: string | null;
  profileFormat: string | null;
  /** What the user changed in the vendor app; several may apply at once. */
  actions: string[];
  notes: string;
  diffs: SectorDiff[];
  /** Raw sectors, so a maintainer can paste them straight into a test fixture. */
  sectors?: SectorBytes[];
}

export interface ProfileVerificationProfile {
  sector: number;
  enabled: boolean;
  isCurrent: boolean;
  crcValid: boolean;
  decoded: Record<string, unknown>;
  bytes: Uint8Array;
}

/** Everything needed to independently validate one profile-format dump. */
export interface ProfileVerificationExport {
  device: string | null;
  profileFormat: string | null;
  info: {
    memoryModelId: number;
    profileFormatId: number;
    profileCount: number;
    sectorCount: number;
    sectorSize: number;
  };
  infoReply: Uint8Array;
  mode: string;
  modeValue: number;
  modeReply: Uint8Array;
  currentSector: number;
  currentProfileReply: Uint8Array;
  directory: Uint8Array;
  directoryCrcValid: boolean;
  profiles: ProfileVerificationProfile[];
  dpiCapabilities?: ProfileVerificationCapability | null;
  reportRateCapabilities?: ProfileVerificationCapability | null;
}

export interface ProfileVerificationCapability {
  featureId: number;
  featureIndex: number;
  featureVersion: number;
  kind: "legacy" | "extended";
  replies: Array<{ name: string; bytes: Uint8Array }>;
  decodedValues: number[];
  error: string | null;
}

function hexBlock(bytes: Uint8Array): string {
  const rows: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    rows.push([...bytes.slice(offset, offset + 16)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" "));
  }
  return rows.join("\n");
}

const hexByte = (value: number): string => `0x${value.toString(16).padStart(2, "0")}`;

const hexWord = (value: number): string => `0x${value.toString(16).padStart(4, "0")}`;

function capabilityLines(
  label: string,
  capability: ProfileVerificationCapability | null | undefined,
  unit: string,
): string[] {
  if (capability === undefined) return [];
  if (capability === null) return [`- ${label}: not exposed`];
  const lines = [
    `- ${label}: feature ${hexWord(capability.featureId)}, index ${hexByte(capability.featureIndex)}, version ${capability.featureVersion}, ${capability.kind}`,
    `- ${label} values: ${capability.decodedValues.length > 0 ? capability.decodedValues.map((value) => `${value} ${unit}`).join(", ") : "none decoded"}`,
  ];
  if (capability.error) lines.push(`- ${label} read warning: ${capability.error}`);
  for (const reply of capability.replies) {
    lines.push(`- ${label} ${reply.name}: \`${[...reply.bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ")}\``);
  }
  return lines;
}

/** Recovery bundle copied before the first destructive verification write. */
export function formatProfileWriteProbeBackupMarkdown(backup: ProfileContentWriteProbeBackup): string {
  return [
    "## OpenMouse profile-write probe recovery backup",
    "",
    `- Profile format: ${backup.formatId}`,
    `- Sector: ${hexWord(backup.sector)}`,
    `- Sector size: ${backup.sectorSize} bytes`,
    `- Original mode: ${backup.originalMode}`,
    `- Original current sector: ${hexWord(backup.originalCurrentSector)}`,
    `- DPI options: ${backup.dpiOptions.join(", ")}`,
    `- Report rates: ${backup.reportRates.join(", ")} Hz`,
    "",
    "### Original directory sector",
    "",
    "```",
    hexBlock(backup.directory),
    "```",
    "",
    `### Original profile sector ${hexWord(backup.sector)}`,
    "",
    "```",
    hexBlock(backup.profile),
    "```",
    "",
    "Keep this text until OpenMouse reports that the original profile and mode were restored.",
  ].join("\n");
}

export function formatProfileWriteProbeReportMarkdown(report: ProfileContentWriteProbeReport): string {
  const verdict = report.ok ? "PASSED" : "FAILED";
  return [
    `## OpenMouse profile-write verification — ${verdict}`,
    "",
    ...report.steps.flatMap((step) => [
      `### ${step.setting}`,
      "",
      `- Intended value: ${step.intended}`,
      `- Stored exactly: ${step.storedExactly}`,
      `- Live value confirmed: ${step.liveConfirmed === null ? "not applicable" : step.liveConfirmed}`,
      `- Original restored: ${step.restored}`,
      ...(step.error ? [`- Error: ${step.error}`] : []),
      "",
    ]),
    `- Final profile restored: ${report.restored}`,
    `- Original mode restored: ${report.modeRestored}`,
    "",
    formatProfileWriteProbeBackupMarkdown(report.backup),
  ].join("\n");
}

/** Markdown verification bundle suitable for an issue or a test fixture. */
export function formatProfileVerificationMarkdown(capture: ProfileVerificationExport): string {
  const { info } = capture;
  const capabilitySection = [
    ...capabilityLines("DPI", capture.dpiCapabilities, "DPI"),
    ...capabilityLines("Report rate", capture.reportRateCapabilities, "Hz"),
  ];
  const sections = [
    "## OpenMouse profile-format verification",
    "",
    `- Device: ${capture.device ?? "unknown"}`,
    `- Profile format: ${capture.profileFormat ?? info.profileFormatId}`,
    `- Memory model: ${info.memoryModelId}`,
    `- Reported profiles: ${info.profileCount}`,
    `- Sector geometry: ${info.sectorCount} × ${info.sectorSize} bytes`,
    `- Device mode: ${capture.mode} (${hexByte(capture.modeValue)})`,
    `- Current profile sector: ${hexWord(capture.currentSector)}`,
    `- Directory CRC: ${capture.directoryCrcValid ? "valid" : "INVALID"}`,
    `- Profile CRCs: ${capture.profiles.every((profile) => profile.crcValid) ? "all valid" : "ONE OR MORE INVALID"}`,
    "",
    "### Raw protocol replies",
    "",
    `- getInfo: \`${[...capture.infoReply].map((byte) => byte.toString(16).padStart(2, "0")).join(" ")}\``,
    `- getMode: \`${[...capture.modeReply].map((byte) => byte.toString(16).padStart(2, "0")).join(" ")}\``,
    `- getCurrentProfile: \`${[...capture.currentProfileReply].map((byte) => byte.toString(16).padStart(2, "0")).join(" ")}\``,
    ...(capabilitySection.length > 0 ? ["", "### Device capability replies", "", ...capabilitySection] : []),
    "",
    "### Directory sector 0",
    "",
    "```",
    hexBlock(capture.directory),
    "```",
  ];

  for (const profile of capture.profiles) {
    sections.push(
      "",
      `### Profile sector ${hexWord(profile.sector)}`,
      "",
      `- Enabled: ${profile.enabled}`,
      `- Current: ${profile.isCurrent}`,
      `- CRC: ${profile.crcValid ? "valid" : "INVALID"}`,
      "- Decoded by current OpenMouse layout:",
      "",
      "```json",
      JSON.stringify(profile.decoded, null, 2),
      "```",
      "",
      "```",
      hexBlock(profile.bytes),
      "```",
    );
  }

  sections.push(
    "",
    "This bundle was collected read-only. It includes the device-reported memory geometry, full directory, every listed profile sector, and checksums; no profile flash was written.",
  );
  return sections.join("\n");
}

/** Markdown, so a capture can be pasted straight into an issue. */
export function formatCaptureMarkdown(capture: CaptureExport): string {
  const changed = capture.diffs.filter((diff) => diff.changes.length > 0);
  const labels = capture.actions
    .map((id) => actionById(id)?.label ?? id)
    .sort();

  const sections = [
    "## OpenMouse profile capture",
    "",
    `- Device: ${capture.device ?? "unknown"}`,
    `- Profile format: ${capture.profileFormat ?? "not reported"}`,
    `- Changed: ${labels.length > 0 ? labels.join(", ") : "not stated"}`,
  ];

  if (capture.notes.trim().length > 0) {
    sections.push("", "### Notes", "", capture.notes.trim());
  }

  if (changed.length === 0) {
    sections.push(
      "",
      "### Result",
      "",
      capture.diffs.length === 0
        ? "No comparison was run."
        : "No profile bytes changed, so this setting is not stored in a profile.",
    );
    return sections.join("\n");
  }

  for (const diff of changed) {
    sections.push(
      "",
      `### Sector ${diff.sector} — ${diff.changes.length} byte(s) changed`,
      "",
      "| Offset | Before | After | Field |",
      "| --- | --- | --- | --- |",
      ...diff.changes.map((change) =>
        `| ${hexByte(change.offset)} | ${hexByte(change.before)} | ${hexByte(change.after)} | ${change.field ?? "unknown"} |`),
    );

    if (diff.unreproduced !== undefined) {
      sections.push(
        "",
        diff.unreproduced.length === 0
          ? "**Write path verified** — OpenMouse reproduces this change byte for byte."
          : `**Write path incomplete** — cannot reproduce ${diff.unreproduced.length} byte(s): `
            + diff.unreproduced.map(hexByte).join(", "),
      );
    }
  }

  // Raw bytes last: verbose, but they are what turns a report into a
  // regression test, and they let a maintainer re-derive the diff independently.
  const rawSectors = (capture.sectors ?? []).filter((entry) =>
    changed.some((diff) => diff.sector === entry.sector));
  if (rawSectors.length > 0) {
    sections.push("", "### Raw sectors");
    for (const entry of rawSectors) {
      sections.push(
        "",
        `<details><summary>Sector ${entry.sector}</summary>`,
        "",
        "Before:",
        "",
        "```",
        hexBlock(entry.before),
        "```",
        "",
        "After:",
        "",
        "```",
        hexBlock(entry.after),
        "```",
        "",
        "</details>",
      );
    }
  }

  return sections.join("\n");
}
