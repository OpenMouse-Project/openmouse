import type { MchoseKeyboardHidClient } from "@openmouse/keyboard-protocol/drivers/mchose/hid";
import { MCHOSE_CONFIG_USAGE, MCHOSE_CONFIG_USAGE_PAGE, mchoseProduct } from "@openmouse/keyboard-protocol/mchose";
import type { MchoseAction, MchoseAdvancedTable, MchoseProduct } from "@openmouse/keyboard-protocol/mchose";
import type { MchoseAdvancedBinding, MchoseWorkspace } from "./mchose-workspace.ts";
import type { KeyboardClient, KeyboardKeyReport } from "./keyboard-client.ts";
import type { KeyboardCommand, KeyboardWorkspace } from "./keyboard-workspace.ts";
import type { KeyboardIdentityView } from "./types.ts";
import { mchoseKeymapChanges, mchoseTravelRestore } from "./mchose-profile-file.ts";

/*
 * Only the product catalog is imported up front: this module sits in the main
 * bundle for device detection, and everything else loads with the driver.
 * These mirror MCHOSE_ACTION_TYPE, ADVANCED_SLOTS and LAYER_COUNT.
 */
const ADVANCED_SLOTS = 32;
const LAYER_COUNT = 4;

/** Keymap action type and slot table of each advanced-key kind. */
const ADVANCED: Record<MchoseAdvancedBinding["kind"], { type: number; table: MchoseAdvancedTable }> = {
  dks: { type: 0x90, table: "dks" },
  modTap: { type: 0x92, table: "modTap" },
  toggle: { type: 0x91, table: "toggle" },
};

/** Keymap types that point into each slot table; rapid snap, SOCD and layer tap share the mod-tap slots. */
const TABLE_TYPES: Record<MchoseAdvancedTable, readonly number[]> = {
  dks: [0x90],
  toggle: [0x91],
  modTap: [0x92, 0x93, 0x94, 0x95],
};
/** Rapid snap, SOCD and layer tap: two keys, each pointing at the other in `code2`. */
const PAIR_TYPES: readonly number[] = [0x93, 0x94, 0x95];
const PAIR_TYPE = { snapTap: 0x93, socd: 0x94 } as const;
const SOCD_TYPE = 0x94;
const NO_ACTION: MchoseAction = { type: 0, code1: 0, code2: 0 };

/**
 * Panel-side wrapper around the MCHOSE HID driver. Every write is confirmed
 * by the driver's read-back. A timeout or a write the keyboard did not keep
 * leaves this client `faulted`, and the panel asks for a reconnect; a
 * rejected argument never reaches the keyboard and does not.
 */
export class MchoseKeyboardClient implements KeyboardClient {
  readonly family = "mchose";
  readonly brand = "MCHOSE";
  readonly device: HIDDevice;
  faulted = false;
  /** The HID driver loads only once an MCHOSE keyboard is in use, so it stays out of the main bundle. */
  private loaded: Promise<MchoseKeyboardHidClient> | null = null;
  private readonly product: MchoseProduct | undefined;
  private current: MchoseWorkspace | null = null;
  /** Factory keymap of every layer, for clearing a key back to its default. */
  private factory: MchoseAction[][] = [];
  private calibrating = false;
  /** Profile whose debug mode (key reports) is on, and how many hold it: a calibration and each live-depth view. */
  private debug: { profile: number; users: number } | null = null;

  constructor(device: HIDDevice) {
    this.device = device;
    this.product = MchoseKeyboardClient.productFor(device);
  }

  /** Same test as the driver's: a catalogued product on its usage-page-1, usage-0 collection. */
  private static productFor(device: HIDDevice): MchoseProduct | undefined {
    const product = mchoseProduct(device.vendorId, device.productId);
    return product && device.collections.some((c) => c.usagePage === MCHOSE_CONFIG_USAGE_PAGE && c.usage === MCHOSE_CONFIG_USAGE) ? product : undefined;
  }

  private driver(): Promise<MchoseKeyboardHidClient> {
    this.loaded ??= import("@openmouse/keyboard-protocol/drivers/mchose/hid").then(({ MchoseKeyboardHidClient }) => new MchoseKeyboardHidClient(this.device));
    return this.loaded;
  }

