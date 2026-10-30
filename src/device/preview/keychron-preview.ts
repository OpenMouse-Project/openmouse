/**
 * Dev-only preview of the Keychron Hall-effect controls: a fake board behind
 * `?keychronPreview=1` (command v4) or `?keychronPreview=v5`. It is imported
 * only from `main.tsx` under `import.meta.env.DEV`, so it never reaches a
 * production build. Nothing here describes real firmware: the fake answers the
 * frames the driver sends, keeps staged writes apart from saved ones, and
 * makes up plausible values.
 */
import {
  KEYCHRON_HE_COMMAND, KEYCHRON_HE_SUBCOMMAND as SUB, keychronKeycodeCatalog, keychronKeycodeContext,
} from "@openmouse/keyboard-protocol/keychron";
import { KEYCHRON_HALL_EFFECT_FLAG } from "../keychron-flag.ts";

const ROWS = 6;
const COLS = 19; // Keychron J3 HE ANSI (0x040c): travel 0.2 to 3.3 mm, dead zone 0.2 mm
const PRODUCT_ID = 0x040c;
const PROFILES = 3;
const NAMES = ["Typing", "Gaming", "Shooter"];

/**
 * QMK keycodes by [row][col] for the J3 HE ANSI matrix, in the order the
 * board's physical layout draws them. Preview data only.
 */
const KEYMAP_ROWS: Record<number, Record<number, number>> = {
  0: { 0: 41, 1: 58, 2: 59, 3: 60, 4: 61, 5: 62, 6: 63, 7: 64, 8: 65, 9: 66, 10: 67, 11: 68, 12: 69, 13: 70, 15: 74, 16: 77, 18: 127 },
  1: { 0: 53, 1: 30, 2: 31, 3: 32, 4: 33, 5: 34, 6: 35, 7: 36, 8: 37, 9: 38, 10: 39, 11: 45, 12: 46, 13: 42, 14: 76, 15: 83, 16: 84, 17: 85, 18: 86 },
  2: { 0: 43, 1: 20, 2: 26, 3: 8, 4: 21, 5: 23, 6: 28, 7: 24, 8: 12, 9: 18, 10: 19, 11: 47, 12: 48, 13: 49, 14: 75, 15: 95, 16: 96, 17: 97, 18: 87 },
  3: { 0: 57, 1: 4, 2: 22, 3: 7, 4: 9, 5: 10, 6: 11, 7: 13, 8: 14, 9: 15, 10: 51, 11: 52, 13: 40, 15: 92, 16: 93, 17: 94 },
  4: { 0: 225, 2: 29, 3: 27, 4: 6, 5: 25, 6: 5, 7: 17, 8: 16, 9: 54, 10: 55, 11: 56, 13: 229, 14: 82, 15: 89, 16: 90, 17: 91, 18: 88 },
  5: { 0: 224, 1: 227, 2: 226, 6: 44, 9: 230, 10: 231, 11: 101, 12: 80, 13: 81, 14: 79, 16: 98, 17: 99 },
};
const LAYERS = 3;
/** Arrow keys use the analog mode in the Gaming and Shooter profiles, so the response curve card is editable there and read only in Typing. */
const ANALOG_KEYS = new Set(["4:14", "5:12", "5:13", "5:14"]);
const DEMO_ADVANCED_KEY = { row: 3, col: 4 }; // one key with a non-default advanced mode, so the legend has all three kinds

/** How the fake board misbehaves: it ignores key writes, or ignores every VIA command. */
export type PreviewFault = "none" | "reject" | "novia";

export interface PreviewOptions {
  layout: "v4" | "v5";
  /** VIA protocol version: 12 is current QMK, 10 selects the legacy keycode table. */
  protocol: 10 | 12;
  fault: PreviewFault;
}

/**
 * `?keychronPreview=1` is a v4 board at VIA protocol 12. Add words separated by
 * commas: `v5`, `legacy` (protocol 10), `reject` (the board ignores key writes)
 * or `novia` (the board ignores VIA commands).
 */
export function keychronPreviewRequested(search: string): PreviewOptions | null {
  const value = new URLSearchParams(search).get("keychronPreview");
  if (value === null) return null;
  const words = value.split(",").map((word) => word.trim());
  return {
    layout: words.includes("v5") ? "v5" : "v4",
    protocol: words.includes("legacy") ? 10 : 12,
    fault: words.includes("novia") ? "novia" : words.includes("reject") ? "reject" : "none",
  };
}

