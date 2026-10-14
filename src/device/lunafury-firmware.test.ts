import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { describeFirmwareEntities, getDfuInfo, type FirmwareDeviceRef, type FirmwareManifest } from "./firmware-updates.ts";

const published = JSON.parse(readFileSync(new URL("../../public/firmware-manifest.json", import.meta.url), "utf8")) as FirmwareManifest;
const extra = JSON.parse(readFileSync(new URL("../../scripts/firmware-manifest.extra.json", import.meta.url), "utf8")) as Pick<FirmwareManifest, "devices">;
const models = [
  { model: "LUNA33", id: "luna33", cable: "373e_0032", receiver: "373e_0033", latest: "25.0", older: "24.0", newer: "26.0" },
  { model: "TYPE33", id: "type33", cable: "373e_0054", receiver: "373e_0084", latest: "1.47", older: "1.46", newer: "1.48" },
] as const;

test("published LunaFury entries match their maintained source", () => {
  const entries = (manifest: Pick<FirmwareManifest, "devices">) => manifest.devices
    .filter(entry => entry.brand === "LunaFury")
    .sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(entries(published).length, 4);
  assert.deepEqual(entries(published), entries(extra));
});

for (const model of models) {
  const ref = (interfaceId: string, mouse: string = model.latest, dongle: string = model.latest): FirmwareDeviceRef => ({
    brand: "LunaFury", name: `LunaFury ${model.model} EL`, interfaceId,
    firmware: [`Mouse ${mouse}`, `Dongle ${dongle}`],
  });

  test(`${model.model} firmware entries pin exact runtime IDs and entities`, () => {
    const mouse = published.devices.find(entry => entry.id === `lunafury-${model.id}-mouse`)!;
    const dongle = published.devices.find(entry => entry.id === `lunafury-${model.id}-dongle`)!;
    assert.deepEqual(mouse.interfaceIds, [model.cable, model.receiver]);
    assert.deepEqual(dongle.interfaceIds, [model.receiver]);
    assert.equal(mouse.firmwareName, "Mouse");
    assert.equal(dongle.firmwareName, "Dongle");
    for (const entry of [mouse, dongle]) {
      assert.equal(entry.latestVersion, model.latest);
      assert.equal(entry.downloadUrl, "https://mouse.lunafury.games/");
      assert.equal(entry.required, false);
      assert.equal(entry.nameMatch, undefined);
    }
  });

  test(`${model.model} cable and receiver compare only the entities they expose`, () => {
    for (const interfaceId of [model.cable, model.receiver]) {
      const device = { ...ref(interfaceId), name: "Different product label" };
      const info = describeFirmwareEntities(device, published);
      assert.equal(info[0]?.entryId, `lunafury-${model.id}-mouse`);
      assert.equal(info[0]?.available, false);
      assert.equal(info[1]?.entryId, interfaceId === model.receiver ? `lunafury-${model.id}-dongle` : null);
      assert.equal(info[1]?.available, interfaceId === model.receiver ? false : null);
      assert.equal(getDfuInfo(device, published)?.latestVersion, model.latest);
    }
    assert.equal(getDfuInfo({ ...ref(model.cable), firmware: [`Dongle ${model.older}`] }, published), null);
  });

  test(`${model.model} mouse and receiver updates remain independent`, () => {
    const mouse = getDfuInfo(ref(model.receiver, model.older, model.newer), published);
    assert.equal(mouse?.dfuAvailable, true);
    assert.equal(mouse?.entityName, "Mouse");
    assert.equal(mouse?.currentVersion, model.older);

    const dongle = getDfuInfo(ref(model.receiver, model.newer, model.older), published);
    assert.equal(dongle?.dfuAvailable, true);
    assert.equal(dongle?.entityName, "Dongle");
    assert.equal(dongle?.currentVersion, model.older);
  });

  test(`${model.model} current and newer internal firmware never prompt a downgrade`, () => {
    for (const version of [model.latest, model.newer]) {
      for (const interfaceId of [model.cable, model.receiver]) {
        const info = getDfuInfo(ref(interfaceId, version, version), published);
        assert.equal(info?.dfuAvailable, false);
        assert.equal(info?.dfuRequired, false);
      }
    }
  });

  test(`${model.model} names cannot match another model, bootloader or foreign VID`, () => {
    const ownManifest = { ...published, devices: published.devices.filter(entry => entry.id.startsWith(`lunafury-${model.id}-`)) };
    const other = models.find(entry => entry.model !== model.model)!;
    for (const interfaceId of [other.cable, other.receiver, "373e_b032", "373e_b033", "373e_b054", "373e_b084", "373e_ffff", "046d_0033", ""]) {
      assert.equal(getDfuInfo(ref(interfaceId, model.older, model.older), ownManifest), null, interfaceId);
    }
  });

  test(`${model.model} missing firmware readings stay unknown`, () => {
    const device = { ...ref(model.receiver), firmware: ["Mouse firmware unavailable", "Dongle firmware unavailable"] };
    assert.equal(getDfuInfo(device, published), null);
    assert.deepEqual(describeFirmwareEntities(device, published).map(info => info.available), [null, null]);
    assert.equal(getDfuInfo({ ...device, firmware: [] }, published), null);
  });
}
