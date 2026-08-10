import "./check.css";

// ---------------------------------------------------------------------------
// Brand registry — all known gaming mouse vendor IDs
// ---------------------------------------------------------------------------

const BRANDS: Record<number, string> = {
  0x1532: "Razer",
  0x31E3: "Razer HyperPolling",
  0x046D: "Logitech",
  0x1038: "SteelSeries",
  0x1B1C: "Corsair",
  0x0951: "HyperX / Kingston",
  0x0B05: "ASUS ROG",
  0x1E7D: "Roccat",
  0x258A: "SinoWealth / Glorious",
  0x30FA: "SinoWealth",
  0x1770: "Zowie / BenQ",
  0x093A: "PixArt",
  0x3710: "Pulsar",
  0x3367: "Endgame Gear",
  0x36A7: "WLMouse",
  0x373E: "Lamzu",
  0x3554: "Teevolution / VGN",
  0x373B: "ATK",
  0x361D: "Finalmouse",
  0x3434: "Keychron",
  0x2FE3: "moddoMOUSE",
  0x1915: "Orbital",
  0x0C45: "Redragon",
  0x1BCF: "Alienware",
};

// OpenMouse-supported brands (driver exists in the control app)
const OPENMOUSE_SUPPORTED = new Set([0x046D, 0x3710, 0x3367, 0x36A7, 0x373E, 0x3554, 0x373B, 0x361D, 0x3434, 0x2FE3, 0x1915]);

// Safety: skip raw feature-report probing for these vendors.
// Endgame Gear (0x3367): OP1 8K has no firmware guards — unrecognised
// feature-report bytes accidentally triggered a bootloader reset in testing.
// The OpenMouse driver handles these devices through its own safe protocol.
const SKIP_FEATURE_PROBE = new Set([0x3367]);

// Broad filters — vendorId only so all interfaces appear
const SCAN_FILTERS: HIDDeviceFilter[] = Object.keys(BRANDS).map((vid) => ({
  vendorId: Number(vid),
}));

// ---------------------------------------------------------------------------
// Razer TX-ID protocol
// ---------------------------------------------------------------------------

const RAZER_TX_IDS = [0xFF, 0x3F, 0x1F] as const;

function buildRazerPacket(txId: number): Uint8Array {
  const buf = new Uint8Array(90);
  // [0] = status (0x00)
  buf[1] = txId;
  // [2-3] = remaining_packets (0x0000)
  // [4] = protocol_type (0x00)
  buf[5] = 0x02; // data_size
  buf[6] = 0x00; // command_class: device info
  buf[7] = 0x81; // command_id: firmware version
  // [8-87] = arguments (zeros)
  let crc = 0;
  for (let i = 2; i <= 87; i++) crc ^= buf[i];
  buf[88] = crc;
  // [89] = reserved (0x00)
  return buf;
}

async function tryRazerTx(
  device: HIDDevice,
  txId: number,
): Promise<{ ok: boolean; firmware: string | null }> {
  const packet = buildRazerPacket(txId);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await device.sendFeatureReport(0x00, packet);
      await sleep(120);
      const resp = await device.receiveFeatureReport(0x00);
      const data = new Uint8Array(resp.buffer, resp.byteOffset);
      if (data[0] === 0x02) {
        const fw = `${data[8]}.${String(data[9]).padStart(2, "0")}`;
        return { ok: true, firmware: fw };
      }
    } catch {
      // continue
    }
    await sleep(60);
  }
  return { ok: false, firmware: null };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function hex(n: number, width = 4): string {
  return n.toString(16).toUpperCase().padStart(width, "0");
}

function usagePageLabel(page: number): string {
  if (page >= 0xFF00) return `Vendor (0x${hex(page)})`;
  switch (page) {
    case 0x0001: return "Generic Desktop";
    case 0x000C: return "Consumer";
    case 0x000B: return "Telephony";
    case 0x0006: return "Generic Device";
    default: return `0x${hex(page)}`;
  }
}

