import type { WuqueGlobalState, WuqueKeyState, WuqueLightingState } from '@openmouse/keyboard-protocol/drivers';
import type { WuqueMacroRead, WuqueHidClient } from '@openmouse/keyboard-protocol/drivers/wuque/hid';
import type { WuqueAxisReading, WuqueHigherKey, WuqueHigherKeyWrite, WuqueKeyLayoutStyle, WuqueKeyLayoutDefault, WuqueLightingBase, WuqueLightingLed, WuqueLightingPaletteColor, WuqueMacroEvent, WuqueRgb } from '@openmouse/keyboard-protocol/wuque';

export interface KeyboardWorkspace {
  /** HB68 mode; independent of the Wuque global-settings structure. */
  systemMode?: "win" | "mac";
  global: WuqueGlobalState | null;
  lighting: WuqueLightingState | null;
  custom: readonly WuqueLightingLed[];
  shell: WuqueRgb | null;
  layer: WuqueKeyState | null;
  styles: readonly (WuqueKeyLayoutStyle | null)[];
  defaults: readonly (WuqueKeyLayoutDefault | null)[];
  macro: WuqueMacroRead | null;
  higher: WuqueHigherKey | null;
  adc: WuqueAxisReading | null;
}
/** A blank keyboard workspace, before any board data is read. */
export const emptyKeyboardWorkspace = (): KeyboardWorkspace => ({ global: null, lighting: null, custom: [], shell: null, layer: null, styles: [], defaults: [], macro: null, higher: null, adc: null });
export type KeyboardCommand =
  | { kind: 'refresh' }
  | { kind: 'system'; value: number }
  | { kind: 'sleep'; value: number }
  | { kind: 'shake'; value: boolean }
  | { kind: 'slot'; value: number }
  | { kind: 'save'; scope: 'all' | 'performance' | 'lighting' | 'layout' | 'higherKey' | 'macro' }
  | { kind: 'layer'; layer: number }
  | { kind: 'keycode'; layer: number; row: number; col: number; keycode: number }
  | { kind: 'lighting'; base: WuqueLightingBase }
  | { kind: 'palette'; colors: readonly WuqueLightingPaletteColor[] }
  | { kind: 'correction' | 'shell' | 'caps'; color: WuqueRgb }
  | { kind: 'custom' | 'direct'; leds: readonly WuqueLightingLed[] }
  | { kind: 'blackout'; value: boolean }
  | { kind: 'macroRead'; slot: number }
  | { kind: 'macroWrite'; slot: number; events: readonly WuqueMacroEvent[]; mode: number; repetitions: number; valid: boolean }
  | { kind: 'higherRead'; row: number; col: number }
  | { kind: 'higherWrite'; write: WuqueHigherKeyWrite }
  | { kind: 'adc'; row: number };

function integer(value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`Expected a whole number from 0 to ${max}.`);
}
function required<T>(value: T | null): T {
  if (value === null) throw new Error('The keyboard did not confirm this operation.');
  return value;
}
function equalColor(actual: WuqueRgb, expected: WuqueRgb): void {
  if (actual.r !== expected.r || actual.g !== expected.g || actual.b !== expected.b) throw new Error('Colour read-back did not match.');
}
function color(value: WuqueRgb): void { integer(value.r, 255); integer(value.g, 255); integer(value.b, 255); }

