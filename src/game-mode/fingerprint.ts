import type { CollectionFingerprint, ReportFingerprint, ReportFingerprintKind } from "./types";

/**
 * Fingerprints every top-level collection AND its nested children (WebHID
 * nests sub-collections; HidSharp's ReportDescriptor.Reports/DeviceItems are
 * effectively flat across the whole interface), so the companion app can
 * find the exact same physical HID interface again later without a Windows
 * device path (which WebHID never exposes).
 *
 * Report byte length is computed and included for diagnostics only. It is
 * NOT used for matching (see HidDeviceMatcher.cs): re-deriving a byte length
 * from WebHID's bit-sized report items that's guaranteed to agree with
 * HidSharp's own Report.Length units isn't verifiable without hardware in
 * the loop, so matching relies on (usages) + (report kind, report id) only.
 */
export function buildFingerprint(device: HIDDevice): CollectionFingerprint {
  const usages = new Set<number>();
  const reports: ReportFingerprint[] = [];
  const seen = new Set<string>();

  const addReports = (list: readonly HIDReportInfo[], kind: ReportFingerprintKind) => {
    for (const report of list) {
      const key = `${kind}:${report.reportId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reports.push({ kind, reportId: report.reportId, length: reportByteLength(report) });
    }
  };

  const walk = (collection: HIDCollectionInfo) => {
    usages.add(((collection.usagePage << 16) | collection.usage) >>> 0);
    addReports(collection.inputReports, "input");
    addReports(collection.outputReports, "output");
    addReports(collection.featureReports, "feature");
    for (const child of collection.children) walk(child);
  };

  for (const collection of device.collections) walk(collection);

  return { usages: [...usages], reports };
}

function reportByteLength(report: HIDReportInfo): number {
  const bits = report.items.reduce((sum, item) => sum + item.reportSize * item.reportCount, 0);
  return 1 + Math.ceil(bits / 8); // +1 for the report-id byte the wire format prepends
}
