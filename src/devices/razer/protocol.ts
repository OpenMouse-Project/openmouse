/**
 * Razer control protocol: 90-byte feature reports exchanged on report ID 0.
 *
 * Razer does not declare this report in its HID descriptor, so the collection
 * carries no feature report of its own; the exchange still succeeds because
 * WebHID does not validate report IDs against the descriptor. The control
 * interface is the one whose only collection is Generic Desktop Mouse.
 */

export const RAZER_REPORT_ID = 0;
export const RAZER_PACKET_LENGTH = 90;

/** Verified against Viper V3 Pro firmware 1.12 on both transports. */
export const RAZER_TRANSACTION_ID = 0x1f;

/**
 * Razer's older configuration interfaces answer on a different transaction id,
 * and a mismatch is silent: the mouse simply never replies. OpenRazer uses this
 * one for the DeathAdder Essential family.
 */
export const RAZER_TRANSACTION_ID_LEGACY = 0x3f;

const ARGS_OFFSET = 8;
const CHECKSUM_INDEX = 88;
const CHECKSUM_FIRST = 2;
const CHECKSUM_LAST = 88;
const STAGE_OFFSET = 3;
const STAGE_LENGTH = 7;
const BATTERY_SCALE = 255;

export const RAZER_STATUS = {
  busy: 0x01,
  ok: 0x02,
  failure: 0x03,
  timeout: 0x04,
  unsupported: 0x05,
} as const;

export interface RazerCommand {
  commandClass: number;
  commandId: number;
  dataSize: number;
  args?: readonly number[];
}

/**
 * Razer selects a value store per command. Firmware 1.12 reports the same DPI
 * from either store, and writes were confirmed against this one, so reads and
 * writes both use it rather than risking a stale read from the other.
 */
const RAZER_STORAGE = 0x01;

/** Read-only commands confirmed against Viper V3 Pro firmware 1.12. */
export const RAZER_READ = {
  firmware: { commandClass: 0x00, commandId: 0x81, dataSize: 0x02 },
  serial: { commandClass: 0x00, commandId: 0x82, dataSize: 0x16 },
  battery: { commandClass: 0x07, commandId: 0x80, dataSize: 0x02 },
  charging: { commandClass: 0x07, commandId: 0x84, dataSize: 0x02 },
  sleepTimeout: { commandClass: 0x07, commandId: 0x83, dataSize: 0x02 },
  lowPowerThreshold: { commandClass: 0x07, commandId: 0x81, dataSize: 0x02 },
  dpi: { commandClass: 0x04, commandId: 0x85, dataSize: 0x07, args: [RAZER_STORAGE] },
  dpiStages: { commandClass: 0x04, commandId: 0x86, dataSize: 0x26, args: [0x00] },
  pollingRate: { commandClass: 0x00, commandId: 0x85, dataSize: 0x01 },
  pollingRateExtended: { commandClass: 0x00, commandId: 0xc0, dataSize: 0x02, args: [0x00] },
} as const satisfies Record<string, RazerCommand>;

/**
 * Write commands confirmed against Viper V3 Pro firmware 1.12.
 *
 * Razer pairs each read with a write that clears the high bit of the command
 * id. Only commands verified on hardware belong here — in particular the DPI
 * stage table (`0x04`/`0x06`) is absent on purpose, because a wrong length
 * there is the one realistic way to corrupt stored settings.
 */
export const RAZER_WRITE = {
  dpi: { commandClass: 0x04, commandId: 0x05, dataSize: 0x07 },
  pollingRate: { commandClass: 0x00, commandId: 0x05, dataSize: 0x01 },
  pollingRateExtended: { commandClass: 0x00, commandId: 0x40, dataSize: 0x02 },
  sleepTimeout: { commandClass: 0x07, commandId: 0x03, dataSize: 0x02 },
  lowPowerThreshold: { commandClass: 0x07, commandId: 0x01, dataSize: 0x02 },
} as const satisfies Record<string, Omit<RazerCommand, "args">>;

export function razerSetDpiCommand(x: number, y: number): RazerCommand {
  return {
    ...RAZER_WRITE.dpi,
    args: [RAZER_STORAGE, (x >> 8) & 0xff, x & 0xff, (y >> 8) & 0xff, y & 0xff, 0x00, 0x00],
  };
}

/** Seconds, big-endian, in the same encoding the matching read returns. */
export function razerSetSleepTimeoutCommand(seconds: number): RazerCommand {
  return { ...RAZER_WRITE.sleepTimeout, args: [(seconds >> 8) & 0xff, seconds & 0xff] };
}

/**
 * The payload mirrors the matching read byte for byte: the level on the 0–255
 * scale first, then a trailing zero. Confirmed on hardware by writing 85% and
 * finding `d9 00` still held after a reload.
 */
export function razerSetLowPowerThresholdCommand(percent: number): RazerCommand {
  return { ...RAZER_WRITE.lowPowerThreshold, args: [encodeBatteryLevel(percent), 0x00] };
}

function pollingDivisor(ceiling: number, pollingRateHz: number): number {
  const divisor = ceiling / pollingRateHz;
  if (!Number.isInteger(divisor) || divisor < 1 || divisor > 0xff) {
    throw new RazerProtocolError(`${pollingRateHz} Hz is not a rate this mouse can encode.`);
  }
  return divisor;
}

export function razerSetLegacyPollingCommand(pollingRateHz: number): RazerCommand {
  return { ...RAZER_WRITE.pollingRate, args: [pollingDivisor(1000, pollingRateHz)] };
}

