import type { AtkReceiverInfo } from "@openmouse/protocol/drivers/mouse-types";

export const VXE_R1_PRO_MAX_RECEIVER = {
  vendorId: 0x3554,
  productId: 0xf58a,
  cid: 0x02,
  mid: 0x1b,
} as const;

export const VXE_R1_PRO_MAX_WIRED = {
  vendorId: 0x3554,
  productId: 0xf58c,
  cid: 0x02,
  mid: 0x1b,
} as const;

export const VXE_R1_SE_PLUS_RECEIVER = {
  vendorId: 0x3554,
  productId: 0xf58e,
  cid: 0x02,
  mid: 0x20,
} as const;

export function isVxeR1ProMaxReceiver(device: Pick<HIDDevice, "vendorId" | "productId"> | null): boolean {
  return device?.vendorId === VXE_R1_PRO_MAX_RECEIVER.vendorId
    && device.productId === VXE_R1_PRO_MAX_RECEIVER.productId;
}

export function isVxeR1ProMaxWired(device: Pick<HIDDevice, "vendorId" | "productId"> | null): boolean {
  return device?.vendorId === VXE_R1_PRO_MAX_WIRED.vendorId
    && device.productId === VXE_R1_PRO_MAX_WIRED.productId;
}

export function isVxeR1SePlusReceiver(device: Pick<HIDDevice, "vendorId" | "productId"> | null): boolean {
  return device?.vendorId === VXE_R1_SE_PLUS_RECEIVER.vendorId
    && device.productId === VXE_R1_SE_PLUS_RECEIVER.productId;
}

export function receiverPairingSucceeded(receiver: AtkReceiverInfo, observedInProgress: boolean): boolean {
  return observedInProgress && receiver.pairingStatus === 2 && receiver.online;
}
