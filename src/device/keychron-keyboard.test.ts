import assert from "node:assert/strict";
import test from "node:test";
import { KEYCHRON_HE_COMMAND, KEYCHRON_HE_SUBCOMMAND as SUB } from "@openmouse/keyboard-protocol/keychron";
import { KeychronKeyboardClient } from "./keychron-keyboard.ts";
import { KEYCHRON_HID_FILTERS } from "./hid-filters.ts";
import { createKeyboardClient } from "./device-clients.ts";
import { KEYCHRON_HALL_EFFECT_FLAG } from "./keychron-flag.ts";

/** Keychron J3 HE ANSI: 6 x 19 keys, travel 0.2 to 3.3 mm, dead zone 0.2 mm (range 0.2 to 3.5 mm). */
const PRODUCT_ID = 0x040c;
const ROWS = 6;
const COLS = 19;
const SIZE = 4 * (ROWS * COLS + 1) + 19 * 20 + 3 * 20 + 32;

/** A v4 board with three profiles; the active one is slot 1. Calibration state and curve are mutable. */
class FakeBoard {
  vendorId = 0x3434;
  productId = PRODUCT_ID;
  productName = "Keychron J3 HE";
  opened = false;
  collections = [{ usagePage: 0xff60, usage: 0x61, inputReports: [], outputReports: [], featureReports: [], children: [] }];
  listeners = new Set<(event: HIDInputReportEvent) => void>();
  sent: Uint8Array[] = [];
  buffer = new Uint8Array(SIZE);
  curve = [0, 0, 12, 42, 24, 85, 35, 127];
  /** Report this curve instead of the one written, to model a board that ignores the write. */
  ignoreCurveWrite = false;
  calibrationState = 0;
  viaSent: Uint8Array[] = [];
  /** Leave VIA reads unanswered, as a board without the dynamic keymap would. */
  noKeymap = false;
  noCalibrationRead = false;
  get hid(): HIDDevice { return this as unknown as HIDDevice; }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  addEventListener(_type: string, listener: (event: HIDInputReportEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_type: string, listener: (event: HIDInputReportEvent) => void) { this.listeners.delete(listener); }
  commands(subcommand: number): Uint8Array[] { return this.sent.filter((frame) => frame[1] === subcommand); }
  /** Standard VIA reads: protocol version, layer count, and a keymap whose code is its own flat index + 4. */
  private answerVia(request: Uint8Array) {
    this.viaSent.push(request.slice());
    if (this.noKeymap) return;
    const reply = new Uint8Array(32);
    reply[0] = request[0]!;
    if (request[0] === 0x01) reply[2] = 12;
    else if (request[0] === 0x11) reply[1] = 2;
    else {
      const offset = (request[1]! << 8) | request[2]!;
      reply.set(request.slice(1, 4), 1);
      for (let i = 0; i < request[3]!; i += 2) { const code = offset / 2 + i / 2 + 4; reply[4 + i] = code >> 8; reply[5 + i] = code & 0xff; }
    }
    const event = { device: this.hid, reportId: 0, data: new DataView(reply.buffer, 0, 32) } as HIDInputReportEvent;
    this.listeners.forEach((listener) => listener(event));
  }
  async sendReport(_reportId: number, data: BufferSource) {
    const request = data as Uint8Array;
    if ([0x01, 0x11, 0x12].includes(request[0]!)) return this.answerVia(request);
    assert.equal(request[0], KEYCHRON_HE_COMMAND);
    this.sent.push(request.slice());
    if (request[1] === SUB.calibrate && request[2] === 4) return; // stop is never answered
    if (request[1] === SUB.getCalibrateState && this.noCalibrationRead) return;
    const reply = new Uint8Array(32);
    reply.set(request.slice(0, 2));
    switch (request[1]) {
      case SUB.getVersion: reply.set([4, 0, 0b100001], 2); break;
      case SUB.getProfilesInfo: reply.set([1, 3, SIZE & 0xff, SIZE >> 8, 20, 20], 2); break;
      case SUB.getProfileBuffer: {
        reply.set(request.slice(2, 6), 2);
        const offset = request[3]! | (request[4]! << 8);
        const nameStart = SIZE - 32;
        const name = new Uint8Array(32);
        name.set([0, 0x50, 0, 0x30 + request[2]!]);
        for (let i = 0; i < request[5]!; i++) reply[6 + i] = offset + i >= nameStart ? name[offset + i - nameStart]! : this.buffer[offset + i]!;
        break;
      }
      case SUB.setTravel: case SUB.saveProfileBuffer: case SUB.clearProfileBuffer: case SUB.selectProfile: reply[2] = 0; break;
      case SUB.getCurve: reply.set(this.curve, 2); break;
      case SUB.setCurve: if (!this.ignoreCurveWrite) this.curve = [...request.slice(2, 10)]; break;
      case SUB.getRealtimeTravel: reply.set([request[2]!, request[3]!, 33], 3); break;
      case SUB.getAxisType: reply.set([2, 0x21, 0x00], 2); break;
      case SUB.calibrate: this.calibrationState = 2; break;
      case SUB.getCalibrateState: reply[3] = this.calibrationState; reply[4] = 0b101; break;
      default: break;
    }
    const event = { device: this.hid, reportId: 0, data: new DataView(reply.buffer, 0, 32) } as HIDInputReportEvent;
    this.listeners.forEach((listener) => listener(event));
  }
}

async function ready(board = new FakeBoard()) {
  const client = new KeychronKeyboardClient(board.hid);
  const workspace = await client.command({ kind: "refresh" });
  return { board, client, workspace };
}

test("refresh reads status, profile, curve and axis type", async () => {
  const { workspace } = await ready();
  const keychron = workspace.keychron!;
  assert.equal(keychron.status.activeProfile, 1);
  assert.deepEqual(keychron.status.profileNames, ["P0", "P1", "P2"]);
  assert.equal(keychron.status.keychron?.unit, 0.1);
  assert.equal(keychron.profile?.keys.length, ROWS);
  assert.equal(keychron.profile?.keys[0]?.length, COLS);
  assert.deepEqual(keychron.curve, [[0, 0], [12, 42], [24, 85], [35, 127]]);
  assert.equal(keychron.axis?.type, 2);
  assert.equal(keychron.unsaved, null);
  assert.equal(keychron.layout.physical, true);
  assert.equal(keychron.layout.keys.length, 100);
  assert.equal(keychron.keymap?.length, ROWS);
  assert.equal(keychron.keymap?.[0]?.[0], 4);
  assert.equal(keychron.keymap?.[1]?.[0], 4 + COLS);
  assert.equal(keychron.calibrationPhase, "idle");
});

test("a board that does not answer the keymap read still returns everything else and keeps working", async () => {
  const board = new FakeBoard();
  board.noKeymap = true;
  const client = new KeychronKeyboardClient(board.hid);
  const keychron = (await client.command({ kind: "refresh" })).keychron!;
  assert.equal(keychron.keymap, null);
  assert.ok(keychron.profile && keychron.curve && keychron.axis);
  assert.ok(keychron.layout.physical);
  assert.equal(board.viaSent.length, 1);
  const travel = await client.command({ kind: "keychronKeyTravel", row: 1, col: 1 });
  assert.equal(travel.keychron?.keyTravel?.steps, 33);
});

test("setTravel stages the write and does not save", async () => {
  const { board, client } = await ready();
  const result = await client.command({ kind: "keychronSetTravel", rapidTrigger: true, pressMm: 1.5, sensitivePressMm: 0.3, sensitiveReleaseMm: 0.4 });
  const writes = board.commands(SUB.setTravel);
  assert.equal(writes.length, 1);
  // slot, work mode (quick trigger), press, rapid-trigger press and release, key mode (all keys)
  assert.deepEqual([...writes[0]!.slice(2, 8)], [1, 2, 15, 3, 4, 1]);
  assert.equal(board.commands(SUB.saveProfileBuffer).length, 0);
  assert.deepEqual(result.keychron?.unsaved, { press: 15, sensitivePress: 3, sensitiveRelease: 4 });
});

test("plain actuation uses the static work mode and sends no rapid-trigger values", async () => {
  const { board, client } = await ready();
  await client.command({ kind: "keychronSetTravel", rapidTrigger: false, pressMm: 1.5, sensitivePressMm: 0, sensitiveReleaseMm: 0 });
  assert.deepEqual([...board.commands(SUB.setTravel)[0]!.slice(2, 8)], [1, 1, 15, 0, 0, 1]);
});

test("refresh preserves a staged travel change and its save guard", async () => {
  const { client } = await ready();
  await client.command({ kind: "keychronSetTravel", rapidTrigger: false, pressMm: 1.5, sensitivePressMm: 0, sensitiveReleaseMm: 0 });
  const refreshed = await client.command({ kind: "refresh" });
  assert.equal(refreshed.keychron?.unsaved?.press, 15);
  await assert.rejects(() => client.command({ kind: "keychronSelectProfile", slot: 2 }), /unsaved/);
  const saved = await client.command({ kind: "keychronSave" });
  assert.equal(saved.keychron?.unsaved, null);
});

test("a selected key is written through the per-key bitmap", async () => {
  const { board, client } = await ready();
  await client.command({ kind: "keychronSetTravel", rapidTrigger: false, keys: [{ row: 1, col: 9 }], pressMm: 1, sensitivePressMm: 0.3, sensitiveReleaseMm: 0.3 });
  const write = board.commands(SUB.setTravel)[0]!;
  assert.equal(write[7], 0); // per-key
  assert.equal(write[8 + 3 * 1 + 1], 0b10); // byte 3 * row + floor(col / 8), bit col % 8
  assert.equal(write.slice(8, 32).reduce((sum, byte) => sum + byte, 0), 0b10);
  await assert.rejects(() => client.command({ kind: "keychronSetTravel", rapidTrigger: false, keys: [], pressMm: 1, sensitivePressMm: 0.3, sensitiveReleaseMm: 0.3 }), RangeError);
});

test("renaming writes the name, and is blocked while a travel change is unsaved", async () => {
  const { board, client } = await ready();
  const result = await client.command({ kind: "keychronRename", slot: 2, name: " Work " });
  const [write] = board.commands(SUB.setProfileName);
  assert.equal(write![2], 2);
  assert.equal(write![3], 8); // "Work" in UTF-16BE
  assert.equal(board.commands(SUB.saveProfileBuffer).length, 1);
  assert.ok(result.keychron);
  await assert.rejects(() => client.command({ kind: "keychronRename", slot: 2, name: "" }), RangeError);
  await client.command({ kind: "keychronSetTravel", rapidTrigger: false, pressMm: 1, sensitivePressMm: 0.3, sensitiveReleaseMm: 0.3 });
  await assert.rejects(() => client.command({ kind: "keychronRename", slot: 2, name: "Other" }), /unsaved/);
  assert.equal(board.commands(SUB.setProfileName).length, 1);
});

test("save needs a staged change, persists it, then re-reads the profile", async () => {
  const { board, client } = await ready();
  await assert.rejects(() => client.command({ kind: "keychronSave" }), /no travel change/);
  await client.command({ kind: "keychronSetTravel", rapidTrigger: true, pressMm: 1.5, sensitivePressMm: 0.3, sensitiveReleaseMm: 0.3 });
  const reads = board.commands(SUB.getProfileBuffer).length;
  const result = await client.command({ kind: "keychronSave" });
  assert.equal(board.commands(SUB.saveProfileBuffer).length, 1);
  assert.ok(board.commands(SUB.getProfileBuffer).length > reads);
  assert.equal(result.keychron?.unsaved, null);
});

test("travel outside the board's declared range is rejected before anything is sent", async () => {
  const { board, client } = await ready();
  for (const pressMm of [0.1, 3.6, Number.NaN]) {
    await assert.rejects(() => client.command({ kind: "keychronSetTravel", rapidTrigger: true, pressMm, sensitivePressMm: 0.3, sensitiveReleaseMm: 0.3 }), RangeError);
  }
  assert.equal(board.commands(SUB.setTravel).length, 0);
});

test("a staged change blocks switching profile", async () => {
  const { board, client } = await ready();
  await client.command({ kind: "keychronSetTravel", rapidTrigger: true, pressMm: 1, sensitivePressMm: 0.3, sensitiveReleaseMm: 0.3 });
  await assert.rejects(() => client.command({ kind: "keychronSelectProfile", slot: 2 }), /unsaved/);
  assert.equal(board.commands(SUB.selectProfile).length, 0);
});

test("selecting a profile writes the slot and re-reads the board", async () => {
  const { board, client } = await ready();
  await client.command({ kind: "keychronSelectProfile", slot: 2 });
  assert.deepEqual([...board.commands(SUB.selectProfile)[0]!.slice(2, 3)], [2]);
  await assert.rejects(() => client.command({ kind: "keychronSelectProfile", slot: 3 }), RangeError);
});

test("clearing a profile needs the confirmation flag", async () => {
  const { board, client } = await ready();
  await assert.rejects(() => client.command({ kind: "keychronClear" } as never), /confirmation/);
  assert.equal(board.commands(SUB.clearProfileBuffer).length, 0);
  await client.command({ kind: "keychronClear", confirmed: true });
  assert.deepEqual([...board.commands(SUB.clearProfileBuffer)[0]!.slice(2, 3)], [1]);
});

test("starting calibration needs the confirmation flag; stop is sent without a reply", async () => {
  const { board, client } = await ready();
  await assert.rejects(() => client.command({ kind: "keychronCalibration", action: "start" } as never), /confirmation/);
  assert.equal(board.commands(SUB.calibrate).length, 0);
  const started = await client.command({ kind: "keychronCalibration", action: "start", confirmed: true });
  assert.equal(started.keychron?.calibration?.state, 2);
  assert.equal(started.keychron?.calibration?.keys.filter(Boolean).length, 2);
  const stopped = await client.command({ kind: "keychronCalibration", action: "stop" });
  assert.deepEqual(board.commands(SUB.calibrate).map((frame) => frame[2]), [2, 4]);
  assert.equal(stopped.keychron?.calibration, null);
});

test("a failed calibration read still reports that calibration started", async () => {
  const { board, client } = await ready();
  board.noCalibrationRead = true;
  await assert.rejects(() => client.command({ kind: "keychronCalibration", action: "start", confirmed: true }));
  assert.equal(client.recoveredWorkspace()?.keychron?.calibrationPhase, "started");
});

test("a curve write is confirmed by reading the board back", async () => {
  const { board, client } = await ready();
  const curve = [[1, 2], [3, 4], [5, 6], [7, 8]] as const;
  const result = await client.command({ kind: "keychronWriteCurve", curve });
  assert.deepEqual(result.keychron?.curve, curve);
  board.ignoreCurveWrite = true;
  await assert.rejects(() => client.command({ kind: "keychronWriteCurve", curve: [[9, 9], [9, 9], [9, 9], [9, 9]] }), /different response curve/);
  const writes = board.commands(SUB.setCurve).length;
  for (const bad of [[[36, 0], [36, 0], [36, 0], [36, 0]], [[0, 128], [1, 0], [2, 0], [3, 0]], [[5, 0], [4, 0], [6, 0], [7, 0]]] as const) {
    await assert.rejects(() => client.command({ kind: "keychronWriteCurve", curve: bad }), RangeError);
  }
  assert.equal(board.commands(SUB.setCurve).length, writes);
});

test("live key travel reads one key inside the matrix", async () => {
  const { client } = await ready();
  const result = await client.command({ kind: "keychronKeyTravel", row: 2, col: 5 });
  assert.deepEqual(result.keychron?.keyTravel, { row: 2, col: 5, steps: 33 });
  await assert.rejects(() => client.command({ kind: "keychronKeyTravel", row: ROWS, col: 0 }), RangeError);
});

test("commands for other brands are refused", async () => {
  const { client } = await ready();
  await assert.rejects(() => client.command({ kind: "system", value: 0 }), /different keyboard brand/);
});

test("Keychron filters cover every catalogued board's raw-HID collection", () => {
  assert.ok(KEYCHRON_HID_FILTERS.length > 100);
  assert.ok(KEYCHRON_HID_FILTERS.every((filter) => filter.vendorId === 0x3434 && filter.usagePage === 0xff60 && filter.usage === 0x61));
  assert.ok(KEYCHRON_HID_FILTERS.some((filter) => filter.productId === PRODUCT_ID));
});

test("the keyboard factory ignores Keychron boards until the flag is set", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  try {
    const board = new FakeBoard();
    assert.equal(createKeyboardClient(board.hid), null);
    store.set(KEYCHRON_HALL_EFFECT_FLAG, "1");
    assert.ok(createKeyboardClient(board.hid) instanceof KeychronKeyboardClient);
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});
