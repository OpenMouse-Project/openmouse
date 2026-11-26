import { clamp, hexToHsv, hsvToHex } from "../shared/color-math.ts";
import {
  decodeViaMacro, encodeViaMacro, viaEventCodeFromKeycode, viaKeycodeFromEventCode, VIA_MACRO_MAX_DELAY_MS, type ViaMacroAction, parseViaMacroExpression, viaActiveKeys, viaKeycodeFromLayoutName, viaKeycodeToLayoutName, viaMacroToExpression,
  parseViaDefinition, viaVendorProductId, type ViaDefinition, joinViaMacros, parseViaMenus, viaLayoutChoices, viaPackLayoutChoices, type ViaMenu, type ViaMenuItem } from "@openmouse/keyboard-protocol/via";
import { ViaHidClient, type ViaMacros } from "@openmouse/keyboard-protocol/drivers/via/hid";
import { type KeyboardStatus } from "@openmouse/keyboard-protocol/drivers";
import { type KeyboardClient } from "./keyboard-client.ts";
import { type KeyboardCommand, type KeyboardWorkspace } from "./keyboard-workspace.ts";
import { type KeyboardIdentityView } from "./types.ts";

/** VIA stores a colour as hue and saturation, each 0 to 255; brightness is a separate setting, so value is 1 here. */
export const viaColorToHex = (hue: number, saturation: number): string =>
  hsvToHex({ hue: (clamp(hue, 0, 255) / 255) * 360, saturation: clamp(saturation, 0, 255) / 255, value: 1 });

export function hexToViaColor(hex: string): { hue: number; saturation: number } {
  const { hue, saturation } = hexToHsv(hex);
  return { hue: Math.round((hue / 360) * 255) % 256, saturation: Math.round(saturation * 255) };
}

const BASE_URL = "https://usevia.app/definitions";
const CACHE_PREFIX = "openmouse.via-definition.";

export function viaDefinitionUrl(vendorId: number, productId: number, version: "v3" | "v2" = "v3"): string {
  return `${BASE_URL}/${version}/${viaVendorProductId(vendorId, productId)}.json`;
}

function readCache(id: number): string | null {
  try { return localStorage.getItem(CACHE_PREFIX + id); } catch { return null; }
}

function writeCache(id: number, text: string): void {
  try { localStorage.setItem(CACHE_PREFIX + id, text); } catch { /* storage blocked or full */ }
}

function parse(text: string): ViaDefinition | null {
  try { return parseViaDefinition(JSON.parse(text)); } catch { return null; }
}

/**
 * The VIA layout definition for a board, or null when VIA has none. usevia.app
 * answers a missing definition with its HTML page and status 200, so "not found"
 * means the body is not a valid definition. A network failure falls back to the
 * last good copy and only throws when there is none.
 */
export async function loadViaDefinition(vendorId: number, productId: number, fetchImpl: typeof fetch = fetch): Promise<ViaDefinition | null> {
  const id = viaVendorProductId(vendorId, productId);
  try {
    // Newer boards have a v3 file; about 1,500 older ones have only the v2 file, which parses the same way.
    for (const version of ["v3", "v2"] as const) {
      const response = await fetchImpl(viaDefinitionUrl(vendorId, productId, version));
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`VIA definition request failed (${response.status}).`);
      const text = await response.text();
      const definition = parse(text);
      if (definition) {
        writeCache(id, text);
        return definition;
      }
    }
    return null;
  } catch (error) {
    const cached = readCache(id);
    const definition = cached === null ? null : parse(cached);
    if (definition) return definition;
    throw error;
  }
}

export const VIA_BACKUP_FORMAT = "openmouse-via-backup";

