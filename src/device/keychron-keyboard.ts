import { KeychronHidClient } from "@openmouse/keyboard-protocol/drivers/keychron/hid";
import type { KeyboardStatus, KeychronState } from "@openmouse/keyboard-protocol/drivers";
import { KEYCHRON_WORK_MODE, keychronKeyTarget } from "@openmouse/keyboard-protocol/keychron";
import type {
  KeychronAxisType, KeychronCalibrationState, KeychronCurve, KeychronKeyPosition, KeychronProfileBuffer,
} from "@openmouse/keyboard-protocol/keychron";
import type { KeyboardClient } from "./keyboard-client.ts";
import type { KeyboardCommand, KeyboardWorkspace } from "./keyboard-workspace.ts";
import type { KeyboardIdentityView } from "./types.ts";
import { travelToSteps } from "./keychron-travel.ts";
import { curveInRange, curveScale } from "./keychron-curve.ts";
import { loadKeychronLayout, type KeychronLayout } from "./keychron-layout.ts";
import { loadRemap, remapKey, selectRemapLayer, type KeychronRemapState } from "./keychron-remap.ts";

export interface KeychronWorkspace {
  status: KeyboardStatus;
  /** The active profile as the board last reported it. */
  profile: KeychronProfileBuffer | null;
  curve: KeychronCurve | null;
  axis: KeychronAxisType | null;
  calibration: KeychronCalibrationState | null;
  /**
   * What this app last asked calibration to do. The board's own state byte has
   * no documented meaning, so the panel words the state from this, not from it.
   */
  calibrationPhase: "idle" | "started" | "stopped";
  /** Physical key boxes, or a plain grid of the matrix when the board's layout is unknown. */
  layout: KeychronLayout;
  /** Layer 0 keycodes by [row][col], when the board's keymap could be read; they label the keys. */
  keymap: readonly (readonly number[])[] | null;
  /** Key remapping: the selected layer's keymap, the keycode context and the last result. */
  remap: KeychronRemapState;
  /** Last live reading of one key, in profile steps. */
  keyTravel: { row: number; col: number; steps: number } | null;
  /**
   * Values written with setTravel that have not been saved yet. The board is
   * not read back after setTravel, so these are what was sent, not confirmed.
   */
  unsaved: { press: number; sensitivePress: number; sensitiveRelease: number } | null;
}

export type KeychronKeyboardCommand =
  | { kind: "keychronSelectProfile"; slot: number }
  | { kind: "keychronRename"; slot: number; name: string }
  | {
    kind: "keychronSetTravel";
    /** Rapid trigger sends Launcher's quick-trigger work mode; otherwise the static one. */
    rapidTrigger: boolean;
    /** Omit to apply to every key; otherwise only these keys. */
    keys?: readonly KeychronKeyPosition[];
    pressMm: number;
    sensitivePressMm: number;
    sensitiveReleaseMm: number;
  }
  | { kind: "keychronSave" }
  | { kind: "keychronClear"; confirmed: true }
  | { kind: "keychronWriteCurve"; curve: KeychronCurve }
  | { kind: "keychronKeyTravel"; row: number; col: number }
  | { kind: "keychronSelectLayer"; layer: number }
  | { kind: "keychronRemap"; layer: number; row: number; col: number; code: number; confirmed?: boolean; restore?: boolean }
  | { kind: "keychronDismissRemap" }
  | { kind: "keychronCalibration"; action: "start"; confirmed: true }
  | { kind: "keychronCalibration"; action: "stop" | "read" };

const isKeychronCommand = (command: KeyboardCommand): command is KeychronKeyboardCommand =>
  command.kind.startsWith("keychron");

const sameCurve = (a: KeychronCurve, b: KeychronCurve): boolean =>
  a.every((point, index) => point[0] === b[index]![0] && point[1] === b[index]![1]);

