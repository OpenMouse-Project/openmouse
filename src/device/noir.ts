import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";

type DeviceIdentity = Pick<MouseStatus, "brand" | "name">;

export function isNoirM2NexStatus(status: DeviceIdentity | null | undefined): boolean {
  return status?.brand === "Noir Gear" && status.name === "M2-NEX";
}

/** E1 is exposed by the shared K-snake transport under either brand. */
export function isNoirE1Status(status: DeviceIdentity | null | undefined): boolean {
  return status?.name.trim().toUpperCase() === "NOIR E1"
    && (status.brand === "Noir Gear" || status.brand === "K-snake");
}

export function isNoirKsnakeStatus(status: DeviceIdentity | null | undefined): boolean {
  return isNoirM2NexStatus(status) || isNoirE1Status(status);
}

export function noirBrandLabel(status: DeviceIdentity): string {
  return isNoirE1Status(status) ? "Noir Gear" : status.brand;
}

/** Factory DPI indicator colours in the K-snake/Noir firmware order. */
export const NOIR_DPI_STAGE_COLORS = [
  "#ff5a5a",
  "#4ade80",
  "#60a5fa",
  "#facc15",
  "#22d3ee",
  "#e879f9",
] as const;