export interface ViaBackup {
  format: typeof VIA_BACKUP_FORMAT;
  version: 1;
  /** Name of the board's VIA definition when the file was saved. */
  name: string;
  /** `vendorId * 65536 + productId`, the same key VIA uses. */
  vendorProductId: number;
  matrix: { rows: number; cols: number };
  /** ISO 8601 time the file was saved. */
  savedAt: string;
  /** `rows * cols` keycodes per layer, row-major. */
  layers: number[][];
  /** Raw bytes per macro slot; null when the board had no macro memory. */
  macros: number[][] | null;
  /** One choice per layout label; empty when the board has none. */
  layoutOptions: number[];
  /** `[counter-clockwise, clockwise]` per encoder per layer; absent in files saved before encoders were supported. */
  encoders?: number[][][];
}

export type ViaBackupProblem = "board" | "matrix" | "layers" | "macros";

export function createViaBackup(via: ViaWorkspace, device: { vendorId: number; productId: number }, now = new Date()): ViaBackup | null {
  if (!via.definition || !via.keymap) return null;
  return {
    format: VIA_BACKUP_FORMAT,
    version: 1,
    name: via.definition.name,
    vendorProductId: device.vendorId * 65536 + device.productId,
    matrix: { ...via.definition.matrix },
    savedAt: now.toISOString(),
    layers: via.keymap.map((layer) => [...layer]),
    macros: via.macros ? via.macros.macros.map((slot) => [...slot]) : null,
    layoutOptions: via.definition.labels.map((_, index) => via.layoutChoices[index] ?? 0),
    ...(via.encoders ? { encoders: via.encoders.map((layer) => layer.map((pair) => [...pair])) } : {}),
  };
}

const isInteger = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= low && value <= high;
const isIntegerList = (value: unknown, low: number, high: number): value is number[] =>
  Array.isArray(value) && value.every((entry) => isInteger(entry, low, high));

/** Parses and validates a backup file; throws when it is not one this app wrote. */
export function parseViaBackup(text: string): ViaBackup {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("not json"); }
  if (typeof raw !== "object" || raw === null) throw new Error("not an object");
  const file = raw as Record<string, unknown>;
  const matrix = file.matrix as { rows?: unknown; cols?: unknown } | undefined;
  if (file.format !== VIA_BACKUP_FORMAT || file.version !== 1) throw new Error("wrong format");
  if (!isInteger(file.vendorProductId, 0, 0xffffffff) || typeof file.name !== "string" || typeof file.savedAt !== "string") throw new Error("bad header");
  if (!matrix || !isInteger(matrix.rows, 1, 255) || !isInteger(matrix.cols, 1, 255)) throw new Error("bad matrix");
  const perLayer = matrix.rows * matrix.cols;
  if (!Array.isArray(file.layers) || file.layers.length === 0 || file.layers.length > 32) throw new Error("bad layers");
  if (!file.layers.every((layer) => isIntegerList(layer, 0, 0xffff) && layer.length === perLayer)) throw new Error("bad layer");
  const macros = file.macros;
  if (macros !== null && !(Array.isArray(macros) && macros.length <= 64 && macros.every((slot) => isIntegerList(slot, 1, 0xff)))) throw new Error("bad macros");
  if (!isIntegerList(file.layoutOptions, 0, 31)) throw new Error("bad layout options");
  const encoders = file.encoders;
  if (encoders !== undefined && !(Array.isArray(encoders) && encoders.length <= 32 && encoders.every((layer) => Array.isArray(layer) && layer.length <= 16 && layer.every((pair) => isIntegerList(pair, 0, 0xffff) && pair.length === 2)))) {
    throw new Error("bad encoders");
  }
  return {
    format: VIA_BACKUP_FORMAT,
    version: 1,
    name: file.name,
    vendorProductId: file.vendorProductId,
    matrix: { rows: matrix.rows, cols: matrix.cols },
    savedAt: file.savedAt,
    layers: file.layers as number[][],
    macros: macros as number[][] | null,
    layoutOptions: file.layoutOptions,
    ...(encoders ? { encoders: encoders as number[][][] } : {}),
  };
}

