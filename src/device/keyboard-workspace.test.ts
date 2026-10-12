import assert from 'node:assert/strict';
import test from 'node:test';
import type { WuqueHidClient } from '@openmouse/keyboard-protocol/drivers/wuque/hid';
import { runKeyboardCommand } from './keyboard-workspace.ts';

const client = (methods: Partial<WuqueHidClient>) => methods as WuqueHidClient;

test('invalid keycode and LED frames are rejected before any write', async () => {
  let writes = 0;
  const board = client({ writeKeyCode: async () => { writes++; return true; }, writeLightingCustom: async () => { writes++; return true; } });
  await assert.rejects(runKeyboardCommand(board, { kind: 'keycode', layer: 0, row: 1, col: 0, keycode: 65536 }), RangeError);
  await assert.rejects(runKeyboardCommand(board, { kind: 'custom', leds: [] }), RangeError);
  assert.equal(writes, 0);
});

test('macro capacity includes actions in the other slots, before writing the header', async () => {
  let writes = 0;
  const board = client({ readMacroSpaceInfo: async () => ({ macroCount: 2, macroNumber: 2 }), readMacroMode: async macroId => ({ macroId, valid: true, actNum: 2, mode: 0, repNum: 0 }), writeMacro: async () => { writes++; return true; } });
  await assert.rejects(runKeyboardCommand(board, { kind: 'macroWrite', slot: 0, mode: 0, repetitions: 0, valid: true, events: [{ status: 1, delay: 0, keyCode: 4 }] }), /not enough macro space/);
  assert.equal(writes, 0);
});

test('a macro mismatch never becomes a successful snapshot update', async () => {
  const board = client({ readMacroSpaceInfo: async () => ({ macroCount: 1, macroNumber: 960 }), writeMacro: async () => true, readMacro: async () => ({ header: { macroId: 0, valid: true, actNum: 1, mode: 0, repNum: 0 }, events: [{ status: 1, delay: 0, keyCode: 5 }] }) });
  await assert.rejects(runKeyboardCommand(board, { kind: 'macroWrite', slot: 0, mode: 0, repetitions: 0, valid: true, events: [{ status: 1, delay: 0, keyCode: 4 }] }), /read-back did not match/);
});

test('direct-drive frames return no confirmed colour state', async () => {
  let calls = 0;
  const board = client({ writeLightingDirectDrive: async () => { calls++; } });
  assert.deepEqual(await runKeyboardCommand(board, { kind: 'direct', leds: Array.from({ length: 135 }, () => ({ r: 0, g: 0, b: 0 })) }), {});
  assert.equal(calls, 1);
});

test('flash saves require the requested scope echo', async () => {
  await assert.rejects(runKeyboardCommand(client({ saveScope: async () => ({ key: 'layout', value: 4 }) }), { kind: 'save', scope: 'lighting' }), /save scope/);
});

test('an incomplete paired-key acknowledgement is not reported as applied', async () => {
  const board = client({ writeHigherKey: async () => [{ row: 1, col: 0, mode: 7, row2: 1, col2: 1, keycodes: [4, 7], delay: 0 }, null] });
  await assert.rejects(runKeyboardCommand(board, { kind: 'higherWrite', write: { row: 1, col: 0, row2: 1, col2: 1, mode: 7, keycodes: [4, 7], delay: 0 } }), /not acknowledged/);
});