  get name(): string { return this.product?.name ?? (this.device.productName || "MCHOSE keyboard"); }

  static isSupported(device: HIDDevice): boolean { return MchoseKeyboardClient.productFor(device) !== undefined; }
  async open(): Promise<void> { await (await this.driver()).open(); }
  async close(): Promise<void> {
    if (!this.loaded) return;
    const driver = await this.loaded;
    // Never leave the keyboard calibrating, or streaming key reports, after the page lets go of it.
    if (!this.faulted) {
      if (this.calibrating) await driver.calibrate("end").catch(() => undefined);
      if (this.debug) await driver.setDebugMode(this.debug.profile, false).catch(() => undefined);
    }
    this.calibrating = false;
    this.debug = null;
    await driver.close();
  }

  /** Turn debug mode on for the first holder and off after the last; it belongs to the profile active at the time. */
  private async holdDebug(on: boolean): Promise<void> {
    const driver = await this.driver();
    if (on) {
      if (this.debug) { this.debug.users += 1; return; }
      this.debug = { profile: this.current?.profile ?? 0, users: 1 };
      await driver.setDebugMode(this.debug.profile, true);
    } else if (this.debug && --this.debug.users === 0) {
      const { profile } = this.debug;
      this.debug = null;
      await driver.setDebugMode(profile, false);
    }
  }

  /**
   * Key reports matched to matrix slots through the factory keymap, as the
   * vendor app does. With `depth`, debug mode stays on while watching, so
   * every key reports its travel as it moves (the vendor's key-travel page).
   */
  watchKeys(listener: (report: KeyboardKeyReport) => void, depth = false): () => void {
    let stop: (() => void) | null = null;
    let stopped = false;
    void this.driver().then((driver) => {
      if (stopped) return;
      stop = driver.onKeyReport((report) => {
        const index = (this.factory[0] ?? []).findIndex((a) => a.type === report.type && a.code1 === report.code1 && a.code2 === report.code2);
        if (index >= 0) listener({ index, travel: report.travel, calibration: report.calibration });
      });
      if (depth) void this.holdDebug(true).catch(() => undefined);
    });
    return () => {
      if (!stopped && stop && depth) void this.holdDebug(false).catch(() => undefined);
      stopped = true;
      stop?.();
    };
  }

  /** What the keyboard is known to hold after a command failed part-way (each write is recorded as it lands). */
  recoveredWorkspace(): Partial<KeyboardWorkspace> | null {
    return this.current ? { mchose: this.current } : null;
  }

  async readIdentity(): Promise<KeyboardIdentityView> {
    const status = await this.guard(async () => (await this.driver()).readStatus());
    const state = status.mchose;
    if (state && this.product) {
      this.current = {
        product: this.product,
        info: state.info,
        profile: state.base?.activeProfile ?? 0,
        profileCount: state.base?.profileCount ?? 1,
        profileNames: state.profileNames ?? [],
        layout: state.layout ?? (await import("@openmouse/keyboard-protocol/mchose")).mchoseModel(this.product.productId)!.layout,
        performance: state.performance,
        settings: state.settings ?? null,
        lighting: state.lighting ?? null,
        travel: state.travel ?? [],
        keymap: [],
        defaults: [],
        advanced: null,
        macros: null,
        colors: null,
      };
    }
    return {
      brand: status.brand, name: status.name, boardId: null, capabilities: null,
      firmwareVersion: status.firmwareVersion, appVersion: null, pcbVersion: null, serial: null,
    };
  }

  /** Everything the identity read leaves out: keymaps, advanced keys, macros and colours. */
  private async readTables(profile: number): Promise<Partial<MchoseWorkspace>> {
    const keymap: MchoseAction[][] = [];
    for (let layer = 0; layer < LAYER_COUNT; layer += 1) keymap.push(await (await this.driver()).readKeymap(profile, layer));
    if (this.factory.length === 0) {
      for (let layer = 0; layer < LAYER_COUNT; layer += 1) this.factory.push(await (await this.driver()).readDefaultKeymap(layer));
    }
    return {
      keymap,
      defaults: this.factory,
      advanced: await (await this.driver()).readAdvancedKeys(profile),
      macros: await (await this.driver()).readMacros(),
      colors: await (await this.driver()).readKeyColors(profile),
    };
  }