function reportSummary(col: HIDCollectionInfo): string {
  const parts: string[] = [];
  if (col.inputReports.length > 0) parts.push(`${col.inputReports.length}× input`);
  if (col.outputReports.length > 0) parts.push(`${col.outputReports.length}× output`);
  if (col.featureReports.length > 0) parts.push(`${col.featureReports.length}× feature`);
  return parts.join("  ") || "no reports";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]!));
}

type Verdict = "full" | "partial" | "limited" | "blocked" | "unknown";
const VERDICT_LABEL: Record<Verdict, string> = {
  full:    "WEBHID FULL",
  partial: "PARTIAL",
  limited: "LIMITED",
  blocked: "NATIVE ONLY",
  unknown: "UNKNOWN",
};

interface DeviceResult {
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

// ---------------------------------------------------------------------------
// Assessment (pre-open, based on collections)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

async function scanDevices(devices: HIDDevice[]): Promise<DeviceResult[]> {
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

    // Try to open
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

    // Razer TX test (only if opened, and is Razer VID)
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

    // Generic feature report probe (non-Razer, if opened)
    if (opened && !isRazer && verdict !== "blocked") {
      if (SKIP_FEATURE_PROBE.has(vendorId)) {
        // No raw feature-report probing — this vendor's firmware has no safety
        // guards and unrecognised bytes can corrupt device state.
        verdictNote = `${brand} — interface accessible (probe skipped for safety)`;
      } else {
        const vendorCollections = device.collections.filter((c) => c.usagePage >= 0xFF00 && c.featureReports.length > 0);
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

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderCard(result: DeviceResult): string {
  const nameRaw = result.device.productName || `${result.brand} Mouse`;
  const name = escapeHtml(nameRaw);
  const vidpid = `VID_${hex(result.vendorId)} · PID_${hex(result.productId)}`;

  const badge = `<span class="verdict-badge verdict-${result.verdict}">${VERDICT_LABEL[result.verdict]}</span>`;
  const supportBadge = result.openmouseSupported
    ? `<span class="verdict-badge verdict-full" style="font-size:.52rem">OPENMOUSE</span>`
    : "";

  // Collections
  const ifaceRows = result.device.collections.map((col) => `
    <div class="iface-row">
      <span class="iface-page">${usagePageLabel(col.usagePage)}</span>
      <span class="iface-type">Usage 0x${hex(col.usage, 2)}</span>
      <span class="iface-reports">${reportSummary(col)}</span>
    </div>`).join("");

  const ifaceSection = result.device.collections.length > 0 ? `
    <div class="iface-section">
      <div class="iface-label">HID COLLECTIONS</div>
      ${ifaceRows}
    </div>` : "";

  // TX results (Razer)
  const txSection = result.txResults.length > 0 ? `
    <div class="tx-section">
      <div class="tx-label">RAZER TX-ID TEST</div>
      ${result.txResults.map((t) => `
        <div class="tx-row">
          <span class="tx-id">TX 0x${hex(t.txId, 2)}</span>
          <span class="${t.ok ? "tx-ok" : "tx-fail"}">${t.ok ? "✓ responded" : "✗ no response"}</span>
          ${t.firmware ? `<span class="tx-fw">FW ${t.firmware}</span>` : ""}
        </div>`).join("")}
    </div>` : "";

  // Open result
  const openResult = result.opened
    ? `<div class="open-result ok"><span class="open-dot"></span>Device opened successfully</div>`
    : `<div class="open-result err"><span class="open-dot"></span>${escapeHtml(result.openError ?? "Could not open")}</div>`;

  // Verdict note
  const verdictNote = `<div style="margin-top:.6rem;color:#55555b;font-size:.68rem">${escapeHtml(result.verdictNote)}</div>`;

  return `<div class="device-card">
    <div class="device-card-head">
      <div class="device-card-identity">
        <strong>${name}</strong>
        <small>${escapeHtml(result.brand)} · ${vidpid}</small>
      </div>
      <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        ${supportBadge}
        ${badge}
      </div>
    </div>
    ${ifaceSection}
    ${txSection}
    ${openResult}
    ${verdictNote}
  </div>`;
}

function buildDiscordSummary(results: DeviceResult[]): string {
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

// ---------------------------------------------------------------------------
// App init
// ---------------------------------------------------------------------------

const root = document.querySelector<HTMLDivElement>("#check-app");
if (!root) throw new Error("check-app root not found");

const supportsWebHid = "hid" in navigator;

root.innerHTML = `
  <div class="check-shell">
    <header class="check-header">
      <a class="check-wordmark" href="/">OpenMouse <span>/ Mouse Check</span></a>
      <a class="check-back" href="/">← Back to site</a>
    </header>

    <section class="check-hero">
      <p class="overline">HID DIAGNOSTICS</p>
      <h1>Mouse Check</h1>
      <p>Scan your connected gaming mice to see which interfaces are accessible via WebHID — and which require a native driver.</p>
    </section>

    <div id="compat-banner"></div>

    <div class="scan-row">
      <button id="scan-btn" class="scan-button" type="button" ${supportsWebHid ? "" : "disabled"}>
        Scan for mice
      </button>
      <span class="scan-note">You'll see a browser prompt to select devices.</span>
    </div>

    <div id="results-area"></div>
  </div>`;

// Browser compat banner
const compatBanner = document.querySelector<HTMLElement>("#compat-banner")!;
if (supportsWebHid) {
  compatBanner.innerHTML = `<div class="compat-banner ok"><span class="compat-banner-dot"></span>WebHID is available in this browser — device scanning is supported.</div>`;
} else {
  compatBanner.innerHTML = `<div class="compat-banner warn"><span class="compat-banner-dot"></span>WebHID is not available. Use Chrome or Edge on desktop to run the diagnostics.</div>`;
}

// Scan button
document.querySelector<HTMLButtonElement>("#scan-btn")?.addEventListener("click", () => {
  void runScan();
});

async function runScan(): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>("#scan-btn")!;
  const area = document.querySelector<HTMLElement>("#results-area")!;

  if (!navigator.hid) return;

  btn.disabled = true;
  btn.textContent = "Scanning…";
  area.innerHTML = `<div class="scanning-state">Waiting for browser prompt…</div>`;

  let devices: HIDDevice[];
  try {
    devices = await navigator.hid.requestDevice({ filters: SCAN_FILTERS });
  } catch {
    area.innerHTML = `<div class="check-empty">Scan cancelled or no device selected.</div>`;
    btn.disabled = false;
    btn.textContent = "Scan for mice";
    return;
  }

  if (devices.length === 0) {
    area.innerHTML = `<div class="check-empty">No matching devices selected.</div>`;
    btn.disabled = false;
    btn.textContent = "Scan for mice";
    return;
  }

  area.innerHTML = `<div class="scanning-state">Testing ${devices.length} device${devices.length !== 1 ? "s" : ""}…</div>`;

  let results: DeviceResult[];
  try {
    results = await scanDevices(devices);
  } catch (err) {
    area.innerHTML = `<div class="check-empty">Scan error: ${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
    btn.disabled = false;
    btn.textContent = "Scan for mice";
    return;
  }

  const cards = results.map(renderCard).join("");
  const summaryText = buildDiscordSummary(results);

  area.innerHTML = `
    <div class="results-heading">
      <span>RESULTS — ${results.length} DEVICE${results.length !== 1 ? "S" : ""}</span>
    </div>
    <div class="results-list">${cards}</div>
    <div class="copy-section">
      <p>Share these results with the OpenMouse team on Discord.</p>
      <button id="copy-btn" class="copy-button" type="button">Copy for Discord</button>
    </div>`;

  document.querySelector<HTMLButtonElement>("#copy-btn")?.addEventListener("click", (ev) => {
    void navigator.clipboard.writeText(summaryText).then(() => {
      const btn2 = ev.currentTarget as HTMLButtonElement;
      btn2.textContent = "Copied!";
      btn2.classList.add("copied");
      setTimeout(() => {
        btn2.textContent = "Copy for Discord";
        btn2.classList.remove("copied");
      }, 2000);
    });
  });

  btn.disabled = false;
  btn.textContent = "Scan again";
}
