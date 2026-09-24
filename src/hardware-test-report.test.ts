import assert from "node:assert/strict";
import test from "node:test";

import type { ControlSnapshot } from "./device/types.ts";
import { brandChecks } from "./hardware-brand-checks.ts";
import { crosscheckSupportedDevices } from "./supported-devices-crosscheck.ts";
import {
  automaticChecks,
  buildDiscordEmbed,
  deviceInfoFromSnapshot,
  flashWriteResult,
  formatHexId,
  pickFlashDpiTarget,
  pickFlashLiftOffTarget,
  pickFlashPollRateTarget,
  pollingSampleResult,
  verdictFor,
  type HardwareTestReport,
  type HardwareTestResult,
} from "./hardware-test-report.ts";

function snapshotFor(partial: Partial<ControlSnapshot>): ControlSnapshot {
  return {
    status: null,
    devices: [],
    // The runner only reads status/devices from the snapshot; the rest of the
    // shape is irrelevant here.
    ...partial,
  } as unknown as ControlSnapshot;
}

function mouseStatus(overrides: Record<string, unknown> = {}): ControlSnapshot["status"] {
  return {
    brand: "Acme",
    name: "MaxPoint One",
    ui: { family: "acme-max" },
    batteryPercent: 62,
    batteryState: "Discharging",
    dpi: 1600,
    pollingRateHz: 1000,
    firmware: ["v1.2.3"],
    liftOffDistance: "Low",
    connectionType: "Wireless",
    deviceMode: "Onboard",
    supportedPollingRates: [125, 250, 500, 1000],
    ...overrides,
  } as ControlSnapshot["status"];
}

test("deviceInfoFromSnapshot extracts device identity and status rows", () => {
  const snapshot = snapshotFor({
    status: mouseStatus({
      signalStrength: 74,
      atkReceiver: { online: true, status: 3, rfId: "A0B1", pairingStatus: 2, pairingSecondsRemaining: null },
    }),
    devices: [
      { index: 0, name: "MaxPoint One", detail: "", selected: true, vendorId: 0x1234, productId: 0x5678, kind: "mouse", transport: "webhid" },
    ],
  });
  const info = deviceInfoFromSnapshot(snapshot);
  assert.equal(info.present, true);
  assert.equal(info.brand, "Acme");
  assert.equal(info.name, "MaxPoint One");
  assert.equal(info.vendorId, 0x1234);
  assert.equal(info.productId, 0x5678);
  assert.equal(info.transport, "webhid");
  assert.equal(info.pollingRateHz, 1000);
  assert.deepEqual(info.firmware, ["v1.2.3"]);
  assert.equal(info.driverFamily, "acme-max");
  assert.equal(info.signalStrength, 74);
  assert.equal(info.receiverOnline, true);
  assert.equal(info.receiverRfId, "A0B1");
  assert.equal(info.pairingInProgress, false);
});

test("deviceInfoFromSnapshot reports no device when nothing is connected", () => {
  const info = deviceInfoFromSnapshot(snapshotFor({ devices: [] }));
  assert.equal(info.present, false);
  assert.equal(info.vendorId, null);
  assert.equal(info.receiverOnline, null);
});

test("formatHexId pads to four hex digits and uppercases", () => {
  assert.equal(formatHexId(0xc07d), "0xC07D");
  assert.equal(formatHexId(0x5), "0x0005");
});

test("automatic checks fail connection and skip the rest without a device", () => {
  const results = automaticChecks(deviceInfoFromSnapshot(snapshotFor({ devices: [] })));
  assert.equal(results[0]?.status, "fail");
  assert.equal(results[0]?.key, "connection");
  for (const result of results.slice(1)) assert.equal(result.status, "skip");
});

test("automatic checks pass for a healthy connected device", () => {
  const results = automaticChecks(deviceInfoFromSnapshot(snapshotFor({ status: mouseStatus(), devices: [] })));
  for (const result of results) {
    assert.equal(result.status, "pass", `${result.label} should pass`);
  }
});

