import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createViaLayoutFile, viaBackupFromLayoutFile, viaLayoutFileName, hexToViaColor, viaColorToHex, loadViaDefinition, viaDefinitionUrl, createViaBackup, parseViaBackup, viaBackupFileName, viaBackupProblem, type ViaWorkspace, ViaKeyboardClient } from "./via-keyboard.ts";
import { parseViaDefinition } from "@openmouse/keyboard-protocol/via";
import { type ViaHidClient } from "@openmouse/keyboard-protocol/drivers/via/hid";
import { createKeyboardClient, createSupportedClient, listLogicalDevices } from "./device-clients.ts";
import { HID_FILTERS } from "./hid-filters.ts";

describe("via-color", () => {
  test("VIA hue and saturation map to the colour picker's hex", () => {
    assert.equal(viaColorToHex(0, 255), "#ff0000");
    assert.equal(viaColorToHex(85, 255), "#00ff00");
    assert.equal(viaColorToHex(170, 255), "#0000ff");
    assert.equal(viaColorToHex(0, 0), "#ffffff");
    assert.equal(viaColorToHex(999, -5), "#ffffff");
  });

  test("hex converts back to hue and saturation and round-trips closely", () => {
    assert.deepEqual(hexToViaColor("#ff0000"), { hue: 0, saturation: 255 });
    assert.deepEqual(hexToViaColor("#ffffff"), { hue: 0, saturation: 0 });
    assert.deepEqual(hexToViaColor("#000000"), { hue: 0, saturation: 0 });
    for (const [hue, saturation] of [[30, 200], [120, 255], [200, 128], [250, 90]] as const) {
      const back = hexToViaColor(viaColorToHex(hue, saturation));
      assert.ok(Math.abs(back.hue - hue) <= 2 && Math.abs(back.saturation - saturation) <= 2, `${hue},${saturation} -> ${back.hue},${back.saturation}`);
    }
    assert.deepEqual(hexToViaColor("not a colour"), { hue: 0, saturation: 0 });
  });
});

describe("via-definition", () => {
  const KEY = { r: 0, rx: 0, ry: 0, d: false, h: 1, w: 1 };
  const DEFINITION = JSON.stringify({
    name: "Test Board",
    vendorProductId: 0x74700002,
    firmwareVersion: 0,
    menus: [],
    keycodes: [],
    matrix: { rows: 1, cols: 2 },
    layouts: { width: 2, height: 1, keys: [{ row: 0, col: 0, x: 0, y: 0, ...KEY }, { row: 0, col: 1, x: 1, y: 0, ...KEY }] },
  });

  function installStorage(): Map<string, string> {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) },
    });
    return data;
  }

  const answer = (body: string, status = 200): typeof fetch => async () => new Response(body, { status });
  const offline: typeof fetch = async () => { throw new TypeError("network down"); };

  test("a board with only a v2 file falls back to it, with lighting from its lighting name", async () => {
    installStorage();
    const v2 = JSON.stringify({ ...JSON.parse(DEFINITION), name: "Old Board", menus: undefined, lighting: "qmk_rgblight" });
    const seen: string[] = [];
    const byVersion: typeof fetch = async (input) => {
      seen.push(String(input));
      return String(input).includes("/v3/") ? new Response("<!doctype html>") : new Response(v2);
    };
    const definition = await loadViaDefinition(0x7470, 2, byVersion);
    assert.equal(definition?.name, "Old Board");
    assert.equal(definition?.menus.length, 1);
    assert.deepEqual(seen.map((url) => url.split("/definitions/")[1]), ["v3/1953497090.json", "v2/1953497090.json"]);
    const neither: typeof fetch = async () => new Response("<!doctype html>");
    assert.equal(await loadViaDefinition(0x7470, 3, neither), null);
    assert.equal(viaDefinitionUrl(0x7470, 2, "v2"), "https://usevia.app/definitions/v2/1953497090.json");
  });

  test("definitions are fetched by vendor and product id", () => {
    assert.equal(viaDefinitionUrl(0x7470, 2), "https://usevia.app/definitions/v3/1953497090.json");
  });

  test("a definition loads, is cached, and survives going offline", async () => {
    const storage = installStorage();
    const definition = await loadViaDefinition(0x7470, 2, answer(DEFINITION));
    assert.equal(definition?.name, "Test Board");
    assert.equal(storage.size, 1);
    assert.equal((await loadViaDefinition(0x7470, 2, offline))?.keys.length, 2);
  });

  test("a missing definition is null, including the HTML page usevia.app serves with status 200", async () => {
    installStorage();
    assert.equal(await loadViaDefinition(0x7470, 2, answer("<!doctype html><title>VIA</title>")), null);
    assert.equal(await loadViaDefinition(0x7470, 2, answer("", 404)), null);
  });

  test("an unreachable site with nothing cached is an error, and a bad reply is never cached", async () => {
    const storage = installStorage();
    await assert.rejects(loadViaDefinition(0x7470, 2, offline), /network down/);
    await assert.rejects(loadViaDefinition(0x7470, 2, answer("", 500)), /500/);
    await loadViaDefinition(0x7470, 2, answer("<html></html>"));
    assert.equal(storage.size, 0);
  });
});

