interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;
}

interface HIDReportInfo {
  readonly reportId: number;
}

interface HIDCollectionInfo {
  readonly usagePage: number;
  readonly usage: number;
  readonly inputReports: readonly HIDReportInfo[];
  readonly outputReports: readonly HIDReportInfo[];
  readonly featureReports: readonly HIDReportInfo[];
  readonly children: readonly HIDCollectionInfo[];
}

interface HIDDevice extends EventTarget {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly opened: boolean;
  readonly collections: readonly HIDCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(type: "inputreport", listener: (event: HIDInputReportEvent) => void): void;
  removeEventListener(type: "inputreport", listener: (event: HIDInputReportEvent) => void): void;
}

interface HID extends EventTarget {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: { filters: HIDDeviceFilter[] }): Promise<HIDDevice[]>;
}

interface Navigator {
  hid?: HID;
}