test("automatic checks include the certification checks on a healthy device", () => {
  const results = automaticChecks(deviceInfoFromSnapshot(snapshotFor({ status: mouseStatus(), devices: [] })));
  const keys = new Set(results.map((result) => result.key));
  for (const key of ["interface", "identity", "link", "flashRead", "connection", "dpi", "pollingRead"]) {
    assert.ok(keys.has(key), `expected a "${key}" check`);
  }
  const interfaceCheck = results.find((result) => result.key === "interface");
  assert.equal(interfaceCheck?.status, "pass");
  const flash = results.find((result) => result.key === "flashRead");
  assert.equal(flash?.status, "pass");
  assert.match(flash?.detail ?? "", /decoded fields are in range/);
});

test("the wireless-link check is skipped on a wired connection", () => {
  const results = automaticChecks(
    deviceInfoFromSnapshot(snapshotFor({ status: mouseStatus({ connectionType: "Wired" }), devices: [] })),
  );
  const link = results.find((result) => result.key === "link");
  assert.equal(link?.status, "skip");
});

test("the wireless-link check passes with the mouse online on the receiver", () => {
  const results = automaticChecks(
    deviceInfoFromSnapshot(
      snapshotFor({
        status: mouseStatus({ atkReceiver: { online: true, status: 3, rfId: "A0B1", pairingStatus: 2, pairingSecondsRemaining: null } }),
        devices: [],
      }),
    ),
  );
  const link = results.find((result) => result.key === "link");
  assert.equal(link?.status, "pass");
  assert.match(link?.detail ?? "", /online on the receiver/);
});

test("the wireless-link check fails while the receiver is mid-pairing", () => {
  const results = automaticChecks(
    deviceInfoFromSnapshot(
      snapshotFor({
        status: mouseStatus({ atkReceiver: { online: false, status: 5, rfId: "A0B1", pairingStatus: 1, pairingSecondsRemaining: 12 } }),
        devices: [],
      }),
    ),
  );
  const link = results.find((result) => result.key === "link");
  assert.equal(link?.status, "fail");
  assert.match(link?.detail ?? "", /mid-pairing/);
});

test("the wireless-link check fails when the receiver reports the mouse offline", () => {
  const results = automaticChecks(
    deviceInfoFromSnapshot(
      snapshotFor({
        status: mouseStatus({ atkReceiver: { online: false, status: 0, rfId: "A0B1", pairingStatus: 2, pairingSecondsRemaining: null } }),
        devices: [],
      }),
    ),
  );
  const link = results.find((result) => result.key === "link");
  assert.equal(link?.status, "fail");
  assert.match(link?.detail ?? "", /offline/);
});

test("automatic checks flag a polling rate outside the supported set", () => {
  const snapshot = snapshotFor({
    status: mouseStatus({ pollingRateHz: 333, supportedPollingRates: [125, 250, 500, 1000] }),
  });
  const results = automaticChecks(deviceInfoFromSnapshot(snapshot));
  const rate = results.find((result) => result.key === "pollingRead");
  assert.equal(rate?.status, "fail");
  assert.match(rate?.detail ?? "", /not in the supported set/);
});

test("flash read-back fails when a decoded field is out of range", () => {
  const results = automaticChecks(
    deviceInfoFromSnapshot(
      snapshotFor({ status: mouseStatus({ dpi: 999_999, dpiStages: [800, 16_000, 1_000_000] }), devices: [] }),
    ),
  );
  const flash = results.find((result) => result.key === "flashRead");
  assert.equal(flash?.status, "fail");
  const stages = results.find((result) => result.key === "dpiStages");
  assert.equal(stages?.status, "fail");
});

test("verdict is fail for any failure, incomplete when aborted", () => {
  const failing: HardwareTestResult[] = [
    { key: "connection", label: "Device connected", status: "pass", detail: null },
    { key: "flashRead", label: "Flash / EEPROM read-back", status: "fail", detail: "bad" },
  ];
  assert.equal(verdictFor({ results: failing, incomplete: false }), "fail");
  assert.equal(verdictFor({ results: failing, incomplete: true }), "incomplete");
});

