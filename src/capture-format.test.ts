import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTURE_ACTIONS,
  actionById,
  diffSectors,
  formatCaptureMarkdown,
  formatProfileVerificationMarkdown,
  type CaptureExport,
} from "./capture-format.ts";

function capture(overrides: Partial<CaptureExport> = {}): CaptureExport {
  return {
    device: "PRO X 2",
    profileFormat: "7 · unnamed (v6 + bunny hopping)",
    actions: [],
    notes: "",
    diffs: [],
    ...overrides,
  };
}

test("every action has a unique id and colour", () => {
  const ids = new Set(CAPTURE_ACTIONS.map((action) => action.id));
  const colors = new Set(CAPTURE_ACTIONS.map((action) => action.color));
  assert.equal(ids.size, CAPTURE_ACTIONS.length, "ids must be unique");
  assert.equal(colors.size, CAPTURE_ACTIONS.length, "colours must be distinguishable");
});

test("actions resolve by id", () => {
  assert.equal(actionById("polling")?.label, "Polling rate");
  assert.equal(actionById("nope"), undefined);
});

test("a sector diff reports only changed bytes, with their field", () => {
  const before = new Uint8Array([0x06, 0x03, 0x00]);
  const after = new Uint8Array([0x03, 0x03, 0x00]);
  const changes = diffSectors(before, after, (offset) => (offset === 0 ? "report_rate_wireless +0" : null));

  assert.deepEqual(changes, [
    { offset: 0, before: 0x06, after: 0x03, field: "report_rate_wireless +0" },
  ]);
});

test("identical sectors produce no diff", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(diffSectors(bytes, bytes.slice(), () => null), []);
});

