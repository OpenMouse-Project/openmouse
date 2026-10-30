import type { KeychronHidClient } from "@openmouse/keyboard-protocol/drivers/keychron/hid";
import type { KeychronKeycodeContext } from "@openmouse/keyboard-protocol/keychron";

export type KeychronKeymap = readonly (readonly number[])[];

export interface KeychronRemapWarning {
  layer: number;
  row: number;
  col: number;
  code: number;
  warnings: readonly string[];
}

export interface KeychronRemapResult {
  kind: "ok" | "failed";
  layer: number;
  row: number;
  col: number;
  /** The keycode that was requested. */
  code: number;
  /** The rejection message when it failed. */
  message: string | null;
}

export interface KeychronRemapState {
  /** Why remapping is off (the board ignores the VIA reads), or null when it works. */
  unavailable: string | null;
  protocol: number | null;
  /** Protocol version and the board's own custom keys, for legends and the picker. */
  context: Required<KeychronKeycodeContext>;
  layerCount: number;
  layer: number;
  /** Keycodes of the selected layer as the board last reported them. */
  keymap: KeychronKeymap | null;
  /** The keycode a key had before this session changed it, by "layer:row:col". */
  originals: Readonly<Record<string, number>>;
  /** Set when a write was held back until the user confirms its warnings. */
  warning: KeychronRemapWarning | null;
  result: KeychronRemapResult | null;
}

export interface KeychronRemapRequest {
  layer: number;
  row: number;
  col: number;
  code: number;
  /** The user confirmed the warnings shown for this exact change. */
  confirmed?: boolean;
  /** This change puts back the original code of the key. */
  restore?: boolean;
}

export const remapKeyId = (layer: number, row: number, col: number): string => `${layer}:${row}:${col}`;

export const emptyRemap = (unavailable: string | null): KeychronRemapState => ({
  unavailable, protocol: null, context: { protocol: 12, custom: [] }, layerCount: 0, layer: 0, keymap: null,
  originals: {}, warning: null, result: null,
});

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch { return null; }
}

/**
 * Read what remapping needs: the VIA protocol version, the board's keycode
 * context, the layer count and one layer's keymap. A board that ignores VIA
 * leaves remapping unavailable with the reason, instead of throwing.
 */
export async function loadRemap(client: KeychronHidClient, layer: number, previous: KeychronRemapState | null): Promise<KeychronRemapState> {
  try {
    await client.readViaProtocol();
    const context = await client.keycodeContext();
    const layerCount = await client.readLayerCount();
    const target = Math.min(Math.max(0, layer), Math.max(0, layerCount - 1));
    const keymap = await client.readKeymap(target);
    return {
      unavailable: null, protocol: context.protocol, context, layerCount, layer: target, keymap,
      originals: previous?.originals ?? {}, warning: null, result: null,
    };
  } catch (error) {
    return { ...emptyRemap(messageOf(error)), originals: previous?.originals ?? {} };
  }
}

export async function selectRemapLayer(client: KeychronHidClient, state: KeychronRemapState, layer: number): Promise<KeychronRemapState> {
  if (state.unavailable) throw new Error(state.unavailable);
  if (!Number.isInteger(layer) || layer < 0 || layer >= state.layerCount) throw new RangeError("That layer does not exist on this keyboard.");
  const keymap = await client.readKeymap(layer);
  return { ...state, layer, keymap, warning: null, result: null };
}

/**
 * Set one key. Warnings (for example replacing the only layer key on a layer)
 * hold the write until the same request comes back confirmed. A write counts as
 * done only when `setKeycode` resolved, which reads the key back; the keymap is
 * then re-read. When it rejects the keymap is re-read too, so the map shows the
 * board's real state, and the error is returned for the caller to raise.
 */
export async function remapKey(
  client: KeychronHidClient, state: KeychronRemapState, request: KeychronRemapRequest,
): Promise<{ state: KeychronRemapState; error: Error | null }> {
  if (state.unavailable) throw new Error(state.unavailable);
  const { layer, row, col, code } = request;
  if (layer !== state.layer) throw new RangeError("Select that layer before changing its keys.");
  const previous = state.keymap?.[row]?.[col];
  if (previous === undefined) throw new RangeError("That key is not in the keymap.");
  const warnings = await client.remapWarnings(layer, row, col, code);
  if (warnings.length > 0 && !request.confirmed) {
    return { state: { ...state, warning: { layer, row, col, code, warnings }, result: null }, error: null };
  }
  try {
    const confirmed = await client.setKeycode(layer, row, col, code);
    const reread = await attempt(() => client.readKeymap(layer));
    // The read-back inside setKeycode proved this key even if the full re-read failed.
    const keymap = reread ?? state.keymap!.map((line, r) => (r === row ? line.map((value, c) => (c === col ? confirmed : value)) : line));
    const originals = { ...state.originals };
    const id = remapKeyId(layer, row, col);
    if (request.restore || originals[id] === confirmed) delete originals[id];
    else if (!(id in originals)) originals[id] = previous;
    return { state: { ...state, keymap, originals, warning: null, result: { kind: "ok", layer, row, col, code: confirmed, message: null } }, error: null };
  } catch (error) {
    const reread = await attempt(() => client.readKeymap(layer));
    return {
      state: { ...state, keymap: reread ?? state.keymap, warning: null, result: { kind: "failed", layer, row, col, code, message: messageOf(error) } },
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