/** The receiver takes the same leading argument its read echoes back. */
export function razerSetExtendedPollingCommand(pollingRateHz: number): RazerCommand {
  return { ...RAZER_WRITE.pollingRateExtended, args: [0x00, pollingDivisor(8000, pollingRateHz)] };
}

export class RazerProtocolError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "RazerProtocolError";
    this.status = status;
  }
}

export function razerChecksum(packet: Uint8Array): number {
  let checksum = 0;
  for (let index = CHECKSUM_FIRST; index < CHECKSUM_LAST; index += 1) checksum ^= packet[index];
  return checksum;
}

export function encodeRazerRequest(
  command: RazerCommand,
  transactionId: number = RAZER_TRANSACTION_ID,
): Uint8Array<ArrayBuffer> {
  const packet = new Uint8Array(RAZER_PACKET_LENGTH);
  packet[1] = transactionId;
  packet[5] = command.dataSize;
  packet[6] = command.commandClass;
  packet[7] = command.commandId;
  packet.set(command.args ?? [], ARGS_OFFSET);
  packet[CHECKSUM_INDEX] = razerChecksum(packet);
  return packet;
}

function describe(command: RazerCommand, problem: string): string {
  const hex = (value: number) => `0x${value.toString(16).padStart(2, "0")}`;
  return `Class ${hex(command.commandClass)} command ${hex(command.commandId)} ${problem}.`;
}

/** Returns the reply arguments, or throws with the reported status. */
export function decodeRazerResponse(packet: Uint8Array, command: RazerCommand): Uint8Array {
  if (packet.length !== RAZER_PACKET_LENGTH) {
    throw new RazerProtocolError(describe(command, `returned ${packet.length} bytes instead of ${RAZER_PACKET_LENGTH}`));
  }
  if (packet[CHECKSUM_INDEX] !== razerChecksum(packet)) {
    throw new RazerProtocolError(describe(command, "returned a reply with a bad checksum"));
  }
  const status = packet[0];
  if (status === RAZER_STATUS.unsupported) {
    throw new RazerProtocolError(describe(command, "is not supported by this mouse"), status);
  }
  if (status !== RAZER_STATUS.ok) {
    throw new RazerProtocolError(describe(command, `returned status ${`0x${status.toString(16).padStart(2, "0")}`}`), status);
  }
  if (packet[6] !== command.commandClass || packet[7] !== command.commandId) {
    throw new RazerProtocolError(describe(command, "was answered by a different command"), status);
  }
  const length = Math.min(packet[5], RAZER_PACKET_LENGTH - ARGS_OFFSET);
  return packet.slice(ARGS_OFFSET, ARGS_OFFSET + length);
}

export function decodeFirmwareVersion(args: Uint8Array): string {
  return `${args[0]}.${args[1]}`;
}

export function decodeSerial(args: Uint8Array): string {
  let text = "";
  for (const byte of args) {
    if (byte === 0) break;
    text += String.fromCharCode(byte);
  }
  return text.trim();
}

export function decodeBatteryPercent(args: Uint8Array): number {
  return Math.round((args[1] * 100) / BATTERY_SCALE);
}

/**
 * The low-power threshold shares the battery level's 0–255 scale rather than
 * being a percentage, so 0x4d is 30% and reading it as a percent is wrong by a
 * factor of two and a half.
 *
 * It also sits in the *first* argument byte, where battery, charging and sleep
 * all pad with a leading zero and answer in the second. The mouse replied
 * `4d 00` where Synapse showed 30%, so the class is not consistent about this
 * and the shared decoder cannot be reused.
 */
export function decodeLowPowerThreshold(args: Uint8Array): number {
  return Math.round((args[0] * 100) / BATTERY_SCALE);
}

export function encodeBatteryLevel(percent: number): number {
  return Math.round((percent * BATTERY_SCALE) / 100);
}

export function decodeCharging(args: Uint8Array): boolean {
  return args[1] === 1;
}

/**
 * Idle sleep is a whole number of seconds, unlike battery and charging in the
 * same class, which pad their one meaningful byte with a leading zero.
 */
export function decodeSleepTimeout(args: Uint8Array): number {
  return (args[0] << 8) | args[1];
}

export interface RazerDpi {
  x: number;
  y: number;
}

export function decodeDpi(args: Uint8Array): RazerDpi {
  return { x: (args[1] << 8) | args[2], y: (args[3] << 8) | args[4] };
}

export interface RazerDpiStages {
  /** One-based index into `stages`, as reported by the mouse. */
  active: number;
  stages: RazerDpi[];
}

export function decodeDpiStages(args: Uint8Array): RazerDpiStages {
  const count = args[2];
  const stages: RazerDpi[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = STAGE_OFFSET + index * STAGE_LENGTH;
    if (offset + 4 >= args.length) break;
    stages.push({
      x: (args[offset + 1] << 8) | args[offset + 2],
      y: (args[offset + 3] << 8) | args[offset + 4],
    });
  }
  return { active: args[1], stages };
}

/**
 * Legacy polling encodes the rate as a divisor of 1000, so it cannot express
 * the HyperPolling rates. Wireless answers this command as unsupported.
 */
export function decodeLegacyPollingRate(args: Uint8Array): number {
  if (!args[0]) throw new RazerProtocolError("The mouse reported an unknown polling rate.");
  return Math.round(1000 / args[0]);
}

/**
 * HyperPolling rates encode as a divisor of 8000. The first reply byte echoes
 * the request argument, so the rate lives in the second. Wired answers this
 * command as unsupported.
 */
export function decodeExtendedPollingRate(args: Uint8Array): number {
  if (!args[1]) throw new RazerProtocolError("The mouse reported an unknown polling rate.");
  return Math.round(8000 / args[1]);
}
