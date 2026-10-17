import type { ProfileVerificationExport } from "./capture-format";
import type {
  ProfileContentWriteProbeBackup,
  ProfileContentWriteProbeReport,
} from "@openmouse/protocol/drivers/logitech/hidpp";

export interface CaptureProfileSource {
  read(): Promise<Array<{ sector: number; bytes: Uint8Array }>>;
  readVerification(): Promise<Omit<ProfileVerificationExport, "device" | "profileFormat">>;
  describeOffset(offset: number): string | null;
  reproduce(before: Uint8Array, after: Uint8Array): Uint8Array;
}

export interface CaptureWriteProbe {
  supported: boolean;
  reason: string;
  prepare?(): Promise<ProfileContentWriteProbeBackup>;
  run?(backup: ProfileContentWriteProbeBackup): Promise<ProfileContentWriteProbeReport>;
}

export interface CaptureContext {
  device: string | null;
  profileFormat: string | null;
  profiles: CaptureProfileSource | null;
  writeProbe: CaptureWriteProbe | null;
}

let context: CaptureContext = { device: null, profileFormat: null, profiles: null, writeProbe: null };

export function setCaptureContext(next: CaptureContext): void {
  context = next;
}

export function captureContext(): CaptureContext {
  return context;
}