export class FakeKeychronBoard {
  readonly vendorId = 0x3434;
  readonly productId = PRODUCT_ID;
  readonly productName = "Keychron J3 HE ANSI (preview)";
  readonly collections = [{ usagePage: 0xff60, usage: 0x61, inputReports: [], outputReports: [], featureReports: [], children: [] }];
  opened = false;
  private readonly listeners = new Set<(event: HIDInputReportEvent) => void>();
  private readonly v5: boolean;
  private readonly version: number;
  private readonly slotSize: number;
  private readonly size: number;
  private readonly unit: number;
  private readonly keymap = new Uint8Array(LAYERS * ROWS * COLS * 2);
  private readonly protocol: number;
  private readonly fault: PreviewFault;
  private readonly saved: Uint8Array[] = [];
  private working: Uint8Array;
  private current = 1;
  /** x in 0.1 mm steps up to 35 (3.3 mm travel plus 0.2 mm dead zone), y 0 to 127. */
  private curve = [0, 0, 12, 42, 24, 85, 35, 127];
  private calibration = 0;

  private readonly replyDelayMs: number;

  constructor(v5: boolean, replyDelayMs = 15, options: { protocol?: number; fault?: PreviewFault } = {}) {
    this.replyDelayMs = replyDelayMs;
    this.protocol = options.protocol ?? 12;
    this.fault = options.fault ?? "none";
    this.v5 = v5;
    this.version = v5 ? 5 : 4;
    this.slotSize = v5 ? 7 : 4;
    this.unit = v5 ? 0.01 : 0.1;
    this.size = this.slotSize * (ROWS * COLS + 1) + (v5 ? 21 : 19) * 20 + 3 * 20 + 32;
    // Layers above 0 are transparent (KC_TRNS) except for the keys set below.
    for (let at = ROWS * COLS * 2; at < this.keymap.length; at += 2) this.keymap[at + 1] = 1;
    for (const [row, cols] of Object.entries(KEYMAP_ROWS)) {
      for (const [col, code] of Object.entries(cols)) this.setCode(0, Number(row), Number(col), code);
    }
    // A layer key and a board-specific key, with the codes of this protocol's table.
    const context = keychronKeycodeContext(PRODUCT_ID, this.protocol);
    const catalog = keychronKeycodeCatalog({ ...context, layerCount: LAYERS });
    const find = (category: string, label: string): number | undefined => catalog.find((entry) => entry.id === category)?.entries.find((entry) => entry.label === label)?.code;
    const momentary = find("layers", "MO1");
    const custom = catalog.find((entry) => entry.id === "keychron")?.entries[0]?.code;
    if (momentary !== undefined) this.setCode(0, 5, 10, momentary);
    if (custom !== undefined) this.setCode(0, 5, 2, custom);
    for (let slot = 0; slot < PROFILES; slot++) this.saved.push(this.defaults(slot));
    this.working = this.saved[this.current]!.slice();
  }

  private steps(mm: number): number { return Math.round(mm / this.unit); }

  private writeSlot(buffer: Uint8Array, index: number, key: { distance: number; press: number; release: number; advance: number }): void {
    const at = this.slotSize * index;
    if (this.v5) {
      const word = BigInt(key.distance) << 2n | BigInt(key.press) << 16n | BigInt(key.release) << 30n | BigInt(key.advance) << 44n;
      for (let i = 0; i < 6; i++) buffer[at + i] = Number((word >> BigInt(8 * i)) & 0xffn);
      buffer[at + 6] = 0;
    } else {
      const word = BigInt(key.distance) << 2n | BigInt(key.press) << 8n | BigInt(key.release) << 14n | BigInt(key.advance) << 20n;
      for (let i = 0; i < 4; i++) buffer[at + i] = Number((word >> BigInt(8 * i)) & 0xffn);
    }
  }

  private writeName(buffer: Uint8Array, name: string): void {
    const start = this.size - 32;
    buffer.fill(0, start);
    [...name].forEach((char, index) => { buffer[start + 2 * index] = char.charCodeAt(0) >> 8; buffer[start + 2 * index + 1] = char.charCodeAt(0) & 0xff; });
  }