/** The real capture that confirmed the report-rate encoding: 8000 Hz -> 1000 Hz. */
test("exports a confirmed change with its actions", () => {
  const markdown = formatCaptureMarkdown(capture({
    actions: ["polling"],
    diffs: [{
      sector: 3,
      changes: [
        { offset: 0x00, before: 0x06, after: 0x03, field: "report_rate_wireless +0" },
        { offset: 0xfd, before: 0x6e, after: 0x20, field: "checksum" },
        { offset: 0xfe, before: 0x7c, after: 0xc7, field: "checksum" },
      ],
    }],
  }));

  assert.match(markdown, /- Changed: Polling rate/);
  assert.match(markdown, /### Sector 3 — 3 byte\(s\) changed/);
  assert.match(markdown, /\| 0x00 \| 0x06 \| 0x03 \| report_rate_wireless \+0 \|/);
  assert.match(markdown, /\| 0xfd \| 0x6e \| 0x20 \| checksum \|/);
});

test("multiple actions are listed together", () => {
  const markdown = formatCaptureMarkdown(capture({ actions: ["polling", "dpi"] }));
  assert.match(markdown, /- Changed: DPI, Polling rate/);
});

test("an empty comparison says so rather than implying nothing changed", () => {
  assert.match(formatCaptureMarkdown(capture()), /No comparison was run/);
  assert.match(
    formatCaptureMarkdown(capture({ diffs: [{ sector: 3, changes: [] }] })),
    /not stored in a profile/,
  );
});

test("raw sectors are exported for changed sectors so a fixture can be built", () => {
  const markdown = formatCaptureMarkdown(capture({
    diffs: [{ sector: 3, changes: [{ offset: 0, before: 6, after: 3, field: null }], unreproduced: [] }],
    sectors: [
      { sector: 3, before: new Uint8Array([0x06, 0x03]), after: new Uint8Array([0x03, 0x03]) },
      { sector: 4, before: new Uint8Array([0x01]), after: new Uint8Array([0x01]) },
    ],
  }));

  assert.match(markdown, /### Raw sectors/);
  assert.match(markdown, /<details><summary>Sector 3<\/summary>/);
  assert.match(markdown, /06 03/);
  assert.doesNotMatch(markdown, /Sector 4/, "unchanged sectors are noise");
  assert.match(markdown, /\*\*Write path verified\*\*/);
});

test("notes are included only when present", () => {
  assert.doesNotMatch(formatCaptureMarkdown(capture()), /### Notes/);
  assert.match(formatCaptureMarkdown(capture({ notes: "8000 -> 1000" })), /### Notes\n\n8000 -> 1000/);
});

test("profile verification exports geometry, raw replies, directory and every format", () => {
  const markdown = formatProfileVerificationMarkdown({
    device: "PRO X 2 Superstrike",
    profileFormat: "8 · FORMAT 8",
    info: { memoryModelId: 2, profileFormatId: 8, profileCount: 2, sectorCount: 4, sectorSize: 8 },
    infoReply: new Uint8Array([0x11, 0xff, 0x00, 0x02, 0x08]),
    mode: "Onboard",
    modeValue: 1,
    modeReply: new Uint8Array([0x11, 0xff, 0x20, 0x01]),
    currentSector: 2,
    currentProfileReply: new Uint8Array([0x11, 0xff, 0x40, 0x00, 0x02]),
    directory: new Uint8Array([0x00, 0x02, 0x01, 0x00, 0xff, 0xff, 0xff, 0xff]),
    directoryCrcValid: true,
    dpiCapabilities: {
      featureId: 0x2201,
      featureIndex: 0x0d,
      featureVersion: 1,
      kind: "legacy",
      replies: [
        { name: "getFeature", bytes: new Uint8Array([0x11, 0xff, 0x00, 0x0d, 0x00, 0x00, 0x01]) },
        { name: "getSensorDpiList", bytes: new Uint8Array([0x11, 0xff, 0x10, 0x00, 0x64, 0xe0, 0x32, 0x0c, 0x80]) },
      ],
      decodedValues: [100, 150, 200],
      error: null,
    },
    reportRateCapabilities: {
      featureId: 0x8060,
      featureIndex: 0x0e,
      featureVersion: 0,
      kind: "legacy",
      replies: [{ name: "getReportRateList", bytes: new Uint8Array([0x11, 0xff, 0x00, 0x8b]) }],
      decodedValues: [125, 250, 500, 1000],
      error: null,
    },
    profiles: [{
      sector: 2,
      enabled: true,
      isCurrent: true,
      crcValid: true,
      decoded: { name: "Gaming", reportRateWireless: 8000 },
      bytes: new Uint8Array([0x06, 0x03, 0, 0, 0, 0, 0xaa, 0xbb]),
    }],
  });

  assert.match(markdown, /Profile format: 8 · FORMAT 8/);
  assert.match(markdown, /Sector geometry: 4 × 8 bytes/);
  assert.match(markdown, /### Directory sector 0/);
  assert.match(markdown, /### Device capability replies/);
  assert.match(markdown, /DPI values: 100 DPI, 150 DPI, 200 DPI/);
  assert.match(markdown, /DPI getSensorDpiList: `11 ff 10 00 64 e0 32 0c 80`/);
  assert.match(markdown, /Report rate values: 125 Hz, 250 Hz, 500 Hz, 1000 Hz/);
  assert.match(markdown, /Report rate getReportRateList: `11 ff 00 8b`/);
  assert.match(markdown, /### Profile sector 0x0002/);
  assert.match(markdown, /"reportRateWireless": 8000/);
  assert.match(markdown, /no profile flash was written/);
});

test("verification formatting accepts every recovered profile format", () => {
  for (let profileFormatId = 1; profileFormatId <= 8; profileFormatId += 1) {
    const markdown = formatProfileVerificationMarkdown({
      device: "Logitech test mouse",
      profileFormat: `${profileFormatId} · test`,
      info: { memoryModelId: 1, profileFormatId, profileCount: 0, sectorCount: 1, sectorSize: 4 },
      infoReply: new Uint8Array([0, 0, 0, 1, profileFormatId]),
      mode: "Host",
      modeValue: 2,
      modeReply: new Uint8Array([0, 0, 0, 2]),
      currentSector: 0,
      currentProfileReply: new Uint8Array([0, 0, 0, 0, 0]),
      directory: new Uint8Array([0xff, 0xff, 0, 0]),
      directoryCrcValid: true,
      profiles: [],
    });
    assert.match(markdown, new RegExp(`Profile format: ${profileFormatId} · test`));
  }
});