/**
 * Panel-side wrapper over the Keychron Hall-effect driver. The protocol is
 * derived from Keychron Launcher and has not been run on a physical board, so
 * nothing here reports a write as hardware-verified. Travel is staged with
 * `setTravel` and only persisted by an explicit save.
 */
export class KeychronKeyboardClient implements KeyboardClient {
  readonly family = "keychron" as const;
  readonly brand = "Keychron";
  get name(): string { return this.device.productName || "Keychron keyboard"; }
  readonly device: HIDDevice;
  private readonly client: KeychronHidClient;
  private state: KeychronWorkspace | null = null;
  private recovered: Partial<KeyboardWorkspace> | null = null;

  constructor(device: HIDDevice) { this.device = device; this.client = new KeychronHidClient(device); }
  static isSupported(device: HIDDevice): boolean { return KeychronHidClient.isSupported(device); }
  open(): Promise<void> { return this.client.open(); }
  close(): Promise<void> { return this.client.close(); }

  async readIdentity(): Promise<KeyboardIdentityView> {
    const status = await this.client.readStatus();
    return {
      brand: status.brand, name: status.name, boardId: null, capabilities: null,
      firmwareVersion: status.firmwareVersion, appVersion: null, pcbVersion: null, serial: status.serial,
    };
  }

  private current(): KeychronWorkspace {
    if (!this.state) throw new Error("Read the keyboard before changing it.");
    return this.state;
  }

  private publish(next: KeychronWorkspace): Partial<KeyboardWorkspace> {
    this.state = next;
    return { keychron: next };
  }

  private keychronState(): KeychronState {
    const state = this.current().status.keychron;
    if (!state) throw new Error("The keyboard did not report its Hall-effect layout.");
    return state;
  }

  /** State to show after a command failed: the controller asks once, right after the error. */
  recoveredWorkspace(): Partial<KeyboardWorkspace> | null {
    const recovered = this.recovered;
    this.recovered = null;
    return recovered;
  }

  /** Publish a new remap state; layer 0 also labels the keys on the actuation map. */
  private publishRemap(remap: KeychronRemapState): Partial<KeyboardWorkspace> {
    const current = this.current();
    return this.publish({ ...current, remap, keymap: remap.layer === 0 && remap.keymap ? remap.keymap : current.keymap });
  }

  /** Optional reads must not block the rest of the panel when a board lacks them. */
  private async optional<T>(read: () => Promise<T>): Promise<T | null> {
    try { return await read(); } catch { return null; }
  }

  private async refresh(): Promise<Partial<KeyboardWorkspace>> {
    const status = await this.client.readStatus();
    const profile = await this.client.readProfile();
    const features = status.keychron?.features;
    const curve = await this.optional(() => this.client.readCurve());
    const axis = features?.switchAxis ? await this.optional(() => this.client.readAxisType()) : null;
    const layout = await loadKeychronLayout(this.device.productId, status.keychron?.rows ?? 0, status.keychron?.cols ?? 0);
    // A board that ignores VIA leaves remapping unavailable and the keymap null;
    // keys are then labelled by row and column.
    const remap = await loadRemap(this.client, 0, this.state?.remap ?? null);
    return this.publish({
      status, profile, curve, axis, layout, keymap: remap.keymap, remap, calibration: this.state?.calibration ?? null,
      calibrationPhase: this.state?.calibrationPhase ?? "idle", keyTravel: this.state?.keyTravel ?? null, unsaved: this.state?.unsaved ?? null,
    });
  }

  /** A successful write followed by a failed read leaves the previous profile unsafe to edit. */
  private async refreshAfterWrite(): Promise<Partial<KeyboardWorkspace>> {
    try { return await this.refresh(); }
    catch (error) {
      this.state = null;
      this.recovered = { keychron: null };
      throw error;
    }
  }

