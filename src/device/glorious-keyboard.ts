import { GloriousKeyboardHidClient } from "@openmouse/keyboard-protocol/drivers/glorious/hid";
import {
  GLORIOUS_LAYERS,
  GLORIOUS_MAX_MACROS,
  GLORIOUS_PROFILES,
  gloriousAnalogJob,
  gloriousBindingProblem,
  gloriousDebounceChoices,
  gloriousDebounceJob,
  gloriousDefaultState,
  gloriousDeleteMacroJob,
  gloriousKeysJob,
  gloriousLayerJob,
  gloriousMacroJob,
  gloriousMacroProblem,
  gloriousPollingChoices,
  gloriousPollingJob,
  gloriousProfileJob,
  gloriousSleepChoices,
  gloriousSleepJob,
  type GloriousBoardState,
  type GloriousJob,
  type GloriousLayerKeys,
  type GloriousMacro,
  type GloriousModel,
} from "@openmouse/keyboard-protocol/glorious";
import type { GloriousWorkspace } from "./glorious-workspace.ts";
import type { KeyboardClient } from "./keyboard-client.ts";
import type { KeyboardCommand, KeyboardWorkspace } from "./keyboard-workspace.ts";
import type { KeyboardIdentityView } from "./types.ts";

interface Stored { unlocked: boolean; state: GloriousBoardState }

/** The parts of `GloriousKeyboardHidClient` the adapter uses, so tests can stand in for it. */
export interface GloriousSender {
  readonly device: HIDDevice;
  readonly model: GloriousModel;
  open(): Promise<void>;
  close(): Promise<void>;
  send(job: GloriousJob): Promise<void>;
}