describe("via-backup", () => {
  const KEY = { r: 0, rx: 0, ry: 0, d: false, h: 1, w: 1 };
  const DEFINITION = parseViaDefinition({
    name: "Test Board: 60%", vendorProductId: 0x74700002, firmwareVersion: 0, keycodes: [], menus: [],
    matrix: { rows: 1, cols: 2 },
    layouts: { labels: ["Split"], width: 2, height: 1, keys: [{ row: 0, col: 0, x: 0, y: 0, ...KEY }, { row: 0, col: 1, x: 1, y: 0, ...KEY }] },
  });
  const WORKSPACE: ViaWorkspace = {
    protocolVersion: 11, layerCount: 2, definition: DEFINITION, definitionError: null, layoutChoices: [1],
    keymap: [[4, 5], [6, 7]], menus: [], values: {}, macros: { count: 2, bufferSize: 16, macros: [[0x61], []] },
    encoders: [[[0x4e, 0x4b]], [[0x5222, 0x0306]]],
  };
  const DEVICE = { vendorId: 0x7470, productId: 2 };
  const NOW = new Date("2026-10-30T12:00:00Z");

  test("a backup captures the keymap, macros and layout choices and survives a round trip through JSON", () => {
    const backup = createViaBackup(WORKSPACE, DEVICE, NOW)!;
    assert.deepEqual(backup.layers, [[4, 5], [6, 7]]);
    assert.deepEqual(backup.macros, [[0x61], []]);
    assert.deepEqual(backup.layoutOptions, [1]);
    assert.equal(backup.savedAt, "2026-10-30T12:00:00.000Z");
    assert.deepEqual(parseViaBackup(JSON.stringify(backup)), backup);
    assert.equal(viaBackupFileName(backup), "test-board-60-keymap.json");
    assert.equal(createViaBackup({ ...WORKSPACE, keymap: null }, DEVICE), null);
    assert.equal(createViaBackup({ ...WORKSPACE, macros: null }, DEVICE, NOW)!.macros, null);
  });

  test("files that are not valid backups are refused", () => {
    const good = JSON.parse(JSON.stringify(createViaBackup(WORKSPACE, DEVICE, NOW)));
    assert.throws(() => parseViaBackup("not json"), /not json/);
    assert.throws(() => parseViaBackup("[]"), Error);
    assert.throws(() => parseViaBackup(JSON.stringify({ ...good, format: "other" })), /wrong format/);
    assert.throws(() => parseViaBackup(JSON.stringify({ ...good, layers: [[1]] })), /bad layer/);
    assert.throws(() => parseViaBackup(JSON.stringify({ ...good, layers: [[1, 70000]] })), /bad layer/);
    assert.throws(() => parseViaBackup(JSON.stringify({ ...good, macros: [[0]] })), /bad macros/);
    assert.throws(() => parseViaBackup(JSON.stringify({ ...good, matrix: { rows: 0, cols: 2 } })), /bad matrix/);
  });

  test("a backup is only restorable to the same board with the same matrix, layers and macro slots", () => {
    const backup = createViaBackup(WORKSPACE, DEVICE, NOW)!;
    assert.equal(viaBackupProblem(backup, WORKSPACE, DEVICE), null);
    assert.equal(viaBackupProblem(backup, WORKSPACE, { vendorId: 0x7470, productId: 3 }), "board");
    assert.equal(viaBackupProblem({ ...backup, matrix: { rows: 2, cols: 2 } }, WORKSPACE, DEVICE), "matrix");
    assert.equal(viaBackupProblem({ ...backup, layers: [[1, 2], [3, 4], [5, 6]] }, WORKSPACE, DEVICE), "layers");
    assert.equal(viaBackupProblem({ ...backup, macros: [[1]] }, WORKSPACE, DEVICE), "macros");
    assert.equal(viaBackupProblem({ ...backup, layers: [[1, 2]] }, WORKSPACE, DEVICE), null);
  });
});