/** Why a backup cannot be restored to this board, or null when it can. */
export function viaBackupProblem(backup: ViaBackup, via: ViaWorkspace, device: { vendorId: number; productId: number }): ViaBackupProblem | null {
  if (backup.vendorProductId !== device.vendorId * 65536 + device.productId) return "board";
  if (!via.definition || !via.keymap) return "matrix";
  if (backup.matrix.rows !== via.definition.matrix.rows || backup.matrix.cols !== via.definition.matrix.cols) return "matrix";
  if (backup.layers.length > via.keymap.length) return "layers";
  if (backup.macros && (!via.macros || backup.macros.length !== via.macros.count)) return "macros";
  return null;
}

export function viaBackupFileName(backup: ViaBackup): string {
  const slug = backup.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "keyboard";
  return `${slug}-keymap.json`;
}

/** The layout file VIA itself saves and loads (*.layout.json): keycodes by name, macros as expressions, encoders as [ccw, cw] per layer. */
export interface ViaLayoutFile {
  name: string;
  vendorProductId: number;
  layers: string[][];
  macros?: string[];
  encoders?: [string, string][][];
}

export function createViaLayoutFile(via: ViaWorkspace, device: { vendorId: number; productId: number }): ViaLayoutFile | null {
  if (!via.definition || !via.keymap) return null;
  const name = (code: number): string => viaKeycodeToLayoutName(code, via.protocolVersion);
  const encoders = via.encoders;
  return {
    name: via.definition.name,
    vendorProductId: device.vendorId * 65536 + device.productId,
    macros: via.macros ? via.macros.macros.map((slot) => viaMacroToExpression(decodeViaMacro(slot, via.protocolVersion), via.protocolVersion)) : [],
    layers: via.keymap.map((layer) => layer.map(name)),
    encoders: encoders?.[0] ? encoders[0].map((_, id) => encoders.map((layer) => [name(layer[id]![0]), name(layer[id]![1])] as [string, string])) : [],
  };
}

export const viaLayoutFileName = (file: ViaLayoutFile): string =>
  `${file.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase() || "keyboard"}.layout.json`;

/** Turns a VIA layout file into a restorable backup; throws when a name or macro cannot be understood. */
export function viaBackupFromLayoutFile(text: string, via: ViaWorkspace, now = new Date()): ViaBackup {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("not json"); }
  const file = raw as Partial<ViaLayoutFile> | null;
  if (!file || typeof file.name !== "string" || !isInteger(file.vendorProductId, 0, 0xffffffff) || !Array.isArray(file.layers) || file.layers.length === 0 || file.layers.length > 32) {
    throw new Error("not a layout file");
  }
  if (!via.definition) throw new Error("no definition");
  const { rows, cols } = via.definition.matrix;
  const code = (entry: unknown): number => {
    const found = typeof entry === "string" ? viaKeycodeFromLayoutName(entry, via.protocolVersion) : null;
    if (found === null) throw new Error("unknown keycode");
    return found;
  };
  const layers = file.layers.map((layer) => {
    if (!Array.isArray(layer) || layer.length !== rows * cols) throw new Error("wrong layer size");
    return layer.map(code);
  });
  // Skipping macros that do not line up would leave keys pointing at the wrong ones, so refuse the file instead.
  if (via.macros && Array.isArray(file.macros) && file.macros.length > 0 && file.macros.length !== via.macros.count) throw new Error("macro count mismatch");
  const macros = via.macros && Array.isArray(file.macros) && file.macros.length === via.macros.count
    ? file.macros.map((expression) => encodeViaMacro(parseViaMacroExpression(String(expression), via.protocolVersion), via.protocolVersion))
    : null;
  const perEncoder = file.encoders;
  const encoders = Array.isArray(perEncoder) && perEncoder.length > 0
    ? layers.map((_, layer) => perEncoder.map((entry) => [code(entry?.[layer]?.[0]), code(entry?.[layer]?.[1])]))
    : undefined;
  return {
    format: VIA_BACKUP_FORMAT,
    version: 1,
    name: file.name,
    vendorProductId: file.vendorProductId,
    matrix: { rows, cols },
    savedAt: now.toISOString(),
    layers,
    macros,
    layoutOptions: via.definition.labels.map((_, index) => via.layoutChoices[index] ?? 0),
    ...(encoders ? { encoders } : {}),
  };
}