  /** Profile 0 is plain actuation, 1 adds rapid trigger on the WASD block, 2 is shallow everywhere. */
  private defaults(slot: number): Uint8Array {
    const buffer = new Uint8Array(this.size);
    const base = [1.5, 1.2, 0.8][slot]!;
    const rapid = slot === 0 ? 0 : [0, 0.3, 0.2][slot]!;
    this.writeSlot(buffer, 0, { distance: this.steps(base), press: this.steps(rapid), release: this.steps(rapid), advance: 0 });
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const wasd = (row === 3 && col >= 2 && col <= 4) || (row === 2 && col === 3);
        const distance = wasd ? Math.max(0.4, base - 0.5) : base;
        const demo = row === DEMO_ADVANCED_KEY.row && col === DEMO_ADVANCED_KEY.col;
        this.writeSlot(buffer, 1 + row * COLS + col, {
          distance: this.steps(distance), press: this.steps(wasd ? rapid : 0), release: this.steps(wasd ? rapid : 0),
          advance: demo ? 3 : slot > 0 && ANALOG_KEYS.has(`${row}:${col}`) ? 4 : 0,
        });
      }
    }
    this.writeName(buffer, NAMES[slot]!);
    return buffer;
  }

  private codeAt(layer: number, row: number, col: number): number {
    const at = ((layer * ROWS + row) * COLS + col) * 2;
    return (this.keymap[at]! << 8) | this.keymap[at + 1]!;
  }

  private setCode(layer: number, row: number, col: number, code: number): void {
    const at = ((layer * ROWS + row) * COLS + col) * 2;
    this.keymap[at] = code >> 8;
    this.keymap[at + 1] = code & 0xff;
  }

  open(): Promise<void> { this.opened = true; return Promise.resolve(); }
  close(): Promise<void> { this.opened = false; return Promise.resolve(); }
  addEventListener(_type: string, listener: (event: HIDInputReportEvent) => void): void { this.listeners.add(listener); }
  removeEventListener(_type: string, listener: (event: HIDInputReportEvent) => void): void { this.listeners.delete(listener); }
  forgotten = false;
  forget(): Promise<void> { this.forgotten = true; return Promise.resolve(); }

  private applyTravel(request: Uint8Array): void {
    const word = (at: number): number => request[at]! | (request[at + 1]! << 8);
    const read = (at: number): number => (this.v5 ? word(at) : request[at]!);
    const press = read(4);
    const rtPress = read(this.v5 ? 6 : 5);
    const rtRelease = read(this.v5 ? 8 : 6);
    const modeAt = this.v5 ? 10 : 7;
    const keyMode = request[modeAt]!;
    const bitmap = request.slice(modeAt + 1, modeAt + 25);
    const touch = (index: number): void => {
      const at = this.slotSize * index;
      const old = this.working.slice(at, at + this.slotSize);
      const merged = this.decode(old);
      merged.distance = press;
      // The frame carries zeros for the rapid-trigger values when rapid trigger is off.
      merged.press = rtPress;
      merged.release = rtRelease;
      this.writeSlot(this.working, index, merged);
    };
    if (keyMode === 1) {
      for (let index = 0; index <= ROWS * COLS; index++) touch(index);
      return;
    }
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if ((bitmap[3 * row + Math.floor(col / 8)]! >> (col % 8)) & 1) touch(1 + row * COLS + col);
      }
    }
  }

  private decode(bytes: Uint8Array): { distance: number; press: number; release: number; advance: number } {
    let word = 0n;
    const length = this.v5 ? 6 : 4;
    for (let i = length - 1; i >= 0; i--) word = (word << 8n) | BigInt(bytes[i]!);
    const field = (low: number, width: number): number => Number((word >> BigInt(low)) & ((1n << BigInt(width)) - 1n));
    return this.v5
      ? { distance: field(2, 14), press: field(16, 14), release: field(30, 14), advance: field(44, 4) }
      : { distance: field(2, 6), press: field(8, 6), release: field(14, 6), advance: field(20, 4) };
  }

  /** The standard VIA protocol, layer-count, keycode and keymap-buffer commands. */
  private answerVia(request: Uint8Array): void {
    if (this.fault === "novia") return;
    const reply = new Uint8Array(32);
    reply[0] = request[0]!;
    if (request[0] === 0x01) reply[2] = this.protocol;
    else if (request[0] === 0x04 || request[0] === 0x05) {
      const [layer, row, col] = [request[1]!, request[2]!, request[3]!];
      if (layer >= LAYERS || row >= ROWS || col >= COLS) return;
      // A "reject" board takes the write command and then keeps its old key.
      if (request[0] === 0x05) { if (this.fault !== "reject") this.setCode(layer, row, col, (request[4]! << 8) | request[5]!); return; }
      reply.set([layer, row, col, this.codeAt(layer, row, col) >> 8, this.codeAt(layer, row, col) & 0xff], 1);
    } else if (request[0] === 0x11) reply[1] = LAYERS;
    else {
      const offset = (request[1]! << 8) | request[2]!;
      reply.set(request.slice(1, 4), 1);
      for (let i = 0; i < request[3]!; i++) reply[4 + i] = this.keymap[offset + i] ?? 0;
    }
    this.deliver(reply);
  }

  private deliver(reply: Uint8Array): void {
    // Replies carry no transaction id; answer on the next task like a real report.
    setTimeout(() => {
      const event = { device: this, reportId: 0, data: new DataView(reply.buffer) } as unknown as HIDInputReportEvent;
      this.listeners.forEach((listener) => listener(event));
    }, this.replyDelayMs);
  }

  async sendReport(_reportId: number, data: BufferSource): Promise<void> {
    const request = new Uint8Array(data as ArrayBuffer);
    if ([0x01, 0x04, 0x05, 0x11, 0x12].includes(request[0]!)) { this.answerVia(request); return; }
    if (request[0] !== KEYCHRON_HE_COMMAND) return;
    const sub = request[1]!;
    if (sub === SUB.calibrate && request[2] === 4) { this.calibration = 0; return; } // stop is never answered
    const reply = new Uint8Array(32);
    reply.set(request.slice(0, 2));
    switch (sub) {
      case SUB.getVersion: reply[2] = this.version; reply[4] = 0b100001; break;
      case SUB.getProfilesInfo: reply.set([this.current, PROFILES, this.size & 0xff, this.size >> 8, 20, 20, this.v5 ? 2 : 0], 2); break;
      case SUB.selectProfile:
        this.current = request[2]!;
        this.working = this.saved[this.current]!.slice();
        break;
      case SUB.getProfileBuffer: {
        reply.set(request.slice(2, 6), 2);
        const offset = request[3]! | (request[4]! << 8);
        const source = this.saved[request[2]!]!;
        for (let i = 0; i < request[5]!; i++) reply[6 + i] = source[offset + i] ?? 0;
        break;
      }
      case SUB.setTravel: this.applyTravel(request); break;
      case SUB.setProfileName: {
        const slot = request[2]!;
        const chars = request.slice(4, 4 + request[3]!);
        const start = this.size - 32;
        this.saved[slot]!.fill(0, start);
        this.saved[slot]!.set(chars, start);
        if (slot === this.current) this.working.set(this.saved[slot]!.slice(start), start);
        break;
      }
      case SUB.saveProfileBuffer: this.saved[request[2]!] = this.working.slice(); break;
      case SUB.clearProfileBuffer: {
        const fresh = this.defaults(request[2]!);
        this.saved[request[2]!] = fresh;
        this.working = fresh.slice();
        break;
      }
      case SUB.getCurve: reply.set(this.curve, 2); break;
      case SUB.setCurve: this.curve = [...request.slice(2, 10)]; break;
      case SUB.getAxisType: reply.set([2, ...(() => { const max = Math.round(3.3 / this.unit); return [max & 0xff, max >> 8]; })()], 2); break;
      case SUB.getRealtimeTravel: {
        const t = Date.now() / 700 + request[2]! + request[3]!;
        const steps = Math.round(Math.abs(Math.sin(t)) * (3.3 / this.unit));
        reply[3] = request[2]!;
        reply[4] = request[3]!;
        reply[5] = steps & 0xff;
        reply[6] = steps >> 8;
        break;
      }
      case SUB.calibrate: this.calibration = 1; break;
      case SUB.getCalibrateState: {
        reply[3] = this.calibration;
        const keys = Math.min(ROWS * COLS, this.calibration * 40);
        for (let key = 0; key < keys; key++) reply[4 + (key >> 3)]! |= 1 << (key & 7);
        if (this.calibration > 0) this.calibration = Math.min(this.calibration + 1, 3);
        break;
      }
      default: break;
    }
    this.deliver(reply);
  }
}

/** Returns true once the fake is installed; false when the page is about to reload with the flag set. */
export function installKeychronPreview(search: string): boolean {
  const mode = keychronPreviewRequested(search);
  if (mode === null) return true;
  // HID filters read the flag when the app loads, so set it and load again once.
  if (localStorage.getItem(KEYCHRON_HALL_EFFECT_FLAG) !== "1") {
    localStorage.setItem(KEYCHRON_HALL_EFFECT_FLAG, "1");
    location.reload();
    return false;
  }
  const board = new FakeKeychronBoard(mode.layout === "v5", 15, { protocol: mode.protocol, fault: mode.fault });
  const hid = {
    getDevices: async () => board.forgotten ? [] : [board],
    requestDevice: async () => { board.forgotten = false; return [board]; },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  };
  Object.defineProperty(navigator, "hid", { value: hid, configurable: true });
  return true;
}