describe("via-layout-file", () => {
  const KEY = { r: 0, rx: 0, ry: 0, d: false, h: 1, w: 1 };
  const DEFINITION = parseViaDefinition({
    name: "Test Board: 60%", vendorProductId: 0x74700002, firmwareVersion: 0, keycodes: [], menus: [],
    matrix: { rows: 1, cols: 2 },
    layouts: { labels: ["Split"], width: 2, height: 1, keys: [{ row: 0, col: 0, x: 0, y: 0, ...KEY }, { row: 0, col: 1, x: 1, y: 0, ...KEY }] },
  });
  const WORKSPACE: ViaWorkspace = {
    protocolVersion: 11, layerCount: 2, definition: DEFINITION, definitionError: null, layoutChoices: [0],
    keymap: [[0x04, 0x5221], [0x422c, 0x0306]], menus: [], values: {}, macros: { count: 1, bufferSize: 16, macros: [[0x61, 0x62]] },
    encoders: [[[0x4e, 0x4b]], [[0x5222, 0x0306]]],
  };
  const DEVICE = { vendorId: 0x7470, productId: 2 };

  test("a layout file uses VIA's names and imports back to the same keymap, macros and encoders", () => {
    const file = createViaLayoutFile(WORKSPACE, DEVICE)!;
    assert.deepEqual(file.layers, [["KC_A", "MO(1)"], ["LT(2,KC_SPC)", "LCTL(LSFT(KC_C))"]]);
    assert.deepEqual(file.macros, ["ab"]);
    assert.deepEqual(file.encoders, [[["KC_PGDN", "KC_PGUP"], ["MO(2)", "LCTL(LSFT(KC_C))"]]]);
    assert.equal(file.vendorProductId, 0x74700002);
    assert.equal(viaLayoutFileName(file), "test_board__60_.layout.json");
    const backup = viaBackupFromLayoutFile(JSON.stringify(file), WORKSPACE, new Date(0));
    assert.deepEqual(backup.layers, WORKSPACE.keymap);
    assert.deepEqual(backup.macros, [[0x61, 0x62]]);
    assert.deepEqual(backup.encoders, WORKSPACE.encoders);
    assert.equal(backup.vendorProductId, file.vendorProductId);
  });

  test("a layout file with an unknown name, a wrong layer size or a different shape is refused", () => {
    const file = createViaLayoutFile(WORKSPACE, DEVICE)!;
    assert.throws(() => viaBackupFromLayoutFile(JSON.stringify({ ...file, layers: [["KC_A", "NOPE"]] }), WORKSPACE), /unknown keycode/);
    assert.throws(() => viaBackupFromLayoutFile(JSON.stringify({ ...file, layers: [["KC_A"]] }), WORKSPACE), /wrong layer size/);
    assert.throws(() => viaBackupFromLayoutFile(JSON.stringify({ ...file, macros: ["a", "b", "c"] }), WORKSPACE), /macro count mismatch/);
    assert.throws(() => viaBackupFromLayoutFile("{}", WORKSPACE), /not a layout file/);
    assert.throws(() => viaBackupFromLayoutFile("nope", WORKSPACE), /not json/);
    assert.equal(createViaLayoutFile({ ...WORKSPACE, keymap: null }, DEVICE), null);
  });
});