/** Pauses shorter than this are the natural gap between keystrokes, not something to replay. */
const RECORD_MIN_GAP_MS = 100;

/** Adds one host key event to a macro being recorded; keys VIA has no basic keycode for are skipped. */
export function viaRecordKey(
  actions: readonly ViaMacroAction[],
  event: { down: boolean; code: string; gapMs: number },
  delays: boolean,
): ViaMacroAction[] {
  const keycode = viaKeycodeFromEventCode(event.code);
  if (keycode === null) return [...actions];
  const wait: ViaMacroAction[] = delays && actions.length > 0 && event.gapMs >= RECORD_MIN_GAP_MS
    ? [{ type: "delay", ms: Math.min(Math.round(event.gapMs), VIA_MACRO_MAX_DELAY_MS) }] : [];
  return [...actions, ...wait, { type: event.down ? "down" : "up", keycode }];
}

/** Folds a key pressed and released straight away into one tap, which is how people expect a typed key to read. */
export function viaTidyRecording(actions: readonly ViaMacroAction[]): ViaMacroAction[] {
  const tidy: ViaMacroAction[] = [];
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index]!;
    const next = actions[index + 1];
    if (action.type === "down" && next?.type === "up" && next.keycode === action.keycode) {
      tidy.push({ type: "tap", keycode: action.keycode });
      index++;
    } else {
      tidy.push(action);
    }
  }
  return tidy;
}

/** A layout-map-like lookup: navigator.keyboard.getLayoutMap() gives one. */
export interface ViaLayoutMap { get(eventCode: string): string | undefined }

/** The legend the user's OS layout prints on a basic key (Z on a QWERTZ board), or null to keep the QMK name. */
export function viaOsLegend(keycode: number, layout: ViaLayoutMap | null): string | null {
  const eventCode = layout && keycode <= 0xff ? viaEventCodeFromKeycode(keycode) : null;
  const legend = eventCode ? layout?.get(eventCode) : undefined;
  return legend && [...legend].length === 1 ? legend.toUpperCase() : null;
}

export type ViaKeyboardCommand =
  | { kind: "viaSetKey"; layer: number; row: number; col: number; keycode: number }
  /** `verify` is false for buttons, which have nothing to read back. */
  /** `exact` is for sliders: if the board stores less than asked (it rounds down), retry once to land on the target. */
  | { kind: "viaSetValue"; ids: readonly number[]; value: readonly number[]; verify: boolean; exact?: boolean }
  /** Replaces the keymap, layout options and (when given) all macros from a backup file. */
  | { kind: "viaRestore"; layers: readonly (readonly number[])[]; macros: readonly (readonly number[])[] | null; layoutOptions: readonly number[]; encoders?: readonly (readonly (readonly number[])[])[] }
  | { kind: "viaSetEncoder"; layer: number; id: number; clockwise: boolean; keycode: number }
  /** One choice per layout label, in the definition's label order. */
  | { kind: "viaSetLayout"; choices: readonly number[] }
  /** Every macro's bytes, in slot order: the board stores them as one shared buffer. */
  | { kind: "viaWriteMacros"; macros: readonly (readonly number[])[] };

export const viaValueKey = (ids: readonly number[]): string => ids.join(":");

/** The one-id address old firmware (protocol 10 and older) uses for the lighting a v2 definition names, plus any slot after `[channel, id]`; null when `ids` apply. */
const legacyWire = (item: ViaMenuItem, protocol: number): readonly number[] | null =>
  protocol < 11 && item.legacyId !== undefined ? [item.legacyId, ...item.ids.slice(2)] : null;