test("verdict requires every certification check to pass, including interactive", () => {
  const required: HardwareTestResult[] = [
    { key: "connection", label: "Device connected", status: "pass", detail: null },
    { key: "interface", label: "Control interface", status: "pass", detail: null },
    { key: "identity", label: "Device identity", status: "pass", detail: null },
    { key: "link", label: "Wireless link (receiver)", status: "pass", detail: null },
    { key: "flashRead", label: "Flash / EEPROM read-back", status: "pass", detail: null },
    { key: "flashWrite", label: "Flash write round-trip", status: "pass", detail: null },
    { key: "sampling", label: "Polling rate sampling", status: "pass", detail: null },
  ];
  assert.equal(verdictFor({ results: required, incomplete: false }), "pass");

  const samplingFailed = required.map((result) =>
    result.key === "sampling" ? { ...result, status: "fail" as const } : result,
  );
  assert.equal(verdictFor({ results: samplingFailed, incomplete: false }), "fail");

  const informationalOnly = required
    .filter((result) => !["connection", "interface", "identity", "link", "flashRead", "flashWrite"].includes(result.key))
    .map((result) => ({ ...result, key: `info-${result.key}` }));
  assert.equal(verdictFor({ results: informationalOnly, incomplete: false }), "fail");
});

test("verdict passes when not-applicable checks are skipped", () => {
  const results: HardwareTestResult[] = [
    { key: "connection", label: "Device connected", status: "pass", detail: null },
    { key: "interface", label: "Control interface", status: "pass", detail: null },
    { key: "identity", label: "Device identity", status: "pass", detail: null },
    { key: "link", label: "Wireless link (receiver)", status: "skip", detail: null },
    { key: "flashRead", label: "Flash / EEPROM read-back", status: "pass", detail: null },
    { key: "flashWrite", label: "Flash write round-trip", status: "skip", detail: "no alternate DPI value" },
    { key: "sampling", label: "Polling rate sampling", status: "pass", detail: null },
  ];
  assert.equal(verdictFor({ results, incomplete: false }), "pass");
});

test("pickFlashDpiTarget prefers a close alternate value and returns null when stuck", () => {
  assert.equal(pickFlashDpiTarget(800, [400, 800, 1600, 3200]), 1600);
  assert.equal(pickFlashDpiTarget(3200, [800, 1600, 3200]), 800);
  assert.equal(pickFlashDpiTarget(500, [125, 500, 1000]), 1000);
  assert.equal(pickFlashDpiTarget(800, [800]), null);
  assert.equal(pickFlashDpiTarget(null, [400, 800]), null);
  assert.equal(pickFlashDpiTarget(800, []), null);
});

test("pickFlashPollRateTarget prefers a doubling or halving of the current rate", () => {
  assert.equal(pickFlashPollRateTarget(1000, [125, 250, 500, 1000, 2000, 4000, 8000]), 2000);
  assert.equal(pickFlashPollRateTarget(4000, [125, 250, 500, 1000, 2000, 4000, 8000]), 8000);
  assert.equal(pickFlashPollRateTarget(125, [125, 1000]), 1000);
  assert.equal(pickFlashPollRateTarget(1000, [1000]), null);
  assert.equal(pickFlashPollRateTarget(null, [125, 1000]), null);
  assert.equal(pickFlashPollRateTarget(1000, []), null);
});

test("pickFlashLiftOffTarget prefers Medium, falling back to Low", () => {
  assert.equal(pickFlashLiftOffTarget("Low"), "Medium");
  assert.equal(pickFlashLiftOffTarget("High"), "Medium");
  assert.equal(pickFlashLiftOffTarget("Medium"), "Low");
  assert.equal(pickFlashLiftOffTarget(null), null);
});

test("flashWriteResult scores the round-trip legs — DPI, poll rate, lift-off", () => {
  const pass = flashWriteResult({
    roundTrips: [
      { setting: "DPI", current: "1600 DPI", target: "3200 DPI", status: "pass", detail: "wrote 3200 DPI → read back → restored 1600 DPI" },
      { setting: "Poll rate", current: "1000 Hz", target: "2000 Hz", status: "pass", detail: "wrote 2000 Hz → read back → restored 1000 Hz" },
      { setting: "Lift-off", current: "Low", target: "Medium", status: "pass", detail: "wrote Medium → read back → restored Low" },
    ],
  });
  assert.equal(pass.status, "pass");
  assert.match(pass.detail ?? "", /wrote 3200 DPI → read back → restored 1600 DPI/);
  assert.match(pass.detail ?? "", /wrote 2000 Hz → read back → restored 1000 Hz/);

  const readBackFailed = flashWriteResult({
    roundTrips: [
      { setting: "DPI", current: "1600 DPI", target: "3200 DPI", status: "pass", detail: "wrote 3200 DPI → read back → restored 1600 DPI" },
      { setting: "Poll rate", current: "1000 Hz", target: "2000 Hz", status: "fail", detail: "wrote 2000 Hz but read back something else — the write did not stick." },
    ],
  });
  assert.equal(readBackFailed.status, "fail");
  assert.match(readBackFailed.detail ?? "", /did not stick/);

  const skipped = flashWriteResult({ skipped: true, skippedReason: "no alternate DPI value" });
  assert.equal(skipped.status, "skip");
  assert.equal(skipped.detail, "no alternate DPI value");

  const nothingWritable = flashWriteResult({ roundTrips: [] });
  assert.equal(nothingWritable.status, "skip");

  const allSkipped = flashWriteResult({
    roundTrips: [
      { setting: "DPI", current: "—", target: "—", status: "skip", detail: "no alternate DPI value" },
      { setting: "Poll rate", current: "—", target: "—", status: "skip", detail: "no alternate polling rate" },
    ],
  });
  assert.equal(allSkipped.status, "skip");
});

