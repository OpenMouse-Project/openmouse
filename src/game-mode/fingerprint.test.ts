import assert from "node:assert/strict";
import test from "node:test";

import { buildFingerprint } from "./fingerprint.ts";

function collection(overrides: Partial<HIDCollectionInfo>): HIDCollectionInfo {
  return {
    usagePage: 0,
    usage: 0,
    inputReports: [],
    outputReports: [],
    featureReports: [],
    children: [],
    ...overrides,
  };
}

test("fingerprints a single-collection device by usage and report id", () => {
  const device = {
    collections: [
      collection({
        usagePage: 0x01,
        usage: 0x02,
        featureReports: [{ reportId: 0, items: [{ reportSize: 8, reportCount: 90 }] }],
      }),
    ],
  } as unknown as HIDDevice;

  const fingerprint = buildFingerprint(device);

  assert.deepEqual(fingerprint.usages, [(0x01 << 16) | 0x02]);
  assert.deepEqual(fingerprint.reports, [{ kind: "feature", reportId: 0, length: 91 }]);
});

test("nested child collections contribute usages and reports too", () => {
  const device = {
    collections: [
      collection({
        usagePage: 0xff00,
        usage: 0x01,
        outputReports: [{ reportId: 4, items: [{ reportSize: 8, reportCount: 63 }] }],
        children: [
          collection({
            usagePage: 0xff00,
            usage: 0x02,
            inputReports: [{ reportId: 5, items: [{ reportSize: 8, reportCount: 62 }] }],
          }),
        ],
      }),
    ],
  } as unknown as HIDDevice;

  const fingerprint = buildFingerprint(device);

  const expectedUsages = [((0xff00 << 16) | 0x01) >>> 0, ((0xff00 << 16) | 0x02) >>> 0];
  assert.deepEqual(fingerprint.usages.sort((a, b) => a - b), expectedUsages.sort((a, b) => a - b));
  assert.equal(fingerprint.reports.length, 2);
  assert.ok(fingerprint.reports.some((r) => r.kind === "output" && r.reportId === 4));
  assert.ok(fingerprint.reports.some((r) => r.kind === "input" && r.reportId === 5));
});

test("a duplicate (kind, reportId) pair across collections is only counted once", () => {
  const report = { reportId: 0, items: [{ reportSize: 8, reportCount: 8 }] };
  const device = {
    collections: [
      collection({ usagePage: 1, usage: 1, featureReports: [report] }),
      collection({ usagePage: 1, usage: 2, featureReports: [report] }),
    ],
  } as unknown as HIDDevice;

  const fingerprint = buildFingerprint(device);

  assert.equal(fingerprint.reports.length, 1);
});