/** A colour is two bytes (hue, saturation) whatever the definition says. */
export const viaItemLength = (item: ViaMenuItem): number => (item.control.type === "color" ? 2 : item.bytes);

export interface ViaWorkspace {
  protocolVersion: number;
  layerCount: number;
  definition: ViaDefinition | null;
  /** Why there is no definition: VIA has none for this board, or it could not be downloaded. */
  definitionError: "notFound" | "offline" | null;
  /** The chosen option per layout label, read from the board. */
  layoutChoices: readonly number[];
  /** `rows * cols` keycodes per layer, row-major. Null until a definition gives the matrix. */
  keymap: readonly (readonly number[])[] | null;
  /** The definition's custom menus (lighting and the like), as drawable controls. */
  menus: readonly ViaMenu[];
  /** Current bytes per menu value, keyed by `viaValueKey(ids)`; null where the board would not answer. */
  values: Readonly<Record<string, readonly number[] | null>>;
  /** The board's macro memory, one raw byte array per slot; null when it has none. */
  macros: ViaMacros | null;
  /** [counter-clockwise, clockwise] keycodes per encoder per layer; null when the board has no encoders. */
  encoders: readonly (readonly (readonly [number, number])[])[] | null;
}

interface ViaDependencies {
  hid?: ViaHidClient;
  loadDefinition?: typeof loadViaDefinition;
}

export class ViaKeyboardClient implements KeyboardClient {
  readonly family = "via" as const;
  readonly brand = "VIA";
  readonly device: HIDDevice;
  private readonly client: ViaHidClient;
  private readonly loadDefinition: typeof loadViaDefinition;
  private workspace: ViaWorkspace | null = null;
  private cachedDefinition: ViaDefinition | null = null;

  constructor(device: HIDDevice, dependencies: ViaDependencies = {}) {
    this.device = device;
    this.client = dependencies.hid ?? new ViaHidClient(device);
    this.loadDefinition = dependencies.loadDefinition ?? loadViaDefinition;
  }

  get name(): string { return this.cachedDefinition?.name ?? (this.device.productName || "VIA keyboard"); }
  static isSupported(device: HIDDevice): boolean { return ViaHidClient.isSupported(device); }
  open(): Promise<void> { return this.client.open(); }
  close(): Promise<void> { return this.client.close(); }

  private async definition(): Promise<ViaDefinition | null> {
    if (this.cachedDefinition) return this.cachedDefinition;
    this.cachedDefinition = await this.loadDefinition(this.device.vendorId, this.device.productId);
    return this.cachedDefinition;
  }

  async readIdentity(): Promise<KeyboardIdentityView> {
    const status = await this.client.readStatus();
    const definition = await this.definition().catch(() => null);
    return {
      brand: status.brand, name: definition?.name ?? status.name, boardId: null, capabilities: null,
      firmwareVersion: status.firmwareVersion, appVersion: null, pcbVersion: null, serial: null,
    };
  }