describe("via-keyboard", () => {
  function device(usagePage = 0xff60, usage = 0x61): HIDDevice {
    return { vendorId: 0x7470, productId: 0x0002, productName: "Test VIA Board", opened: false,
      collections: [{ usagePage, usage, inputReports: [], outputReports: [], featureReports: [], children: [] }],
    } as unknown as HIDDevice;
  }

  test("a VIA raw HID collection is a keyboard, not a mouse", async () => {
    const raw = device(); const boot = device(1, 6);
    assert.ok(createKeyboardClient(raw) instanceof ViaKeyboardClient);
    assert.equal(await createSupportedClient(raw), null);
    assert.equal(createKeyboardClient(boot), null);
    assert.deepEqual(await listLogicalDevices([boot, raw]), [raw]);
    assert.ok(HID_FILTERS.some((f) => f.vendorId === undefined && f.usagePage === 0xff60 && f.usage === 0x61));
  });

  const KEY = { r: 0, rx: 0, ry: 0, d: false, h: 1, w: 1 };
  const DEFINITION = parseViaDefinition({
    name: "Test Board", vendorProductId: 0x74700002, firmwareVersion: 0, menus: [], keycodes: [],
    matrix: { rows: 1, cols: 2 },
    layouts: { width: 2, height: 1, keys: [{ row: 0, col: 0, x: 0, y: 0, ...KEY }, { row: 0, col: 1, x: 1, y: 0, ...KEY }] },
  });

  const MENU_DEFINITION = parseViaDefinition({
    name: "Test Board", vendorProductId: 0x74700002, firmwareVersion: 0, keycodes: [],
    matrix: { rows: 1, cols: 2 },
    layouts: { width: 2, height: 1, keys: [{ row: 0, col: 0, x: 0, y: 0, ...KEY }, { row: 0, col: 1, x: 1, y: 0, ...KEY }] },
    menus: [{
      label: "Lighting",
      content: [{
        label: "Backlight",
        content: [
          { label: "Brightness", type: "range", options: [0, 255], content: ["id_brightness", 3, 1] },
          { label: "Effect", type: "dropdown", options: ["Off", "Solid"], content: ["id_effect", 3, 2] },
          { label: "Color", type: "color", content: ["id_color", 3, 4] },
          { label: "Reset", type: "button", options: [1], content: ["id_reset", 3, 9] },
        ],
      }],
    }],
  });

  class FakeHid {
    customValues = new Map<string, number[]>([["3:1", [128]], ["3:2", [1]], ["3:4", [10, 200]]]);
    sets: { ids: number[]; value: number[]; verify: boolean }[] = [];
    saved: number[] = [];
    async readCustomValue(ids: number[], length: number): Promise<number[]> {
      const value = this.customValues.get(ids.join(":"));
      if (!value) throw new Error("unhandled");
      return value.slice(0, length);
    }
    customMax = 255;
    /** Stores one less than asked, like a board that scales 0-255 onto 0-254. */
    roundDown = false;
    async setCustomValue(ids: number[], value: number[], verify: boolean): Promise<number[]> {
      this.sets.push({ ids: [...ids], value: [...value], verify });
      const stored = value.map((byte) => Math.min(this.roundDown && byte > 0 ? byte - 1 : byte, this.customMax));
      this.customValues.set(ids.join(":"), stored);
      return verify ? [...stored] : [...value];
    }
    async saveCustomChannel(channel: number, _legacy = false): Promise<void> { this.saved.push(channel); }
    writes: number[][] = [];
    async open(): Promise<void> {}
    async close(): Promise<void> {}
    async readStatus() {
      return { brand: "VIA", name: "Test VIA Board", firmwareVersion: null, via: { protocolVersion: 9, layerCount: 2, layoutOptions: null, macroCount: this.macroSlots.length } };
    }
    layoutBits = 0;
    async setLayoutOptions(bits: number): Promise<number> { this.layoutBits = bits; return bits; }
    macroSlots: number[][] = [[0x61, 0x62], []];
    async readMacros() { return { count: this.macroSlots.length, bufferSize: 16, macros: this.macroSlots.map((slot) => [...slot]) }; }
    async writeMacros(macros: number[][]): Promise<void> { this.macroSlots = macros.map((slot) => [...slot]); }
    keymapData = [[4, 5], [6, 7]];
    async readKeymap(): Promise<number[][]> { return this.keymapData.map((layer) => [...layer]); }
    async writeKeymap(layers: number[][]): Promise<void> { this.keymapData = this.keymapData.map((layer, index) => (layers[index] ? [...layers[index]!] : layer)); }
    async setKeycode(layer: number, row: number, col: number, keycode: number): Promise<number> {
      this.writes.push([layer, row, col, keycode]);
      return keycode;
    }
    encoderData = new Map<string, number>();
    async readEncoder(layer: number, id: number, clockwise: boolean): Promise<number> { return this.encoderData.get(`${layer}:${id}:${clockwise}`) ?? 0; }
    async setEncoder(layer: number, id: number, clockwise: boolean, keycode: number): Promise<number> {
      this.encoderData.set(`${layer}:${id}:${clockwise}`, keycode);
      return keycode;
    }
    async readSwitchMatrix(rows: number, cols: number): Promise<number[]> { return Array.from({ length: rows }, () => (1 << cols) - 1); }
  }

  function viaClient(loadDefinition: () => Promise<typeof DEFINITION | null>, hid = new FakeHid()): ViaKeyboardClient {
    return new ViaKeyboardClient(device(), { hid: hid as unknown as ViaHidClient, loadDefinition });
  }

  test("refresh loads the definition and keymap, and a key write updates one cell after read-back", async () => {
    const hid = new FakeHid();
    const client = viaClient(async () => DEFINITION, hid);
    const loaded = await client.command({ kind: "refresh" });
    assert.equal(loaded.via?.definitionError, null);
    assert.deepEqual(loaded.via?.keymap, [[4, 5], [6, 7]]);
    const updated = await client.command({ kind: "viaSetKey", layer: 1, row: 0, col: 1, keycode: 0x29 });
    assert.deepEqual(updated.via?.keymap, [[4, 5], [6, 0x29]]);
    assert.deepEqual(hid.writes, [[1, 0, 1, 0x29]]);
    await assert.rejects(client.command({ kind: "viaSetKey", layer: 0, row: 1, col: 0, keycode: 4 }), RangeError);
    await assert.rejects(client.command({ kind: "viaSetKey", layer: 2, row: 0, col: 0, keycode: 4 }), RangeError);
  });

  test("menu values load, a write is read back and saved to the board, and a button is sent without read-back", async () => {
    const hid = new FakeHid();
    const client = viaClient(async () => MENU_DEFINITION, hid);
    const loaded = await client.command({ kind: "refresh" });
    assert.equal(loaded.via?.menus.length, 1);
    assert.deepEqual(loaded.via?.values, { "3:1": [128], "3:2": [1], "3:4": [10, 200] });
    const written = await client.command({ kind: "viaSetValue", ids: [3, 1], value: [200], verify: true });
    assert.deepEqual(written.via?.values["3:1"], [200]);
    assert.deepEqual(hid.sets[0], { ids: [3, 1], value: [200], verify: true });
    assert.deepEqual(hid.saved, [3]);
    assert.deepEqual(await client.command({ kind: "viaSetValue", ids: [3, 9], value: [1], verify: false }), {});
    assert.deepEqual(hid.sets[1], { ids: [3, 9], value: [1], verify: false });
    assert.deepEqual(hid.saved, [3, 3]);
    await assert.rejects(viaClient(async () => MENU_DEFINITION).command({ kind: "viaSetValue", ids: [3, 1], value: [1], verify: true }), /not loaded/);
  });

  test("old firmware addresses a Wilba Tech custom colour by value id and slot", async () => {
    const hid = new FakeHid();
    hid.customValues.set("23:2", [30, 40]);
    const wt = parseViaDefinition({
      name: "Test Board", vendorProductId: 0x74700002, firmwareVersion: 0,
      lighting: { extends: "wt_rgb_backlight", effects: [["Off", 0], ["Custom", 3]], supportedLightingValues: [10, 23] },
      matrix: { rows: 1, cols: 2 },
      layouts: { width: 2, height: 1, keys: [{ row: 0, col: 0, x: 0, y: 0, ...KEY }, { row: 0, col: 1, x: 1, y: 0, ...KEY }] },
    });
    const client = viaClient(async () => wt, hid);
    const loaded = (await client.command({ kind: "refresh" })).via!;
    assert.deepEqual(loaded.values["0:23:2"], [30, 40]);
    const written = await client.command({ kind: "viaSetValue", ids: [0, 23, 2], value: [50, 60], verify: true });
    assert.deepEqual(hid.sets.at(-1), { ids: [23, 2], value: [50, 60], verify: true });
    assert.deepEqual(written.via?.values["0:23:2"], [50, 60]);
  });

  test("a value the board clamps shows what the board holds, without an error", async () => {
    const hid = new FakeHid();
    hid.customMax = 150;
    const client = viaClient(async () => MENU_DEFINITION, hid);
    await client.command({ kind: "refresh" });
    const written = await client.command({ kind: "viaSetValue", ids: [3, 1], value: [220], verify: true });
    assert.deepEqual(written.via?.values["3:1"], [150]);
  });

  test("an exact slider write lands on the target even when the board stores one less", async () => {
    const hid = new FakeHid();
    hid.roundDown = true;
    const client = viaClient(async () => MENU_DEFINITION, hid);
    await client.command({ kind: "refresh" });
    const up = await client.command({ kind: "viaSetValue", ids: [3, 1], value: [155], verify: true, exact: true });
    assert.deepEqual(up.via?.values["3:1"], [155]);
    assert.deepEqual(hid.sets.slice(-2).map((entry) => entry.value[0]), [155, 156]);
    const step = await client.command({ kind: "viaSetValue", ids: [3, 1], value: [156], verify: true, exact: true });
    assert.deepEqual(step.via?.values["3:1"], [156]);
    const plain = await client.command({ kind: "viaSetValue", ids: [3, 1], value: [100], verify: true });
    assert.deepEqual(plain.via?.values["3:1"], [99]);
    hid.customMax = 150;
    const limit = await client.command({ kind: "viaSetValue", ids: [3, 1], value: [220], verify: true, exact: true });
    assert.deepEqual(limit.via?.values["3:1"], [150]);
    const before = hid.sets.length;
    await client.command({ kind: "viaSetValue", ids: [3, 2], value: [200], verify: true, exact: true });
    assert.ok(hid.sets.length - before <= 2);
  });

  test("encoders are read per layer, edited with read-back, and the matrix is probed without touching the workspace", async () => {
    const hid = new FakeHid();
    hid.encoderData.set("1:0:true", 0x4b);
    const withEncoder = parseViaDefinition({
      name: "Test Board", vendorProductId: 0x74700002, firmwareVersion: 0, keycodes: [], menus: [],
      matrix: { rows: 1, cols: 2 },
      layouts: { width: 2, height: 1, keys: [{ row: 0, col: 0, x: 0, y: 0, ...KEY }, { row: -1, col: -1, x: 1, y: 0, ei: 0, ...KEY }] },
    });
    const client = viaClient(async () => withEncoder, hid);
    const loaded = (await client.command({ kind: "refresh" })).via!;
    assert.deepEqual(loaded.encoders, [[[0, 0]], [[0, 0x4b]]]);
    const edited = (await client.command({ kind: "viaSetEncoder", layer: 0, id: 0, clockwise: false, keycode: 0x4e })).via!;
    assert.deepEqual(edited.encoders, [[[0x4e, 0]], [[0, 0x4b]]]);
    await assert.rejects(client.command({ kind: "viaSetEncoder", layer: 0, id: 3, clockwise: true, keycode: 4 }), RangeError);
    assert.deepEqual(await client.probeKeys(), [3]);
    const without = (await viaClient(async () => DEFINITION, new FakeHid()).command({ kind: "refresh" })).via!;
    assert.equal(without.encoders, null);
  });

  test("a value the board will not report stays null instead of failing the load", async () => {
    const hid = new FakeHid();
    hid.customValues.delete("3:2");
    const loaded = await viaClient(async () => MENU_DEFINITION, hid).command({ kind: "refresh" });
    assert.equal(loaded.via?.values["3:2"], null);
    assert.deepEqual(loaded.via?.values["3:1"], [128]);
  });

  test("macros load with the keymap and a write replaces the whole macro memory", async () => {
    const hid = new FakeHid();
    const client = viaClient(async () => DEFINITION, hid);
    const loaded = await client.command({ kind: "refresh" });
    assert.deepEqual(loaded.via?.macros, { count: 2, bufferSize: 16, macros: [[0x61, 0x62], []] });
    const written = await client.command({ kind: "viaWriteMacros", macros: [[0x61, 0x62], [1, 1, 0x28]] });
    assert.deepEqual(hid.macroSlots, [[0x61, 0x62], [1, 1, 0x28]]);
    assert.deepEqual(written.via?.macros?.macros, [[0x61, 0x62], [1, 1, 0x28]]);
    const noMacros = new FakeHid();
    noMacros.macroSlots = [];
    assert.equal((await viaClient(async () => DEFINITION, noMacros).command({ kind: "refresh" })).via?.macros, null);
    await assert.rejects(viaClient(async () => DEFINITION, noMacros).command({ kind: "viaWriteMacros", macros: [] }), /not loaded/);
  });

  test("a layout option is packed, written and reported back as the board's choice", async () => {
    const labelled = parseViaDefinition({
      name: "Test Board", vendorProductId: 0x74700002, firmwareVersion: 0, keycodes: [], menus: [], matrix: { rows: 1, cols: 2 },
      layouts: {
        labels: ["Split", ["Enter", "ANSI", "ISO", "Big"]], width: 2, height: 1,
        keys: [{ row: 0, col: 0, x: 0, y: 0, ...KEY }, { row: 0, col: 1, x: 1, y: 0, ...KEY }],
      },
    });
    const hid = new FakeHid();
    const client = viaClient(async () => labelled, hid);
    await client.command({ kind: "refresh" });
    const result = await client.command({ kind: "viaSetLayout", choices: [1, 2] });
    assert.equal(hid.layoutBits, 0b110);
    assert.deepEqual(result.via?.layoutChoices, [1, 2]);
    await assert.rejects(viaClient(async () => null).command({ kind: "viaSetLayout", choices: [1] }), /not loaded/);
  });

  test("a restore rewrites keymap, layout and macros, and refuses a bad backup before writing anything", async () => {
    const hid = new FakeHid();
    const client = viaClient(async () => DEFINITION, hid);
    await client.command({ kind: "refresh" });
    const restored = await client.command({ kind: "viaRestore", layers: [[9, 8]], macros: [[0x41], [0x42]], layoutOptions: [] });
    assert.deepEqual(hid.keymapData, [[9, 8], [6, 7]]);
    assert.deepEqual(hid.macroSlots, [[0x41], [0x42]]);
    assert.deepEqual(restored.via?.keymap, [[9, 8], [6, 7]]);
    assert.deepEqual(restored.via?.macros?.macros, [[0x41], [0x42]]);

    const before = JSON.stringify([hid.keymapData, hid.macroSlots]);
    await assert.rejects(client.command({ kind: "viaRestore", layers: [[1, 1]], macros: [[1]], layoutOptions: [] }), /do not match/);
    await assert.rejects(client.command({ kind: "viaRestore", layers: [[1, 1]], macros: [new Array(40).fill(0x41), []], layoutOptions: [] }), /do not fit/);
    assert.equal(JSON.stringify([hid.keymapData, hid.macroSlots]), before);
    await assert.rejects(viaClient(async () => null).command({ kind: "viaRestore", layers: [], macros: null, layoutOptions: [] }), /not loaded/);
  });

  test("the identity is named after the VIA definition when there is one", async () => {
    assert.equal((await viaClient(async () => DEFINITION).readIdentity()).name, "Test Board");
    assert.equal((await viaClient(async () => null).readIdentity()).name, "Test VIA Board");
    assert.equal((await viaClient(async () => { throw new Error("offline"); }).readIdentity()).name, "Test VIA Board");
  });

  test("without a definition the keymap stays unread and the reason is reported", async () => {
    const missing = await viaClient(async () => null).command({ kind: "refresh" });
    assert.equal(missing.via?.definitionError, "notFound");
    assert.equal(missing.via?.keymap, null);
    const down = await viaClient(async () => { throw new Error("offline"); }).command({ kind: "refresh" });
    assert.equal(down.via?.definitionError, "offline");
    await assert.rejects(viaClient(async () => null).command({ kind: "viaSetKey", layer: 0, row: 0, col: 0, keycode: 4 }), /not loaded/);
  });

  test("VIA rejects commands that are not its own", async () => {
    const client = new ViaKeyboardClient(device());
    await assert.rejects(client.command({ kind: "sleep", value: 30 }), /only for VIA/);
    assert.equal(client.name, "Test VIA Board");
  });
});