  async command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    return this.guard(async () => {
      switch (command.kind) {
        case "refresh": {
          // The identity read walked the profile settings on connect; a manual refresh reads them again.
          if (this.current?.keymap.length) await this.readIdentity();
          if (!this.current) await this.readIdentity();
          return { mchose: this.patch(await this.readTables(this.require().profile)) };
        }
        case "mchoseReset": {
          const { profile, profileCount } = this.require();
          const driver = await this.driver();
          // Names live in the custom area, which the reset keeps; the vendor app clears them, so do that first.
          const names = command.scope === "all" ? Array.from({ length: profileCount }, (_, n) => n) : [profile];
          for (const n of names) if (this.current?.profileNames[n]) this.patch({ profileNames: await driver.setProfileName(n, "") });
          await driver.factoryReset(command.scope === "all" ? "all" : profile);
          // The keyboard reboots and comes back as a new device; the controller reconnects it.
          this.debug = null;
          this.calibrating = false;
          this.faulted = true;
          return {};
        }
        case "mchoseTravel": {
          const { profile } = this.require();
          return { mchose: this.patch({ travel: await (await this.driver()).setKeyTravel(profile, command.updates) }) };
        }
        case "mchosePolling": {
          const { profile } = this.require();
          return { mchose: this.patch({ performance: await (await this.driver()).setPollingRate(profile, command.hz) }) };
        }
        case "mchoseWinLock": {
          const { profile, settings } = this.require();
          const performance = await (await this.driver()).setWinLock(profile, command.locked);
          return { mchose: this.patch({ performance, settings: settings && { ...settings, lockWin: performance.lockWin } }) };
        }
        case "mchoseSettings": {
          const { profile } = this.require();
          const settings = await (await this.driver()).setSettings(profile, command.settings);
          return { mchose: this.patch({ settings, performance: await (await this.driver()).readPerformance(profile) }) };
        }
        case "mchoseLighting": {
          const { profile } = this.require();
          return { mchose: this.patch({ lighting: await (await this.driver()).setLighting(profile, command.lighting) }) };
        }
        case "mchoseKeyColors": {
          const { profile } = this.require();
          return { mchose: this.patch({ colors: await (await this.driver()).setKeyColors(profile, command.updates) }) };
        }
        case "mchoseImport": {
          const { file } = command;
          const state = this.require();
          const { profile } = state;
          const driver = await this.driver();
          if (file.productId !== state.product.productId) throw new RangeError("This profile file is for another keyboard.");
          // Settings and lighting first, then travel, then the advanced-key slots the new keymap points at, then the keymap.
          // Each write is recorded as it lands, so a failure part-way leaves the panel showing what the keyboard holds.
          this.patch({ settings: await driver.setSettings(profile, file.settings) });
          if (file.pollingHz && state.product.pollingRatesHz.includes(file.pollingHz)) this.patch({ performance: await driver.setPollingRate(profile, file.pollingHz) });
          this.patch({ lighting: await driver.setLighting(profile, file.lighting) });
          this.patch({ travel: await driver.setKeyTravel(profile, state.layout.map(({ index }) => mchoseTravelRestore(index, file.travel[index]!))) });
          const slots = (types: readonly number[]): Set<number> => new Set(file.keymap.flat().filter((action) => types.includes(action.type)).map((action) => action.code1));
          for (const slot of slots(TABLE_TYPES.dks)) if (file.advanced.dks[slot]) await driver.setDks(profile, slot, file.advanced.dks[slot]!);
          for (const slot of slots(TABLE_TYPES.modTap)) if (file.advanced.modTap[slot]) await driver.setModTap(profile, slot, file.advanced.modTap[slot]!);
          for (const slot of slots(TABLE_TYPES.toggle)) if (file.advanced.toggle[slot]) await driver.setToggle(profile, slot, file.advanced.toggle[slot]!);
          const before = state.keymap;
          const changes = mchoseKeymapChanges(before, file.keymap);
          for (let layer = 0; layer < changes.length; layer += 1) {
            if (changes[layer]!.length) this.patch({ keymap: this.withLayer(layer, await driver.setKeymap(profile, layer, changes[layer]!)) });
          }
          this.patch({ performance: await driver.readPerformance(profile) });
          await this.releaseUnusedSlots(before);
          const colors = state.colors ?? [];
          const colorUpdates = file.colors.flatMap((color, index) => {
            const now = colors[index];
            return now && now.r === color.r && now.g === color.g && now.b === color.b ? [] : [{ index, color }];
          });
          this.patch({
            advanced: await driver.readAdvancedKeys(profile),
            ...(colorUpdates.length ? { colors: await driver.setKeyColors(profile, colorUpdates) } : {}),
            ...(file.name && file.name !== state.profileNames[profile] ? { profileNames: await driver.setProfileName(profile, file.name) } : {}),
          });
          return { mchose: this.require() };
        }
        case "mchoseKeymap": {
          const { profile } = this.require();
          const before = this.require().keymap;
          // Replacing one key of a pair also returns its partner to its factory action.
          const updates = this.withPartnerRestores(command.layer, command.updates);
          await this.resetSocdPriority(command.layer, updates.map((update) => update.index));
          const layer = await (await this.driver()).setKeymap(profile, command.layer, updates);
          const keymap = this.withLayer(command.layer, layer);
          this.patch({ keymap });
          await this.releaseUnusedSlots(before);
          return { mchose: this.require() };
        }
        case "mchoseMacros":
          return { mchose: this.patch({ macros: await (await this.driver()).setMacros(command.macros) }) };
        case "mchoseAdvanced":
          return { mchose: await this.bindAdvanced(command.layer, command.index, command.binding) };
        case "mchosePair":
          return { mchose: await this.bindPair(command.layer, command.first, command.second, command.pair, command.priority ?? 0) };
        case "mchoseAdvancedClear": {
          const action = this.factoryAction(command.layer, command.index);
          return this.command({ kind: "mchoseKeymap", layer: command.layer, updates: [{ index: command.index, action }] });
        }
        case "mchoseProfile": {
          const base = await (await this.driver()).setActiveProfile(command.profile);
          const profile = base.activeProfile;
          // Debug mode lives in each profile's config: move it along so key reports keep coming.
          if (this.debug && this.debug.profile !== profile) {
            await (await this.driver()).setDebugMode(this.debug.profile, false);
            this.debug.profile = profile;
            await (await this.driver()).setDebugMode(profile, true);
          }
          this.patch({
            profile,
            profileCount: base.profileCount,
            performance: await (await this.driver()).readPerformance(profile),
            settings: await (await this.driver()).readSettings(profile),
            lighting: await (await this.driver()).readLighting(profile),
            travel: await (await this.driver()).readKeyTravel(profile),
          });
          return { mchose: this.patch(await this.readTables(profile)) };
        }
        case "mchoseProfileName":
          return { mchose: this.patch({ profileNames: await (await this.driver()).setProfileName(command.profile, command.name) }) };
        case "mchoseCalibrate": {
          // Like the vendor app, calibration runs with debug mode on so each key reports its progress.
          const driver = await this.driver();
          if (command.step === "start") {
            if (!this.calibrating) await this.holdDebug(true);
            this.calibrating = true;
            await driver.calibrate("start");
          } else if (command.step === "end") {
            await driver.calibrate("end");
            if (this.calibrating) await this.holdDebug(false);
            this.calibrating = false;
          } else await driver.calibrate("restart");
          return {};
        }
        default:
          throw new Error("This command is not available on MCHOSE keyboards.");
      }
    });
  }

  private withLayer(layer: number, actions: readonly MchoseAction[]): MchoseAction[][] {
    return this.require().keymap.map((entries, index) => (index === layer ? [...actions] : [...entries]));
  }

  private factoryAction(layer: number, index: number): MchoseAction {
    return this.factory[layer]?.[index] ?? NO_ACTION;
  }

  /** Slots of `table` some key of this profile still points at. */
  private usedSlots(table: MchoseAdvancedTable, keymap: readonly (readonly MchoseAction[])[] = this.require().keymap): Set<number> {
    const types = TABLE_TYPES[table];
    return new Set(keymap.flat().filter((action) => types.includes(action.type)).map((action) => action.code1));
  }

  /** `updates` plus a factory restore for the partner of every pair key they replace. */
  private withPartnerRestores(layer: number, updates: readonly { index: number; action: MchoseAction }[]): { index: number; action: MchoseAction }[] {
    const actions = this.require().keymap[layer] ?? [];
    const next = [...updates];
    for (const { index } of updates) {
      const current = actions[index];
      if (!current || !PAIR_TYPES.includes(current.type)) continue;
      const partner = current.code2;
      const partnerAction = actions[partner];
      if (partnerAction && partnerAction.type === current.type && partnerAction.code2 === index && !next.some((u) => u.index === partner)) {
        next.push({ index: partner, action: this.factoryAction(layer, partner) });
      }
    }
    return next;
  }

  /** SOCD keys keep their rule in the travel priority; clear it when they stop being SOCD keys. */
  private async resetSocdPriority(layer: number, indexes: readonly number[]): Promise<void> {
    const { profile, keymap, travel } = this.require();
    const socd = indexes.filter((index) => keymap[layer]?.[index]?.type === SOCD_TYPE && (travel[index]?.priority ?? 0) !== 0);
    if (socd.length === 0) return;
    this.patch({ travel: await (await this.driver()).setKeyTravel(profile, socd.map((index) => ({ index, priority: 0 }))) });
  }

  /** What a key sends inside a pair: its own mapping when it is a plain action, else its factory action. */
  private sendAction(layer: number, index: number): MchoseAction {
    const state = this.require();
    const current = state.keymap[layer]?.[index];
    if (current && current.type !== 0 && current.type < 0x90) return current;
    // A key already in a pair keeps the tap stored in its mod-tap slot.
    const stored = current && PAIR_TYPES.includes(current.type) ? state.advanced?.modTap[current.code1]?.tap : undefined;
    if (stored && stored.type !== 0) return stored;
    const factory = this.factoryAction(layer, index);
    return factory.type !== 0 ? factory : this.factoryAction(0, index);
  }

  /**
   * Pair two keys as rapid snap or SOCD. Each key gets a mod-tap slot holding
   * both keys' actions (its own first) and points at its partner. SOCD keys
   * also carry the rule in their travel priority, mirrored on the second key.
   */
  private async bindPair(layer: number, first: number, second: number, pair: "snapTap" | "socd", priority: number): Promise<MchoseWorkspace> {
    const state = this.require();
    const actions = state.keymap[layer] ?? [];
    if (first === second || !actions[first] || !actions[second]) throw new RangeError("Choose two different keys.");
    if (pair === "socd" && (!Number.isInteger(priority) || priority < 0 || priority > 3)) throw new RangeError("SOCD rule must be 0-3.");
    const type = PAIR_TYPE[pair];
    const key1 = this.sendAction(layer, first);
    const key2 = this.sendAction(layer, second);
    // Keys that leave an older pair free their partners; a pair rebound as itself keeps its slots.
    const updates = this.withPartnerRestores(layer, [{ index: first, action: NO_ACTION }, { index: second, action: NO_ACTION }]);
    const samePair = actions[first]!.type === type && actions[first]!.code2 === second && actions[second]!.type === type && actions[second]!.code2 === first;
    const freed = new Set(updates.map((u) => u.index));
    const remaining = state.keymap.map((entries, n) => (n === layer ? entries.map((a, i) => (freed.has(i) ? NO_ACTION : a)) : entries));
    const used = this.usedSlots("modTap", remaining);
    const free = Array.from({ length: ADVANCED_SLOTS }, (_, n) => n).filter((n) => !used.has(n));
    const [slotA, slotB] = samePair ? [actions[first]!.code1, actions[second]!.code1] : [free[0], free[1]];
    if (slotA === undefined || slotB === undefined) throw new RangeError(`Rapid snap, SOCD and mod-tap share ${ADVANCED_SLOTS} slots; two free slots are needed.`);
    const driver = await this.driver();
    // Partners of older pairs lose their SOCD rule before their keymap entry changes.
    await this.resetSocdPriority(layer, updates.map((u) => u.index).filter((i) => i !== first && i !== second));
    await driver.setModTap(state.profile, slotA, { tap: key1, hold: key2 });
    await driver.setModTap(state.profile, slotB, { tap: key2, hold: key1 });
    const before = state.keymap;
    const pairUpdates = updates.map((u) => (u.index === first ? { index: first, action: { type, code1: slotA, code2: second } }
      : u.index === second ? { index: second, action: { type, code1: slotB, code2: first } } : u));
    const layerActions = await driver.setKeymap(state.profile, layer, pairUpdates);
    this.patch({ keymap: this.withLayer(layer, layerActions) });
    const travel = this.require().travel;
    const priorities = pair === "socd"
      ? [{ index: first, priority }, { index: second, priority: priority === 1 ? 2 : priority === 2 ? 1 : priority }]
      : [first, second].filter((i) => (travel[i]?.priority ?? 0) !== 0 && before[layer]?.[i]?.type === SOCD_TYPE).map((index) => ({ index, priority: 0 }));
    if (priorities.length > 0) this.patch({ travel: await driver.setKeyTravel(state.profile, priorities) });
    await this.releaseUnusedSlots(before);
    return this.patch({ advanced: await driver.readAdvancedKeys(state.profile) });
  }

  /**
   * Store the advanced key in a slot, then point the key at it. A key that
   * already uses this kind keeps its slot; otherwise the first slot no key
   * uses is taken. A slot the key leaves behind is cleared once nothing uses it.
   */
  private async bindAdvanced(layer: number, index: number, binding: MchoseAdvancedBinding): Promise<MchoseWorkspace> {
    const state = this.require();
    const { type, table } = ADVANCED[binding.kind];
    const currentAction = state.keymap[layer]?.[index];
    if (!currentAction) throw new RangeError(`Key ${index} on layer ${layer} is outside the keymap.`);
    const used = this.usedSlots(table);
    // Keep the key's own slot only when it is valid and no other key points at it too.
    const sharers = state.keymap.flat().filter((action) => TABLE_TYPES[table].includes(action.type) && action.code1 === currentAction.code1).length;
    let slot = currentAction.type === type && currentAction.code1 < ADVANCED_SLOTS && sharers === 1 ? currentAction.code1 : -1;
    if (slot < 0) slot = Array.from({ length: ADVANCED_SLOTS }, (_, n) => n).find((n) => !used.has(n)) ?? -1;
    if (slot < 0) throw new RangeError(`All ${ADVANCED_SLOTS} ${table} slots are in use.`);
    let code2 = 0;
    if (binding.kind === "dks") await (await this.driver()).setDks(state.profile, slot, binding.dks);
    if (binding.kind === "toggle") await (await this.driver()).setToggle(state.profile, slot, binding.action);
    if (binding.kind === "modTap") {
      code2 = Math.round(binding.holdMs / 10);
      if (code2 < 1 || code2 > 255) throw new RangeError("Hold time must be 10-2550 ms.");
      await (await this.driver()).setModTap(state.profile, slot, binding.entry);
    }
    const before = state.keymap;
    const updates = this.withPartnerRestores(layer, [{ index, action: { type, code1: slot, code2 } }]);
    await this.resetSocdPriority(layer, updates.map((u) => u.index));
    const layerActions = await (await this.driver()).setKeymap(state.profile, layer, updates);
    this.patch({ keymap: this.withLayer(layer, layerActions) });
    await this.releaseUnusedSlots(before);
    return this.patch({ advanced: await (await this.driver()).readAdvancedKeys(state.profile) });
  }

  /** Clear advanced-key slots that `before` used and the current keymap no longer does. */
  private async releaseUnusedSlots(before: readonly (readonly MchoseAction[])[]): Promise<void> {
    const { profile } = this.require();
    let changed = false;
    for (const table of Object.keys(TABLE_TYPES) as MchoseAdvancedTable[]) {
      const now = this.usedSlots(table);
      for (const slot of this.usedSlots(table, before)) {
        if (now.has(slot) || slot >= ADVANCED_SLOTS) continue;
        await (await this.driver()).clearSlot(profile, table, slot);
        changed = true;
      }
    }
    if (changed) this.patch({ advanced: await (await this.driver()).readAdvancedKeys(profile) });
  }

  private require(): MchoseWorkspace {
    if (!this.current) throw new Error("Read the keyboard before changing it.");
    return this.current;
  }

  private patch(update: Partial<MchoseWorkspace>): MchoseWorkspace {
    this.current = { ...this.require(), ...update };
    return this.current;
  }

  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof RangeError)) this.faulted = true;
      throw error;
    }
  }
}