test("pollingSampleResult passes when the measured rate holds up", () => {
  const pass = pollingSampleResult({
    events: 480,
    avgHz: 986,
    peakHz: 1000,
    stability: 95,
    reportedHz: 1000,
  });
  assert.equal(pass.status, "pass");
  assert.match(pass.detail ?? "", /avg 986 Hz/);
});

test("pollingSampleResult is inconclusive — not a fail — on dropout or mismatch", () => {
  const mismatch = pollingSampleResult({
    events: 480,
    avgHz: 320,
    peakHz: 480,
    stability: 40,
    reportedHz: 1000,
  });
  assert.equal(mismatch.status, "skip");
  assert.match(mismatch.detail ?? "", /dropout or rate mismatch detected/);
});

test("pollingSampleResult is inconclusive when too little movement was captured", () => {
  const few = pollingSampleResult({
    events: 12,
    avgHz: 900,
    peakHz: 1000,
    stability: 90,
    reportedHz: 1000,
  });
  assert.equal(few.status, "skip");
  assert.match(few.detail ?? "", /needed ≥ 40 samples/);
});

test("pollingSampleResult falls back to 1000 Hz when no reported rate exists", () => {
  const noReported = pollingSampleResult({ events: 200, avgHz: 900, peakHz: 950, stability: 90, reportedHz: null });
  assert.equal(noReported.status, "pass");
});

function makeReport(verdict: HardwareTestReport["verdict"], present = true): HardwareTestReport {
  return {
    device: {
      present,
      brand: present ? "Acme" : null,
      name: present ? "MaxPoint One" : null,
      vendorId: present ? 0x1234 : null,
      productId: present ? 0x5678 : null,
      productName: present ? "MaxPoint One" : null,
      transport: present ? "webhid" : null,
      connectionType: present ? "Wireless" : null,
      pollingRateHz: present ? 1000 : null,
      supportedPollingRates: present ? [1000] : null,
      dpi: present ? 1600 : null,
      dpiStages: null,
      activeDpiStage: null,
      batteryPercent: present ? 62 : null,
      batteryState: present ? "Discharging" : null,
      firmware: present ? ["v1.2.3"] : null,
      liftOffDistance: present ? "Low" : null,
      driverFamily: present ? "acme-max" : null,
      deviceMode: present ? "Onboard" : null,
      signalStrength: 74,
    },
    results: [
      { key: "connection", label: "Device connected", status: "pass", detail: "Connected through WebHID" },
      { key: "sampling", label: "Polling rate sampling", status: verdict, detail: verdict === "pass" ? "avg 1000 Hz" : null },
    ],
    verdict,
    durationMs: 12345,
    runAt: "2026-01-01T00:00:00.000Z",
    build: "test-build",
  };
}

test("buildDiscordEmbed carries verdict, identity, receiver and per-check fields", () => {
  const embed = buildDiscordEmbed(makeReport("pass", true)) as {
    title: string;
    description: string;
    color: number;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
  };
  assert.match(embed.title, /Acme MaxPoint One/);
  assert.equal(embed.color, 0x34d399);
  const names = embed.fields.map((field) => field.name);
  assert.ok(names.includes("Verdict"));
  assert.ok(names.includes("Identity"));
  assert.ok(names.includes("Device connected"));
  assert.match(embed.description, /2 passed, 0 failed/);
  const reported = embed.fields.find((field) => field.name === "Reported settings");
  assert.match(reported?.value ?? "", /signal 74%/);
});