describe("via-macro-recording", () => {
  test("host key events become macro actions with pauses, and a quick press folds into a tap", async () => {
    const { viaRecordKey, viaTidyRecording, viaOsLegend } = await import("./via-keyboard.ts");
    let actions = viaRecordKey([], { down: true, code: "KeyA", gapMs: 5000 }, true);
    actions = viaRecordKey(actions, { down: false, code: "KeyA", gapMs: 40 }, true);
    actions = viaRecordKey(actions, { down: true, code: "ShiftLeft", gapMs: 450 }, true);
    actions = viaRecordKey(actions, { down: true, code: "MediaPlay", gapMs: 10 }, true);
    assert.deepEqual(actions, [
      { type: "down", keycode: 0x04 }, { type: "up", keycode: 0x04 },
      { type: "delay", ms: 450 }, { type: "down", keycode: 0xe1 },
    ]);
    assert.deepEqual(viaTidyRecording(actions), [{ type: "tap", keycode: 0x04 }, { type: "delay", ms: 450 }, { type: "down", keycode: 0xe1 }]);
    assert.deepEqual(viaRecordKey([], { down: true, code: "KeyB", gapMs: 99999 }, true), [{ type: "down", keycode: 0x05 }]);
    assert.deepEqual(viaRecordKey([{ type: "tap", keycode: 4 }], { down: true, code: "KeyB", gapMs: 99999 }, false), [{ type: "tap", keycode: 4 }, { type: "down", keycode: 5 }]);
    assert.equal((viaRecordKey([{ type: "tap", keycode: 4 }], { down: true, code: "KeyB", gapMs: 99999 }, true)[1] as { ms: number }).ms, 9999);
    // OS legends: a QWERTZ layout puts Z where QWERTY has Y.
    const qwertz = new Map([["KeyY", "z"], ["Enter", "Enter"]]);
    assert.equal(viaOsLegend(0x1c, qwertz), "Z");
    assert.equal(viaOsLegend(0x28, qwertz), null);
    assert.equal(viaOsLegend(0x5221, qwertz), null);
    assert.equal(viaOsLegend(0x1c, null), null);
  });
});
