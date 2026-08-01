export function describeHidDevice(device: HIDDevice): string {
  const name = device.productName || "unknown";
  const ids = `VID 0x${device.vendorId.toString(16)} PID 0x${device.productId.toString(16)}`;
  const collections = device.collections.map((collection) => {
    const features = collection.featureReports.map((report) => `0x${report.reportId.toString(16)}`).join(",") || "none";
    return `usage 0x${collection.usagePage.toString(16)}:${collection.usage.toString(16)} feat[${features}]`;
  }).join(" | ") || "no collections";
  return `${name} (${ids}; ${collections})`;
}
