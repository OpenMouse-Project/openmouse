/**
 * A whole mouse setup in one short code: HITS tuning, Bunny Hop, the five button
 * assignments and the DPI stages. Every part is optional, and a part the mouse
 * lacks is left out. Like a HITS code it carries values only, with a checksum so
 * a mistyped code is refused.
 */
import { BUNNY_HOP_LIMITS, LOGITECH_BUTTON_ACTIONS, type LogitechButtonBinding } from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import { checksum, fromBase64Url, presetFits, toBase64Url, type HitsPreset } from "./hits-presets.ts";

export interface SetupCode {
  hits?: Pick<HitsPreset, "left" | "right">;
  /** 0 is off. */
  bunnyHopMs?: number;
  /** Slots 0 to 4 (left, right, wheel, back, forward); null leaves a slot alone. */
  buttons?: (LogitechButtonBinding | null)[];
  dpiStages?: number[];
}

const PREFIX = "SETUP1-";
const SLOTS = 5;
const MAX_DPI_STAGES = 5;
const MAX_DPI = 45_000;
const HITS_LIMITS = { maxActuation: 63, maxRapidTrigger: 63, maxHaptics: 63 };

const HITS = 1;
const BUNNY = 2;
const BUTTONS = 4;
const DPI = 8;

/** The binding a stored assignment holds, or null for one that cannot be shared (macros, unknown records). */
export function bindingFromAssignment(action: string, raw: readonly number[]): LogitechButtonBinding | null {
  if (action !== "Custom") {
    return (LOGITECH_BUTTON_ACTIONS as readonly string[]).includes(action)
      ? { kind: "action", action: action as (typeof LOGITECH_BUTTON_ACTIONS)[number] }
      : null;
  }
  if (raw[0] === 0x80 && raw[1] === 0x02) return { kind: "keyboard", modifiers: raw[2] ?? 0, key: raw[3] ?? 0 };
  if (raw[0] === 0x80 && raw[1] === 0x03) return { kind: "consumer", usage: ((raw[2] ?? 0) << 8) | (raw[3] ?? 0) };
  return null;
}

export function encodeSetupCode(setup: SetupCode): string {
  const flags = (setup.hits ? HITS : 0) | (setup.bunnyHopMs !== undefined ? BUNNY : 0)
    | (setup.buttons ? BUTTONS : 0) | (setup.dpiStages?.length ? DPI : 0);
  const bytes = [1, flags];
  if (setup.hits) {
    for (const side of [setup.hits.left, setup.hits.right]) {
      bytes.push(side.actuation, side.rapidTrigger, side.haptics, side.rapidTriggerEnabled ? 1 : 0);
    }
  }
  if (setup.bunnyHopMs !== undefined) bytes.push(setup.bunnyHopMs >> 8, setup.bunnyHopMs & 0xff);
  if (setup.buttons) {
    for (let slot = 0; slot < SLOTS; slot += 1) {
      const binding = setup.buttons[slot];
      if (!binding) bytes.push(0, 0, 0);
      else if (binding.kind === "action") bytes.push(1, LOGITECH_BUTTON_ACTIONS.indexOf(binding.action), 0);
      else if (binding.kind === "keyboard") bytes.push(2, binding.modifiers, binding.key);
      else bytes.push(3, binding.usage >> 8, binding.usage & 0xff);
    }
  }
  if (setup.dpiStages?.length) {
    bytes.push(setup.dpiStages.length);
    for (const dpi of setup.dpiStages) bytes.push(dpi >> 8, dpi & 0xff);
  }
  bytes.push(checksum(bytes));
  return PREFIX + toBase64Url(bytes);
}

/** Null for anything that is not a well-formed, checksum-correct setup code with in-range values. */
export function decodeSetupCode(text: string): SetupCode | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  const bytes = fromBase64Url(trimmed.slice(PREFIX.length));
  if (!bytes || bytes.length < 3 || bytes[0] !== 1) return null;
  if (checksum(bytes.slice(0, -1)) !== bytes[bytes.length - 1]) return null;
  const body = bytes.slice(0, -1);
  const flags = body[1];
  if (flags === 0 || flags > (HITS | BUNNY | BUTTONS | DPI)) return null;
  let at = 2;
  const take = (count: number): number[] | null => {
    if (at + count > body.length) return null;
    at += count;
    return body.slice(at - count, at);
  };
  const setup: SetupCode = {};

  if (flags & HITS) {
    const raw = take(8);
    if (!raw) return null;
    const side = (offset: number) => ({ actuation: raw[offset], rapidTrigger: raw[offset + 1], haptics: raw[offset + 2], rapidTriggerEnabled: raw[offset + 3] === 1 });
    if (raw[3] > 1 || raw[7] > 1) return null;
    const hits = { left: side(0), right: side(4) };
    if (!presetFits(hits, HITS_LIMITS)) return null;
    setup.hits = hits;
  }
  if (flags & BUNNY) {
    const raw = take(2);
    if (!raw) return null;
    const ms = (raw[0] << 8) | raw[1];
    if (ms !== 0 && (ms < BUNNY_HOP_LIMITS.minMs || ms > BUNNY_HOP_LIMITS.maxMs)) return null;
    setup.bunnyHopMs = ms;
  }
  if (flags & BUTTONS) {
    const buttons: (LogitechButtonBinding | null)[] = [];
    for (let slot = 0; slot < SLOTS; slot += 1) {
      const raw = take(3);
      if (!raw) return null;
      if (raw[0] === 0) buttons.push(null);
      else if (raw[0] === 1) {
        const action = LOGITECH_BUTTON_ACTIONS[raw[1]];
        if (!action) return null;
        buttons.push({ kind: "action", action });
      } else if (raw[0] === 2) buttons.push({ kind: "keyboard", modifiers: raw[1], key: raw[2] });
      else if (raw[0] === 3) buttons.push({ kind: "consumer", usage: (raw[1] << 8) | raw[2] });
      else return null;
    }
    setup.buttons = buttons;
  }
  if (flags & DPI) {
    const count = take(1)?.[0];
    if (!count || count > MAX_DPI_STAGES) return null;
    const raw = take(count * 2);
    if (!raw) return null;
    const stages = Array.from({ length: count }, (_, index) => (raw[index * 2] << 8) | raw[index * 2 + 1]);
    if (stages.some((dpi) => dpi < 50 || dpi > MAX_DPI)) return null;
    setup.dpiStages = stages;
  }
  return at === body.length ? setup : null;
}

/** One line per part, for showing what a code holds before it is applied. */
export function describeSetup(setup: SetupCode): string[] {
  const lines: string[] = [];
  if (setup.hits) lines.push("HITS tuning for both buttons");
  if (setup.bunnyHopMs !== undefined) lines.push(setup.bunnyHopMs === 0 ? "Bunny Hop off" : `Bunny Hop ${setup.bunnyHopMs} ms`);
  if (setup.buttons) lines.push(`${setup.buttons.filter(Boolean).length} button assignments`);
  if (setup.dpiStages) lines.push(`DPI stages ${setup.dpiStages.join(", ")}`);
  return lines;
}
