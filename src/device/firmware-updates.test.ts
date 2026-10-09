import assert from "node:assert/strict";
import test from "node:test";

import {
  compareVersions,
  currentFirmwareVersion,
  describeFirmwareEntities,
  extractVersionToken,
  getDfuInfo,
  matchManifestEntry,
  type FirmwareDeviceRef,
  type FirmwareManifest,
} from "./firmware-updates.ts";

const manifest: FirmwareManifest = {
  manifestVersion: 1,
  updatedAt: "2026-10-01T00:00:00.000Z",
  source: "test",
  devices: [
    {
      id: "logitech-pro-x-superlight-2",
      brand: "Logitech",
      nameMatch: ["PRO X SUPERLIGHT 2"],
      latestVersion: "27.1.2",
      downloadUrl: "https://www.logitechg.com/software/ghub",
    },
    {
      id: "logitech-g502-x",
      brand: "Logitech",
      nameMatch: ["G502 X"],
      latestVersion: "4.2.1",
      required: true,
    },
  ],
};

function device(overrides: Partial<FirmwareDeviceRef> = {}): FirmwareDeviceRef {
  return {
    brand: "Logitech",
    name: "PRO X SUPERLIGHT 2",
    modelId: null,
    firmware: ["Mouse v27.0.0"],
    interfaceId: null,
    ...overrides,
  };
}

test("extractVersionToken finds the dotted token inside driver strings", () => {
  assert.equal(extractVersionToken("Mouse v27.1.2"), "27.1.2");
  assert.equal(extractVersionToken("MPM 39.00.B0004"), "39.00");
  assert.equal(extractVersionToken("  "), null);
});

test("compareVersions compares numerically, not lexicographically", () => {
  assert.equal(compareVersions("27.0.0", "27.1.2"), -1);
  assert.equal(compareVersions("27.1.2", "27.1.2"), 0);
  assert.equal(compareVersions("9.10.0", "9.9.0"), 1);
  assert.equal(compareVersions("4.2", "4.2.1"), -1);
});

test("currentFirmwareVersion uses the first readable entry", () => {
  assert.equal(currentFirmwareVersion(["Mouse v27.0.0", "BL2 73.00.B0011"]), "27.0.0");
  assert.equal(currentFirmwareVersion([]), null);
});

test("matchManifestEntry matches on brand plus name substring", () => {
  assert.equal(matchManifestEntry(device(), manifest)?.id, "logitech-pro-x-superlight-2");
  assert.equal(matchManifestEntry(device({ brand: "Razer" }), manifest), null);
  assert.equal(matchManifestEntry(device({ name: "Unknown Mouse 123" }), manifest), null);
});

test("getDfuInfo reports available only when behind latest", () => {
  const behind = getDfuInfo(device(), manifest);
  assert.equal(behind?.dfuAvailable, true);
  assert.equal(behind?.dfuRequired, false);
  assert.equal(behind?.latestVersion, "27.1.2");

  const current = getDfuInfo(device({ firmware: ["Mouse v27.1.2"] }), manifest);
  assert.equal(current?.dfuAvailable, false);

  const required = getDfuInfo(
    device({ name: "G502 X", firmware: ["v1.0.0"] }),
    manifest,
  );
  assert.equal(required?.dfuAvailable, true);
  assert.equal(required?.dfuRequired, true);
});

test("getDfuInfo is null when unknown (no entry or no version)", () => {
  assert.equal(getDfuInfo(device({ name: "Unknown Mouse 123" }), manifest), null);
  assert.equal(getDfuInfo(device({ firmware: [] }), manifest), null);
});

const entityManifest: FirmwareManifest = {
  manifestVersion: 1,
  updatedAt: "2026-10-01T00:00:00.000Z",
  source: "test",
  devices: [
    {
      id: "logitech-g502-mpm",
      brand: "Logitech",
      nameMatch: ["G502"],
      firmwareName: "MPM",
      latestVersion: "39.00",
    },
  ],
};

test("entity entries compare only their own firmware element", () => {
  const behind = getDfuInfo(
    device({ name: "G502 X", firmware: ["OTHER 50.00", "MPM 38.00"] }),
    entityManifest,
  );
  assert.equal(behind?.dfuAvailable, true);
  assert.equal(behind?.entityName, "MPM");
  assert.equal(behind?.currentVersion, "38.00");

  const current = getDfuInfo(
    device({ name: "G502 X", firmware: ["OTHER 50.00", "MPM 39.00"] }),
    entityManifest,
  );
  assert.equal(current?.dfuAvailable, false);
  assert.equal(current?.currentVersion, "39.00");
});

test("entity entries never act as device-level fallbacks", () => {
  assert.equal(matchManifestEntry(device({ name: "G502 X" }), entityManifest), null);
});

test("describeFirmwareEntities reports each element separately", () => {
  const infos = describeFirmwareEntities(
    device({ name: "G502 X", firmware: ["OTHER 50.00", "MPM 38.00"] }),
    entityManifest,
  );
  assert.equal(infos.length, 2);
  assert.equal(infos[0]?.available, null);
  assert.equal(infos[0]?.entryId, null);
  assert.equal(infos[1]?.available, true);
  assert.equal(infos[1]?.latestVersion, "39.00");
});

test("interfaceId entries match exactly, names do not matter", () => {
  const m = {
    manifestVersion: 3,
    updatedAt: "2026-10-09T00:00:00.000Z",
    source: "test",
    devices: [
      { id: "g502@25.1.18", interfaceIds: ["046d_c094"], latestVersion: "25.1.18" },
    ],
  } as unknown as import("./firmware-updates.ts").FirmwareManifest;
  const hit = getDfuInfo(device({ name: "Totally Different Name", firmware: ["FW 24.0.0"], interfaceId: "046d_c094" }), m);
  assert.equal(hit?.dfuAvailable, true);
  assert.equal(hit?.latestVersion, "25.1.18");
  const miss = getDfuInfo(device({ name: "G502 X", firmware: ["FW 24.0.0"], interfaceId: "046d_ffff" }), m);
  assert.equal(miss, null);
});

test("matcherless entries never match anything", () => {
  const m = {
    manifestVersion: 3,
    updatedAt: "2026-10-09T00:00:00.000Z",
    source: "test",
    devices: [{ id: "empty", latestVersion: "1.0.0" }],
  } as unknown as import("./firmware-updates.ts").FirmwareManifest;
  assert.equal(getDfuInfo(device(), m), null);
});

test("receiver entries match by interfaceId without brand or names", () => {
  const m = {
    manifestVersion: 3,
    updatedAt: "2026-10-09T00:00:00.000Z",
    source: "test",
    devices: [
      { id: "recv", interfaceIds: ["046d_c54d", "046d_ab24"], latestVersion: "14.4.20", required: true },
    ],
  } as unknown as import("./firmware-updates.ts").FirmwareManifest;
  const ref = { brand: "Logitech", name: "PRO X SUPERLIGHT 2c", firmware: ["Receiver 14.3.19"], interfaceId: "046d_c54d" };
  const hit = getDfuInfo(ref, m);
  assert.equal(hit?.dfuAvailable, true);
  assert.equal(hit?.dfuRequired, true);
  const current = getDfuInfo({ ...ref, firmware: ["Receiver 14.4.20"] }, m);
  assert.equal(current?.dfuAvailable, false);
});