  async command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    if (command.kind === "refresh") return this.load();
    if (command.kind === "viaSetKey") return this.setKey(command.layer, command.row, command.col, command.keycode);
    if (command.kind === "viaSetValue") return this.setValue(command.ids, command.value, command.verify, command.exact);
    if (command.kind === "viaWriteMacros") return this.writeMacros(command.macros);
    if (command.kind === "viaSetLayout") return this.setLayout(command.choices);
    if (command.kind === "viaRestore") return this.restore(command.layers, command.macros, command.layoutOptions, command.encoders);
    if (command.kind === "viaSetEncoder") return this.setEncoder(command.layer, command.id, command.clockwise, command.keycode);
    throw new Error("This command is only for VIA keyboards.");
  }

  private async load(): Promise<Partial<KeyboardWorkspace>> {
    const status: KeyboardStatus = await this.client.readStatus();
    const via = status.via;
    const layerCount = via?.layerCount ?? 0;
    let definition: ViaDefinition | null = null;
    let definitionError: ViaWorkspace["definitionError"] = null;
    try {
      definition = await this.definition();
      if (!definition) definitionError = "notFound";
    } catch {
      definitionError = "offline";
    }
    const layoutChoices = definition && via?.layoutOptions != null ? viaLayoutChoices(definition.labels, via.layoutOptions) : [];
    const keymap = definition && layerCount > 0 ? await this.client.readKeymap(definition.matrix, layerCount) : null;
    const menus = definition ? parseViaMenus(definition.menus) : [];
    const values = await this.readMenuValues(menus, via?.protocolVersion ?? 0);
    const macros = (via?.macroCount ?? 0) > 0 ? await this.client.readMacros().catch(() => null) : null;
    const encoders = definition ? await this.readEncoders(definition, layoutChoices, layerCount) : null;
    this.workspace = { protocolVersion: via?.protocolVersion ?? 0, layerCount, definition, definitionError, layoutChoices, keymap, menus, values, macros, encoders };
    return { vendorStatus: status, via: this.workspace };
  }

  /** Encoders are numbered by the definition (ei); a board without them, or one that refuses to answer, simply has none. */
  private async readEncoders(definition: ViaDefinition, choices: readonly number[], layerCount: number): Promise<ViaWorkspace["encoders"]> {
    const count = Math.max(-1, ...viaActiveKeys(definition, choices).filter((key) => key.row < 0 && key.encoder !== undefined).map((key) => key.encoder!)) + 1;
    if (count === 0 || layerCount === 0) return null;
    try {
      const layers: [number, number][][] = [];
      for (let layer = 0; layer < layerCount; layer++) {
        const encoders: [number, number][] = [];
        for (let id = 0; id < count; id++) {
          encoders.push([await this.client.readEncoder(layer, id, false), await this.client.readEncoder(layer, id, true)]);
        }
        layers.push(encoders);
      }
      return layers;
    } catch {
      return null;
    }
  }

  private async readMenuValues(menus: readonly ViaMenu[], protocol: number): Promise<Record<string, readonly number[] | null>> {
    const values: Record<string, readonly number[] | null> = {};
    for (const item of menus.flatMap((menu) => menu.sections.flatMap((section) => section.items))) {
      const key = viaValueKey(item.ids);
      if (key in values || item.control.type === "button") continue;
      values[key] = await this.client.readCustomValue(legacyWire(item, protocol) ?? item.ids, viaItemLength(item)).catch(() => null);
    }
    return values;
  }

  private async setValue(ids: readonly number[], value: readonly number[], verify: boolean, exact = false): Promise<Partial<KeyboardWorkspace>> {
    const current = this.workspace;
    if (!current) throw new Error("The VIA settings are not loaded.");
    const item = current.menus.flatMap((menu) => menu.sections.flatMap((section) => section.items)).find((entry) => viaValueKey(entry.ids) === viaValueKey(ids));
    const legacy = item ? legacyWire(item, current.protocolVersion) : null;
    const wire = legacy ?? ids;
    let confirmed = await this.client.setCustomValue(wire, value, verify);
    if (verify && exact && value.length === 1 && confirmed[0] !== value[0]) {
      // Some boards store one less than asked, so a step of 1 would never move. Ask for the difference on top, keep whichever is closer.
      const target = value[0]!;
      const retry = target + (target - confirmed[0]!);
      if (retry >= 0 && retry <= 0xff) {
        const second = await this.client.setCustomValue(wire, [retry], true);
        confirmed = Math.abs(second[0]! - target) <= Math.abs(confirmed[0]! - target) ? second : await this.client.setCustomValue(wire, value, true);
      }
    }
    await this.client.saveCustomChannel(ids[0]!, legacy !== null);
    if (!verify) return {};
    this.workspace = { ...current, values: { ...current.values, [viaValueKey(ids)]: [...confirmed] } };
    return { via: this.workspace };
  }

  private async restore(
    layers: readonly (readonly number[])[],
    macros: readonly (readonly number[])[] | null,
    layoutOptions: readonly number[],
    encoders?: readonly (readonly (readonly number[])[])[],
  ): Promise<Partial<KeyboardWorkspace>> {
    const current = this.workspace;
    if (!current?.definition || !current.keymap) throw new Error("The VIA keymap is not loaded.");
    if (macros) {
      if (!current.macros || macros.length !== current.macros.count) throw new RangeError("The backup's macros do not match this keyboard.");
      joinViaMacros(macros, current.macros.bufferSize);
    }
    await this.client.writeKeymap(layers, current.definition.matrix);
    if (layoutOptions.length > 0) await this.client.setLayoutOptions(viaPackLayoutChoices(current.definition.labels, layoutOptions));
    if (macros) await this.client.writeMacros(macros);
    // Only as many encoders as this board has: a file from a board with more would otherwise write past the end.
    for (const [layer, perLayer] of (encoders ?? []).entries()) {
      for (const [id, pair] of perLayer.entries()) {
        if (layer >= current.layerCount || id >= (current.encoders?.[0]?.length ?? 0)) continue;
        await this.client.setEncoder(layer, id, false, pair[0]!);
        await this.client.setEncoder(layer, id, true, pair[1]!);
      }
    }
    return this.load();
  }

  private async setLayout(choices: readonly number[]): Promise<Partial<KeyboardWorkspace>> {
    const current = this.workspace;
    if (!current?.definition) throw new Error("The VIA layout is not loaded.");
    const { labels } = current.definition;
    const confirmed = await this.client.setLayoutOptions(viaPackLayoutChoices(labels, choices));
    this.workspace = { ...current, layoutChoices: viaLayoutChoices(labels, confirmed) };
    return { via: this.workspace };
  }

  private async writeMacros(macros: readonly (readonly number[])[]): Promise<Partial<KeyboardWorkspace>> {
    const current = this.workspace;
    if (!current?.macros) throw new Error("The VIA macros are not loaded.");
    await this.client.writeMacros(macros);
    this.workspace = { ...current, macros: await this.client.readMacros() };
    return { via: this.workspace };
  }

  private async setEncoder(layer: number, id: number, clockwise: boolean, keycode: number): Promise<Partial<KeyboardWorkspace>> {
    const current = this.workspace;
    const pair = current?.encoders?.[layer]?.[id];
    if (!current || !current.encoders || !pair) throw new RangeError("That encoder does not exist.");
    const confirmed = await this.client.setEncoder(layer, id, clockwise, keycode);
    const next: [number, number] = clockwise ? [pair[0], confirmed] : [confirmed, pair[1]];
    this.workspace = { ...current, encoders: current.encoders.map((perLayer, at) => at === layer ? perLayer.map((entry, index) => index === id ? next : entry) : perLayer) };
    return { via: this.workspace };
  }

  /** Switches held down right now, one bit mask per matrix row. Reads without touching the workspace so it can be polled. */
  async probeKeys(): Promise<readonly number[]> {
    const matrix = this.workspace?.definition?.matrix;
    if (!matrix) return [];
    return this.client.readSwitchMatrix(matrix.rows, matrix.cols);
  }

  private async setKey(layer: number, row: number, col: number, keycode: number): Promise<Partial<KeyboardWorkspace>> {
    const current = this.workspace;
    if (!current?.definition || !current.keymap) throw new Error("The VIA keymap is not loaded.");
    const { rows, cols } = current.definition.matrix;
    if (layer < 0 || layer >= current.keymap.length || row < 0 || row >= rows || col < 0 || col >= cols) {
      throw new RangeError("That key is outside the keyboard's matrix.");
    }
    const confirmed = await this.client.setKeycode(layer, row, col, keycode);
    const index = row * cols + col;
    this.workspace = {
      ...current,
      keymap: current.keymap.map((keys, at) => at === layer ? keys.map((code, position) => position === index ? confirmed : code) : keys),
    };
    return { via: this.workspace };
  }
}
