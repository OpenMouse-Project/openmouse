import {
  decodeFirmwareVersion,
  decodeRazerResponse,
  encodeRazerRequest,
  type RazerCommand,
} from "@openmouse/protocol/razer";

export const BRANDS: Record<number, string> = {
  0x1532: "Razer",
  0x31E3: "Razer HyperPolling",
  0x046D: "Logitech",
  0x1038: "SteelSeries",
  0x1B1C: "Corsair",
  0x0951: "HyperX / Kingston",
  0x0B05: "Asus",
  0x1E7D: "Roccat",
  0x258A: "SinoWealth / Glorious",
  0x30FA: "SinoWealth",
  0x1770: "Zowie / BenQ",
  0x093A: "PixArt",
  0x3710: "Pulsar",
  0x3367: "Endgame Gear",
  0x36A7: "WLMouse",
  0x373E: "Lamzu / CRDRAKO / Attack Shark",
  0x3554: "Teevolution / VGN",
  0x373B: "ATK",
  0x361D: "Finalmouse",
  0x3434: "Keychron",
  0x2FE3: "moddoMOUSE",
  0x1915: "Orbital",
  0x0C45: "Redragon",
  0x1BCF: "Alienware",
  0x3151: "Fantech",
};

const OPENMOUSE_SUPPORTED = new Set([
  0x1532, 0x046D, 0x3710, 0x3367, 0x36A7, 0x373E, 0x3554, 0x373B, 0x361D, 0x3434, 0x2FE3, 0x1915,
  0x3151,
]);

/**
 * Safety: skip raw feature-report probing for these vendors.
 * Endgame Gear (0x3367): OP1 8K has no firmware guards — unrecognised
 * feature-report bytes accidentally triggered a bootloader reset in testing.
 * The OpenMouse driver handles these devices through its own safe protocol.
 */
const SKIP_FEATURE_PROBE = new Set([0x3367]);

export const SCAN_FILTERS: HIDDeviceFilter[] = Object.keys(BRANDS).map((vid) => ({
  vendorId: Number(vid),
}));

const RAZER_TX_IDS = [0xFF, 0x3F, 0x1F] as const;
const RAZER_FIRMWARE_COMMAND: RazerCommand = {
  commandClass: 0x00,
  commandId: 0x81,
  dataSize: 0x02,
};

async function tryRazerTx(
  device: HIDDevice,
  txId: number,
): Promise<{ ok: boolean; firmware: string | null }> {
  const packet = encodeRazerRequest(RAZER_FIRMWARE_COMMAND, txId);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await device.sendFeatureReport(0x00, packet);
      await sleep(120);
      const resp = await device.receiveFeatureReport(0x00);
      const data = new Uint8Array(resp.buffer.slice(resp.byteOffset, resp.byteOffset + resp.byteLength));
      if (data[1] !== txId) continue;
      const args = decodeRazerResponse(data, RAZER_FIRMWARE_COMMAND);
      return { ok: true, firmware: decodeFirmwareVersion(args) };
    } catch {
    }
    await sleep(60);
  }
  return { ok: false, firmware: null };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function hex(n: number, width = 4): string {
  return n.toString(16).toUpperCase().padStart(width, "0");
}

export function usagePageLabel(page: number): string {
  if (page >= 0xFF00) return `Vendor (0x${hex(page)})`;
  switch (page) {
    case 0x0001: return "Generic Desktop";
    case 0x000C: return "Consumer";
    case 0x000B: return "Telephony";
    case 0x0006: return "Generic Device";
    default: return `0x${hex(page)}`;
  }
}

export function reportSummary(col: HIDCollectionInfo): string {
  const parts: string[] = [];
  if (col.inputReports.length > 0) parts.push(`${col.inputReports.length}× input`);
  if (col.outputReports.length > 0) parts.push(`${col.outputReports.length}× output`);
  if (col.featureReports.length > 0) parts.push(`${col.featureReports.length}× feature`);
  return parts.join("  ") || "no reports";
}

export type Verdict = "full" | "partial" | "limited" | "blocked" | "unknown";

export const VERDICT_LABEL: Record<Verdict, string> = {
  full: "WEBHID FULL",
  partial: "PARTIAL",
  limited: "LIMITED",
  blocked: "NATIVE ONLY",
  unknown: "UNKNOWN",
};

export interface DeviceResult {
  device: HIDDevice;
  brand: string;
  vendorId: number;
  productId: number;
  openmouseSupported: boolean;
  isRazer: boolean;
  opened: boolean;
  openError: string | null;
  verdict: Verdict;
  verdictNote: string;
  txResults: Array<{ txId: number; ok: boolean; firmware: string | null }>;
}