export const gloriousStorageKey = (model: GloriousModel): string =>
  `openmouse.glorious.${model.vendorId.toString(16)}:${model.productId.toString(16)}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A stored record, checked field by field: anything this board can't take
 * falls back to the default, so a damaged or hand-edited record can never be
 * turned into frames the board would not get from OpenMouse itself.
 */
export function readStoredGlorious(model: GloriousModel, raw: string | null): Stored {
  const base = gloriousDefaultState(model);
  let parsed: unknown = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  if (!isRecord(parsed) || !isRecord(parsed.state)) return { unlocked: false, state: base };
  const s = parsed.state;
  const pick = <T>(value: unknown, ok: (v: unknown) => v is T, fallback: T): T => (ok(value) ? value : fallback);
  const slot = (n: number) => (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;
  const among = (choices: readonly number[]) => (v: unknown): v is number => typeof v === "number" && choices.includes(v);
  const macros: Record<number, GloriousMacro> = {};
  if (model.macros && isRecord(s.macros)) {
    for (const [key, macro] of Object.entries(s.macros)) {
      const n = Number(key);
      if (!Number.isInteger(n) || n < 1 || n > GLORIOUS_MAX_MACROS || !isRecord(macro) || !Array.isArray(macro.events)) continue;
      const mode = macro.mode === "repeat" || macro.mode === "toggle" ? macro.mode : "once";
      const events = macro.events as GloriousMacro["events"];
      if (gloriousMacroProblem(events)) continue;
      macros[n] = { name: typeof macro.name === "string" ? macro.name.slice(0, 40) : `Macro ${n}`, mode, events };
    }
  }
  const slots = Object.keys(macros).map(Number);
  const keys = base.keys.map((profile, p) => profile.map((_, layer) => {
    const stored = Array.isArray(s.keys) && Array.isArray(s.keys[p]) ? s.keys[p][layer] : null;
    if (!isRecord(stored)) return {};
    const clean: Record<string, GloriousLayerKeys[string]> = {};
    for (const [key, binding] of Object.entries(stored)) {
      if (!isRecord(binding)) continue;
      const b = binding as unknown as GloriousLayerKeys[string];
      try {
        if (!gloriousBindingProblem(model, b, slots)) {
          gloriousKeysJob(model, { ...base, macros, profile: p, layer }, { [key]: b });
          clean[key] = b;
        }
      } catch { /* not a key this board can take */ }
    }
    return clean;
  }));
  const debounceChoices = gloriousDebounceChoices(model);
  const analog = isRecord(s.analog) ? s.analog : {};
  const state: GloriousBoardState = {
    polling: pick(s.polling, among(gloriousPollingChoices(model)), base.polling),
    profile: pick(s.profile, slot(GLORIOUS_PROFILES), 0),
    layer: pick(s.layer, slot(GLORIOUS_LAYERS), 0),
    debounce: base.debounce.map((d, p) => (debounceChoices.length && Array.isArray(s.debounce) ? pick(s.debounce[p], among(debounceChoices), d) : d)),
    sleep: pick(s.sleep, among(gloriousSleepChoices(model)), base.sleep),
    analog: {
      actuation: typeof analog.actuation === "number" ? analog.actuation : base.analog.actuation,
      rapid: typeof analog.rapid === "boolean" ? analog.rapid : base.analog.rapid,
      sensitivity: typeof analog.sensitivity === "number" ? analog.sensitivity : base.analog.sensitivity,
    },
    keys,
    macros,
  };
  if (model.protocol === "he") {
    try { gloriousAnalogJob(model, state, state.analog); } catch { state.analog = base.analog; }
  }
  return { unlocked: parsed.unlocked === true, state };
}

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/**
 * Panel-side wrapper around the Glorious driver. The keyboard reports
 * nothing back, so every change is planned from the kept record, sent, and
 * only then recorded. Nothing is written until the owner unlocks the board.
 */
export class GloriousKeyboardClient implements KeyboardClient {
  readonly family = "glorious";
  readonly brand = "Glorious";
  readonly device: HIDDevice;
  private readonly client: GloriousSender;
  private readonly store: Storage | null;
  private stored: Stored;

  constructor(device: HIDDevice, client: GloriousSender = new GloriousKeyboardHidClient(device), store: Storage | null = storage()) {
    this.device = device;
    this.client = client;
    this.store = store;
    this.stored = readStoredGlorious(client.model, store?.getItem(gloriousStorageKey(client.model)) ?? null);
  }

  static isSupported(device: HIDDevice): boolean { return GloriousKeyboardHidClient.isSupported(device); }

  get model(): GloriousModel { return this.client.model; }
  get name(): string { return this.model.name; }
  open(): Promise<void> { return this.client.open(); }
  close(): Promise<void> { return this.client.close(); }

  async readIdentity(): Promise<KeyboardIdentityView> {
    return {
      brand: this.brand, name: this.name, boardId: null, capabilities: null,
      firmwareVersion: null, appVersion: null, pcbVersion: null, serial: null,
    };
  }

  private workspace(): { glorious: GloriousWorkspace } {
    return { glorious: { model: this.model, state: this.stored.state, unlocked: this.stored.unlocked } };
  }

  private save(next: Partial<Stored>): void {
    this.stored = { ...this.stored, ...next };
    try { this.store?.setItem(gloriousStorageKey(this.model), JSON.stringify(this.stored)); } catch { /* storage full or blocked: the record lives for this session */ }
  }

  /** Sends `job` (built before anything is sent, so a refused value sends nothing) and records `state` once it went out. */
  private async write(job: GloriousJob, state: Partial<GloriousBoardState>): Promise<{ glorious: GloriousWorkspace }> {
    if (!this.stored.unlocked) throw new Error("Turn on changes for this keyboard first.");
    if (job.length) await this.client.send(job);
    this.save({ state: { ...this.stored.state, ...state } });
    return this.workspace();
  }

  async command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    const m = this.model;
    const s = this.stored.state;
    switch (command.kind) {
      case "refresh":
        return this.workspace();
      case "gloriousUnlock":
        this.save({ unlocked: command.unlocked });
        return this.workspace();
      case "gloriousPolling":
        return this.write(gloriousPollingJob(m, s, command.hz), { polling: command.hz });
      case "gloriousDebounce":
        return this.write(gloriousDebounceJob(m, s, command.ms), {
          debounce: m.protocol === "eternal" ? s.debounce.map(() => command.ms) : s.debounce.map((d, p) => (p === s.profile ? command.ms : d)),
        });
      case "gloriousSleep":
        return this.write(gloriousSleepJob(m, s, command.minutes), { sleep: command.minutes });
      case "gloriousProfile":
        return this.write(gloriousProfileJob(m, s, command.profile), { profile: command.profile });
      case "gloriousLayer":
        return this.write(gloriousLayerJob(m, s, command.layer), { layer: command.layer });
      case "gloriousAnalog":
        return this.write(gloriousAnalogJob(m, s, command.analog), { analog: command.analog });
      case "gloriousKeys": {
        const keys = s.keys.map((profile, p) => profile.map((layerKeys, layer) =>
          (p === s.profile && layer === s.layer ? command.keys : layerKeys)));
        return this.write(gloriousKeysJob(m, s, command.keys), { keys });
      }
      case "gloriousMacroSave": {
        const free = Array.from({ length: GLORIOUS_MAX_MACROS }, (_, i) => i + 1).find((n) => !(n in s.macros));
        const slot = command.slot ?? free;
        if (slot === undefined) throw new Error(`OpenMouse keeps at most ${GLORIOUS_MAX_MACROS} macros.`);
        if (command.slot !== null && !(command.slot in s.macros)) throw new Error("That macro doesn't exist.");
        const macro = { ...command.macro, name: command.macro.name.trim().slice(0, 40) || `Macro ${slot}` };
        return this.write(gloriousMacroJob(m, s, slot, macro), { macros: { ...s.macros, [slot]: macro } });
      }
      case "gloriousMacroDelete": {
        const { job, keys } = gloriousDeleteMacroJob(m, s, command.slot);
        const macros = Object.fromEntries(Object.entries(s.macros).filter(([n]) => Number(n) !== command.slot));
        return this.write(job, { keys, macros });
      }
      default:
        throw new Error("This command is not available on Glorious keyboards.");
    }
  }
}