/** Only return data decoded from the board. Direct frames and caps have no acknowledgement. */
export async function runKeyboardCommand(client: WuqueHidClient, command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
  switch (command.kind) {
    case 'refresh': client.invalidateReadCache(); return { global: await client.readGlobalState(), lighting: await client.readLighting(), custom: await client.readLightingCustom(), shell: await client.readKeyboardColor() };
    case 'system':
      integer(command.value, 1);
      if (required(await client.writeSystemSetting(command.value)).value !== command.value || (await client.readSystemSetting())?.value !== command.value) throw new Error('System setting was not confirmed.');
      return { global: await client.readGlobalState() };
    case 'sleep':
      integer(command.value, 65535);
      if (required(await client.writeSleepTime(command.value)) !== command.value || await client.readSleepTime() !== command.value) throw new Error('Sleep time was not confirmed.');
      return { global: await client.readGlobalState() };
    case 'shake':
      if (required(await client.writeShakeOptimization(command.value)).enabled !== command.value || (await client.readShakeOptimization())?.enabled !== command.value) throw new Error('Shake optimization was not confirmed.');
      return { global: await client.readGlobalState() };
    case 'slot': await client.writeConfigSwitch(command.value); return runKeyboardCommand(client, { kind: 'refresh' });
    case 'save': { const result = required(await client.saveScope(command.scope)); const scopes = { all: 0, performance: 2, lighting: 3, layout: 4, higherKey: 5, macro: 6 }; if (result.value !== scopes[command.scope]) throw new Error('The keyboard did not confirm the save scope.'); return {}; }
    case 'layer': {
      client.invalidateReadCache();
      integer(command.layer, 3);
      const styles = []; const defaults = [];
      const system = required(await client.readSystemSetting()).value;
      for (let row = 0; row < 6; row++) {
        styles.push(await client.readKeyLayoutStyle(row));
        defaults.push(await client.readKeyLayoutDefault(system === 1 ? 1 : 0, command.layer, row));
      }
      return { layer: await client.readKeyLayout(command.layer), styles, defaults };
    }
    case 'keycode':
      integer(command.layer, 3); integer(command.row, 5); integer(command.col, 20); integer(command.keycode, 65535);
      await client.writeKeyCode(command.layer, command.row, command.col, command.keycode);
      return { layer: await client.readKeyLayout(command.layer) };
    case 'lighting': {
      const b = command.base;
      for (const v of [b.mode, b.luminance, b.speed, b.direction]) integer(v, 255);
      integer(b.selectStaticColor, 7);
      required(await client.writeLightingBase({ ...b, block: 0, open: b.open ? b.openCode || 1 : 0 }));
      const lighting = required(await client.readLighting());
      const actual = required(lighting.base);
      if (actual.open !== b.open || actual.mode !== b.mode || actual.luminance !== b.luminance || actual.speed !== b.speed || actual.direction !== b.direction || actual.selectStaticColor !== b.selectStaticColor) throw new Error('Lighting read-back did not match.');
      return { lighting };
    }
    case 'palette':
      if (command.colors.length !== 8) throw new RangeError('The palette needs eight colors.');
      command.colors.forEach(c => { color(c); integer(c.h, 255); });
      required(await client.writeLightingPalette(0, command.colors));
      { const lighting = required(await client.readLighting()); const palette = required(lighting.palette); if (palette.length !== 8) throw new Error('Palette read-back is incomplete.'); palette.forEach((c, i) => { equalColor(c, command.colors[i]!); if (c.h !== command.colors[i]!.h) throw new Error('Palette read-back did not match.'); }); return { lighting }; }
    case 'correction': color(command.color); required(await client.writeLightingColorCorrection(0, command.color)); { const lighting = required(await client.readLighting()); equalColor(required(lighting.colorCorrection), command.color); return { lighting }; }
    case 'shell': color(command.color); required(await client.writeKeyboardColor(command.color)); { const shell = required(await client.readKeyboardColor()); equalColor(shell, command.color); return { shell }; }
    case 'caps': color(command.color); await client.writeLightingCaps(command.color); return {};
    case 'blackout': await client.writeBlackout(command.value); { const global = await client.readGlobalState(); if (global.blackout !== command.value) throw new Error('Blackout read-back did not match.'); return { global }; }
    case 'custom': case 'direct':
      if (command.leds.length !== 135) throw new RangeError('Custom lighting needs 135 LEDs.');
      command.leds.forEach(color);
      if (command.kind === 'direct') { await client.writeLightingDirectDrive(0, command.leds); return {}; }
      await client.writeLightingCustom(0, command.leds);
      { const custom = await client.readLightingCustom(); if (custom.length !== command.leds.length) throw new Error('Custom LED read-back is incomplete.'); custom.forEach((c, i) => { equalColor(c, command.leds[i]!); if (Boolean(c.isCustom) !== Boolean(command.leds[i]!.isCustom)) throw new Error('Custom LED flag read-back did not match.'); }); return { custom }; }
    case 'macroRead': client.invalidateReadCache(); integer(command.slot, 15); return { macro: required(await client.readMacro(command.slot, true)) };
    case 'macroWrite': {
      integer(command.slot, 15); integer(command.mode, 255); integer(command.repetitions, 65535);
      const capacity = required(await client.readMacroSpaceInfo());
      if (command.slot >= capacity.macroCount || command.events.length > capacity.macroNumber) throw new RangeError('Macro exceeds the board capacity.');
      let used = 0;
      for (let slot = 0; slot < capacity.macroCount; slot++) {
        if (slot === command.slot) continue;
        const header = required(await client.readMacroMode(slot));
        if (header.valid) used += header.actNum;
      }
      if (used + command.events.length > capacity.macroNumber) throw new RangeError('There is not enough macro space on the board.');
      command.events.forEach(e => { integer(e.status, 1); integer(e.delay, 32767); integer(e.keyCode, 65535); });
      await client.writeMacro(command.slot, command.events, { mode: command.mode, repNum: command.repetitions, valid: command.valid });
      const macro = required(await client.readMacro(command.slot, true));
      if (macro.header.actNum !== command.events.length || macro.header.mode !== command.mode || macro.header.repNum !== command.repetitions || macro.header.valid !== command.valid || macro.events.length !== command.events.length || macro.events.some((event, i) => event.status !== command.events[i]?.status || event.delay !== command.events[i]?.delay || event.keyCode !== command.events[i]?.keyCode)) throw new Error('Macro read-back did not match.');
      return { macro };
    }
    case 'higherRead': client.invalidateReadCache(); return { higher: required(await client.readHigherKey(command.row, command.col)) };
    case 'higherWrite': {
      const w = command.write;
      integer(w.row, 5); integer(w.col, 20);
      if ('keycodes' in w) w.keycodes.forEach(k => integer(k, 65535));
      if ('keycode' in w) integer(w.keycode, 65535);
      if ('time' in w) integer(w.time, 65535);
      if ('delay' in w) integer(w.delay, 65535);
      if ('travelPoints' in w) w.travelPoints.forEach(v => integer(v, 255));
      if ('deadBandsMm' in w) w.deadBandsMm.forEach(v => { if (!Number.isFinite(v) || v < 0 || v > 4) throw new RangeError('Dead zones must be 0–4 mm.'); });
      if ('row2' in w) { integer(w.row2, 5); integer(w.col2, 20); if (w.row === w.row2 && w.col === w.col2) throw new Error('Choose a different paired key.'); }
      const replies = await client.writeHigherKey(w);
      if (replies.some(r => r === null)) throw new Error('An advanced-key frame was not acknowledged.');
      const higher = required(await client.readHigherKey(w.row, w.col, w.mode));
      if (higher.mode !== w.mode) throw new Error('Advanced-key mode was not confirmed.');
      if ('row2' in w) { const partner = required(await client.readHigherKey(w.row2, w.col2, w.mode)); if (partner.mode !== w.mode) throw new Error('Paired-key mode was not confirmed.'); }
      return { higher };
    }
    case 'adc': integer(command.row, 5); return { adc: required(await client.readAxisAdc(command.row)) };
  }
}