function assessCollections(
  vendorId: number,
  collections: readonly HIDCollectionInfo[],
): { verdict: Verdict; note: string } {
  if (vendorId === 0x31E3) {
    return { verdict: "blocked", note: "HyperPolling dongle — mouhid.sys blocks WebHID on Windows" };
  }
  const hasVendor = collections.some((c) => c.usagePage >= 0xFF00);
  const hasVendorFeature = collections.some((c) => c.usagePage >= 0xFF00 && c.featureReports.length > 0);
  const hasStdOnly = !hasVendor && collections.some((c) => c.usagePage === 0x01 && c.usage === 0x02);

  if (hasVendorFeature) return { verdict: "full", note: "Vendor interface with feature reports visible" };
  if (hasVendor) return { verdict: "partial", note: "Vendor interface found — feature report visibility varies by OS/browser" };
  if (hasStdOnly) return { verdict: "limited", note: "Only standard boot-mouse interface visible to WebHID" };
  return { verdict: "unknown", note: "No collections visible — interface may be blocked" };
}

export async function scanDevices(devices: HIDDevice[]): Promise<DeviceResult[]> {
  const results: DeviceResult[] = [];

  for (const device of devices) {
    const vendorId = device.vendorId;
    const productId = device.productId;
    const brand = BRANDS[vendorId] ?? `Unknown (VID 0x${hex(vendorId)})`;
    const isRazer = vendorId === 0x1532 || vendorId === 0x31E3;
    const openmouseSupported = OPENMOUSE_SUPPORTED.has(vendorId);

    const { verdict: preVerdict, note: preNote } = assessCollections(vendorId, device.collections);

    let opened = false;
    let openError: string | null = null;
    let verdict: Verdict = preVerdict;
    let verdictNote = preNote;
    const txResults: DeviceResult["txResults"] = [];

    try {
      if (!device.opened) await device.open();
      opened = true;
    } catch (err) {
      openError = err instanceof Error ? err.message : "Could not open device";
      if (preVerdict === "full" || preVerdict === "partial") {
        verdict = "blocked";
        verdictNote = `OS/browser blocked open: ${openError}`;
      }
    }

    if (opened && vendorId === 0x1532) {
      let anyOk = false;
      for (const txId of RAZER_TX_IDS) {
        const result = await tryRazerTx(device, txId);
        txResults.push({ txId, ...result });
        if (result.ok) anyOk = true;
      }
      if (anyOk) {
        verdict = "full";
        verdictNote = "Razer HID protocol responding — TX-ID test passed";
      } else if (preVerdict !== "blocked") {
        verdict = "partial";
        verdictNote = "Device opened but TX-ID test received no valid response";
      }
    }

    if (opened && !isRazer && verdict !== "blocked") {
      if (SKIP_FEATURE_PROBE.has(vendorId)) {
        verdictNote = `${brand} — interface accessible (probe skipped for safety)`;
      } else {
        const vendorCollections = device.collections
          .filter((c) => c.usagePage >= 0xFF00 && c.featureReports.length > 0);
        if (vendorCollections.length > 0) {
          const reportId = vendorCollections[0].featureReports[0].reportId;
          try {
            await device.receiveFeatureReport(reportId);
            verdict = "full";
            verdictNote = "Feature report readable on vendor interface";
          } catch {
            verdict = "partial";
            verdictNote = "Vendor interface accessible but feature report read failed";
          }
        }
      }
    }

    results.push({
      device,
      brand,
      vendorId,
      productId,
      openmouseSupported,
      isRazer,
      opened,
      openError,
      verdict,
      verdictNote,
      txResults,
    });
  }

  return results;
}

export function buildDiscordSummary(results: DeviceResult[]): string {
  const lines: string[] = ["**OpenMouse HID Diagnostic Report**", ""];
  for (const r of results) {
    const name = r.device.productName || `${r.brand} Mouse`;
    const verdict = VERDICT_LABEL[r.verdict];
    lines.push(`**${name}** — \`${r.brand}\` | \`VID_${hex(r.vendorId)}\` | **${verdict}**`);
    lines.push(`> ${r.verdictNote}`);
    const collections = r.device.collections
      .map((c) => `\`${usagePageLabel(c.usagePage)}\``)
      .join(", ");
    if (collections) lines.push(`> Interfaces: ${collections}`);
    if (r.txResults.length > 0) {
      const txSummary = r.txResults
        .map((t) => `TX 0x${hex(t.txId, 2)}: ${t.ok ? `✅ FW ${t.firmware ?? "?"}` : "❌"}`)
        .join(" | ");
      lines.push(`> ${txSummary}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
