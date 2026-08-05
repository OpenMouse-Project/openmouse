export const FINALMOUSE_REPORT = {
  dongle: 0x02,
  dongleInput: 0x03,
  main: 0x04,
  mainInput: 0x05,
} as const;

export const FINALMOUSE_COMMAND = {
  dpi: 16,
  pollingRate: 17,
  motionSync: 18,
  dongleLed: 20,
  liftOffDistance: 21,
  tournamentScrollMode: 23,
  tournamentScrollTimeout: 24,
  wakeAll: 96,
  dongleInfo: 10,
} as const;

const OUTPUT_REPORT_LENGTH = 63;

export interface FinalmouseTelemetry {
  dpi?: number;
  pollingRateHz?: number;
  batteryVoltageMv?: number;
  batteryPercent?: number;
  rssiDbm?: number;
  liftOffDistanceMm?: number;
  motionSync?: boolean;
  dongleLedMode?: number;
  tournamentScrollMode?: number;
  tournamentScrollTimeoutMs?: number;
  chargingState?: number;
  mouseFirmware?: string;
  dongleRfFirmware?: string;
  dongleUsbFirmware?: string;
  mouseSerial?: string;
}

/** Build xpanel's 63-byte WebHID payload. The browser supplies reportId separately. */
export function buildFinalmouseReport(command: number, payload = new Uint8Array()): Uint8Array {
  if (!Number.isInteger(command) || command < 0 || command > 0x7f) throw new Error("Invalid Finalmouse command.");
  if (payload.length > OUTPUT_REPORT_LENGTH - 3) throw new Error("Finalmouse command payload is too large.");
  const report = new Uint8Array(OUTPUT_REPORT_LENGTH);
  report[0] = 2 + payload.length;
  report[1] = 0x80 | command;
  report[2] = payload.length;
  report.set(payload, 3);
  return report;
}

/** Decode one WebHID input payload after the browser has removed the report ID. */
export function decodeFinalmouseReport(reportId: number, data: Uint8Array): Partial<FinalmouseTelemetry> | null {
  if ((reportId !== FINALMOUSE_REPORT.dongleInput && reportId !== FINALMOUSE_REPORT.mainInput) || data.length < 3) return null;
  const innerLength = Math.min(data[0] ?? 0, data.length - 1);
  const body = data.subarray(1, innerLength + 1);
  if (body.length < 2) return null;
  const command = body[0] ?? -1;
  const payloadLength = Math.min(body[1] ?? 0, Math.max(0, body.length - 2));
  const payload = body.subarray(2, 2 + payloadLength);

  if (reportId === FINALMOUSE_REPORT.dongleInput) {
    return command === FINALMOUSE_COMMAND.dongleInfo
      ? { dongleUsbFirmware: decodeAscii(payload, payloadLength - 1) }
      : null;
  }

  switch (command) {
    case 3: {
      const dpi = u16le(payload);
      return dpi === null ? null : { dpi };
    }
    case 4: {
      const pollingRateHz = u16le(payload);
      return pollingRateHz === null ? null : { pollingRateHz };
    }
    case 5: {
      const millivolts = u16le(payload);
      return millivolts === null ? null : {
        batteryVoltageMv: millivolts,
        batteryPercent: finalmouseBatteryPercent(millivolts),
      };
    }
    case 11: return { dongleRfFirmware: decodeAscii(payload, payloadLength - 1) };
    case 12: return { mouseFirmware: decodeAscii(payload, payloadLength - 1) };
    case 13: return payload.length < 1 ? null : { rssiDbm: payload[0]! > 127 ? payload[0]! - 256 : payload[0]! };
    case 14: return { mouseSerial: decodeAscii(payload, payloadLength - 1) };
    case 18: return payload.length < 1 ? null : { motionSync: payload[0] === 1 };
    case 20: return payload.length < 1 ? null : { dongleLedMode: payload[0] };
    case 21: return payload.length < 1 ? null : { liftOffDistanceMm: payload[0] };
    case 23: return payload.length < 1 ? null : { tournamentScrollMode: payload[0] };
    case 24: return payload.length < 1 ? null : { tournamentScrollTimeoutMs: payload[0]! * 100 };
    case 37: return payload.length < 1 ? null : { chargingState: payload[0] };
    default: return null;
  }
}

/** Finalmouse's ULX battery-voltage calibration curve from xpanel. */
export function finalmouseBatteryPercent(millivolts: number): number {
  if (millivolts <= 0) return 0;
  const voltage = millivolts / 1000;
  const voltages = [3, 3.62, 3.66, 3.74, 3.88, 4.17, 4.38];
  const percentages = [0.2, 5, 10, 25, 50, 75, 100];
  if (voltage >= voltages.at(-1)!) return 100;
  if (voltage <= voltages[0]!) return 0;
  for (let index = 0; index < voltages.length - 1; index += 1) {
    const low = voltages[index]!;
    const high = voltages[index + 1]!;
    if (voltage < low || voltage > high) continue;
    const fraction = (voltage - low) / (high - low);
    return Math.round(percentages[index]! + (percentages[index + 1]! - percentages[index]!) * fraction);
  }
  return 0;
}

function u16le(payload: Uint8Array): number | null {
  return payload.length < 2 ? null : payload[0]! | (payload[1]! << 8);
}

function decodeAscii(payload: Uint8Array, length: number): string {
  if (length <= 0) return "";
  return new TextDecoder("ascii").decode(payload.subarray(0, Math.min(length, payload.length))).replace(/[\0 ]+$/, "");
}
