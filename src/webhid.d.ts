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

interface HIDDevice extends EventTarget {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly opened: boolean;
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