test("buildDiscordEmbed maps verdicts to colors and handles missing device", () => {
  const failEmbed = buildDiscordEmbed(makeReport("fail", false)) as { title: string; color: number };
  assert.match(failEmbed.title, /no device/);
  assert.equal(failEmbed.color, 0xf0435e);

  const incomplete = buildDiscordEmbed(makeReport("incomplete", true)) as { color: number };
  assert.equal(incomplete.color, 0x94a3b8);
});

test("buildDiscordEmbed carries the supported-devices crosscheck when present", () => {
  const report = makeReport("pass", true);
  report.supportedPage = {
    listed: true,
    status: "likely",
    label: "Test Needed",
    matchedBy: "name",
    pageModel: "MaxPoint One",
    detail: "listed as Test Needed on the supported-devices page — this passing verification supports moving it to Supported.",
  };
  const embed = buildDiscordEmbed(report) as {
    fields: Array<{ name: string; value: string }>;
  };
  const field = embed.fields.find((entry) => entry.name === "Supported devices");
  assert.ok(field, "embed should carry a Supported devices field");
  assert.match(field?.value ?? "", /Test Needed/);
  assert.match(field?.value ?? "", /supports moving it to Supported/);
});

test("buildDiscordEmbed omits the crosscheck field when the report has none", () => {
  const embed = buildDiscordEmbed(makeReport("pass", true)) as {
    fields: Array<{ name: string }>;
  };
  assert.ok(!embed.fields.some((field) => field.name === "Supported devices"));
});

function fullSuiteReport(): HardwareTestReport {
  const device = deviceInfoFromSnapshot(
    snapshotFor({
      status: mouseStatus({
        brand: "ATK",
        name: "F1 Ultimate",
        dpiStages: [800, 1600, 3200],
        activeDpiStage: 1,
        signalStrength: 87,
        atkReceiver: { online: true, status: 3, rfId: "A0B1", pairingStatus: 2, pairingSecondsRemaining: null },
      }),
      devices: [
        { index: 0, name: "F1 Ultimate", detail: "", selected: true, vendorId: 0x41a5, productId: 0x8820, kind: "mouse", transport: "webhid" },
      ],
    }),
  );
  const results = [
    ...automaticChecks(device),
    ...brandChecks(device),
    { key: "sampling", label: "Polling rate sampling", status: "pass" as const, detail: "avg 986 Hz · peak 1000 Hz · stability 95% · 2408 samples" },
    flashWriteResult({
      roundTrips: [
        { setting: "DPI", current: "1600 DPI", target: "3200 DPI", status: "pass", detail: "wrote 3200 DPI → read back → restored 1600 DPI" },
        { setting: "Poll rate", current: "1000 Hz", target: "2000 Hz", status: "pass", detail: "wrote 2000 Hz → read back → restored 1000 Hz" },
        { setting: "Lift-off", current: "Low", target: "Medium", status: "pass", detail: "wrote Medium → read back → restored Low" },
      ],
    }),
  ];
  return {
    device,
    results,
    verdict: "pass",
    durationMs: 21_478,
    runAt: "2026-09-24T00:00:00.000Z",
    build: "2.0.9-beta.123",
    supportedPage: crosscheckSupportedDevices(device, "pass"),
  };
}

test("the full-suite Discord embed fits Discord's limit budget", () => {
  const embed = buildDiscordEmbed(fullSuiteReport()) as {
    title: string;
    description: string;
    footer: { text: string };
    fields: Array<{ name: string; value: string }>;
  };

  assert.ok(embed.fields.length <= 25, `expected ≤ 25 fields, got ${embed.fields.length}`);
  assert.ok(embed.title.length <= 256, `title too long: ${embed.title.length}`);
  assert.ok(embed.description.length <= 4096, `description too long: ${embed.description.length}`);
  for (const field of embed.fields) {
    assert.ok(field.name.length <= 256, `field name too long: ${field.name}`);
    assert.ok(field.value.length <= 1024, `field value too long: ${field.name}`);
  }

  // Discord's per-embed character budget is 6000 across every text part.
  const total =
    embed.title.length +
    embed.description.length +
    embed.footer.text.length +
    embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  assert.ok(total <= 6000, `embed is ${total} characters — over Discord's 6000 budget`);
});