  async command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    if (command.kind === "refresh") return this.refresh();
    if (!isKeychronCommand(command)) throw new Error("This command is only for a different keyboard brand.");
    switch (command.kind) {
      case "keychronSelectProfile":
        if (this.current().unsaved) throw new Error("Save or discard the unsaved travel change before switching profile.");
        await this.client.selectProfile(command.slot);
        return this.refreshAfterWrite();
      case "keychronRename":
        // renameProfile saves the active profile, which would also persist a staged travel change.
        if (this.current().unsaved) throw new Error("Save or discard the unsaved travel change before renaming.");
        await this.client.renameProfile(command.slot, command.name);
        return this.refreshAfterWrite();
      case "keychronSetTravel": {
        const steps = travelToSteps(this.keychronState(), command);
        const target = keychronKeyTarget(command.keys);
        await this.client.setTravel({
          workMode: command.rapidTrigger ? KEYCHRON_WORK_MODE.quickTrigger : KEYCHRON_WORK_MODE.static,
          press: steps.press,
          ...(command.rapidTrigger ? { sensitivePress: steps.sensitivePress, sensitiveRelease: steps.sensitiveRelease } : {}),
          ...target,
        });
        return this.publish({ ...this.current(), unsaved: { press: steps.press, sensitivePress: steps.sensitivePress, sensitiveRelease: steps.sensitiveRelease } });
      }
      case "keychronSave": {
        if (!this.current().unsaved) throw new Error("There is no travel change to save.");
        await this.client.saveProfile();
        this.state = { ...this.current(), unsaved: null };
        return this.refreshAfterWrite();
      }
      case "keychronClear":
        if (command.confirmed !== true) throw new Error("Clearing a profile needs confirmation.");
        await this.client.clearProfile();
        this.state = { ...this.current(), unsaved: null };
        return this.refreshAfterWrite();
      case "keychronWriteCurve": {
        const { maxX } = curveScale(this.keychronState(), this.current().axis?.maxMm ?? null);
        if (!curveInRange(command.curve, maxX)) throw new RangeError(`Curve points need x from 0 to ${maxX} in rising order and y from 0 to 127.`);
        await this.client.writeCurve(command.curve);
        const confirmed = await this.client.readCurve();
        if (!sameCurve(confirmed, command.curve)) {
          this.recovered = this.publish({ ...this.current(), curve: confirmed });
          throw new Error("The keyboard reported a different response curve after the write.");
        }
        return this.publish({ ...this.current(), curve: confirmed });
      }
      case "keychronSelectLayer":
        return this.publishRemap(await selectRemapLayer(this.client, this.current().remap, command.layer));
      case "keychronDismissRemap":
        return this.publishRemap({ ...this.current().remap, warning: null });
      case "keychronRemap": {
        const outcome = await remapKey(this.client, this.current().remap, command);
        const published = this.publishRemap(outcome.state);
        if (outcome.error) {
          // The controller drops the update when a command throws, so hand it the real state separately.
          this.recovered = published;
          throw outcome.error;
        }
        return published;
      }
      case "keychronKeyTravel": {
        const { rows, cols } = this.keychronState();
        if (!Number.isInteger(command.row) || command.row < 0 || command.row >= rows
          || !Number.isInteger(command.col) || command.col < 0 || command.col >= cols) {
          throw new RangeError("That key is outside the keyboard's matrix.");
        }
        const steps = await this.client.readKeyTravel(command.row, command.col);
        return this.publish({ ...this.current(), keyTravel: { row: command.row, col: command.col, steps } });
      }
      case "keychronCalibration":
        if (command.action === "start") {
          if (command.confirmed !== true) throw new Error("Starting calibration needs confirmation.");
          await this.client.startCalibration();
          this.state = { ...this.current(), calibrationPhase: "started" };
        } else if (command.action === "stop") {
          await this.client.stopCalibration();
          // The board sends no reply to stop, so the last known state is not refreshed.
          return this.publish({ ...this.current(), calibration: null, calibrationPhase: "stopped" });
        }
        try {
          return this.publish({ ...this.current(), calibration: await this.client.readCalibration() });
        } catch (error) {
          if (command.action === "start") this.recovered = { keychron: this.current() };
          throw error;
        }
    }
  }
}
